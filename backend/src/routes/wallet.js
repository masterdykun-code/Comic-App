const express = require('express');
const pool = require('../config/db');
const { authRequired } = require('../middlewares/auth');
const router = express.Router();

const MISSIONS = [
  { id: 'daily_read', title: 'Đọc 1 chương hôm nay', reward: 10 },
  { id: 'daily_comment', title: 'Bình luận 1 lần hôm nay', reward: 5 },
  { id: 'daily_shelf', title: 'Có truyện trong tủ sách', reward: 5 },
  { id: 'daily_vote', title: 'Đề cử 1 truyện hôm nay', reward: 5 },
];

async function getStreak(userId) {
  const r = await pool.query(
    'SELECT checkin_date FROM checkins WHERE user_id=$1 ORDER BY checkin_date DESC LIMIT 7',
    [userId]
  );
  const dates = r.rows.map((x) => x.checkin_date.toISOString().slice(0, 10));
  const today = new Date().toISOString().slice(0, 10);
  if (!dates.includes(today)) {
    // streak tính đến hôm qua
    let s = 0;
    const d = new Date();
    d.setDate(d.getDate() - 1);
    while (dates.includes(d.toISOString().slice(0, 10))) { s++; d.setDate(d.getDate() - 1); }
    return s;
  }
  let s = 0;
  const d = new Date();
  while (dates.includes(d.toISOString().slice(0, 10))) { s++; d.setDate(d.getDate() - 1); }
  return s;
}

async function missionDone(userId, missionId) {
  if (missionId === 'daily_read') {
    const r = await pool.query(
      "SELECT 1 FROM reading_history WHERE user_id=$1 AND last_read_at::date = CURRENT_DATE LIMIT 1", [userId]);
    return r.rows.length > 0;
  }
  if (missionId === 'daily_comment') {
    const r = await pool.query(
      "SELECT 1 FROM comments WHERE user_id=$1 AND created_at::date = CURRENT_DATE LIMIT 1", [userId]);
    return r.rows.length > 0;
  }
  if (missionId === 'daily_shelf') {
    const r = await pool.query('SELECT 1 FROM bookshelf WHERE user_id=$1 LIMIT 1', [userId]);
    return r.rows.length > 0;
  }
  if (missionId === 'daily_vote') {
    const r = await pool.query(
      'SELECT 1 FROM power_votes WHERE user_id=$1 AND vote_date = CURRENT_DATE LIMIT 1', [userId]);
    return r.rows.length > 0;
  }
  return false;
}

// GET /api/wallet/me
router.get('/me', authRequired, async (req, res) => {
  try {
    const u = await pool.query('SELECT id, username, email, coins FROM users WHERE id=$1', [req.user.id]);
    const chk = await pool.query(
      'SELECT 1 FROM checkins WHERE user_id=$1 AND checkin_date = CURRENT_DATE', [req.user.id]);
    const v = await pool.query(
      'SELECT COUNT(*) FROM power_votes WHERE user_id=$1 AND vote_date = CURRENT_DATE', [req.user.id]);
    res.json({
      ...u.rows[0],
      checked_today: chk.rows.length > 0,
      streak: await getStreak(req.user.id),
      votes_today: parseInt(v.rows[0].count),
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/wallet/checkin - điểm danh, thưởng tăng theo streak
router.post('/checkin', authRequired, async (req, res) => {
  try {
    const ex = await pool.query(
      'SELECT 1 FROM checkins WHERE user_id=$1 AND checkin_date = CURRENT_DATE', [req.user.id]);
    if (ex.rows.length > 0) return res.status(400).json({ message: 'Hôm nay đã điểm danh' });
    await pool.query('INSERT INTO checkins(user_id) VALUES($1)', [req.user.id]);
    const streak = await getStreak(req.user.id);
    const reward = 10 + Math.min(Math.max(streak - 1, 0), 6) * 2; // ngày 1:10 ... ngày 7:22
    await pool.query('UPDATE users SET coins = coins + $1 WHERE id=$2', [reward, req.user.id]);
    await pool.query(
      'INSERT INTO transactions(user_id, amount, type, reason) VALUES($1,$2,$3,$4)',
      [req.user.id, reward, 'checkin', `Điểm danh ngày ${streak}`]
    );
    const u = await pool.query('SELECT coins FROM users WHERE id=$1', [req.user.id]);
    res.json({ reward, streak, coins: u.rows[0].coins });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/wallet/transactions
router.get('/transactions', authRequired, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT * FROM transactions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20', [req.user.id]);
    res.json(r.rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/wallet/recharge - nạp demo (không thanh toán thật)
router.post('/recharge', authRequired, async (req, res) => {
  const amount = parseInt(req.body.amount);
  if (![100, 500, 1000].includes(amount)) return res.status(400).json({ message: 'Chọn gói 100/500/1000' });
  try {
    await pool.query('UPDATE users SET coins = coins + $1 WHERE id=$2', [amount, req.user.id]);
    await pool.query(
      'INSERT INTO transactions(user_id, amount, type, reason) VALUES($1,$2,$3,$4)',
      [req.user.id, amount, 'recharge', `Nạp demo +${amount}`]
    );
    const u = await pool.query('SELECT coins FROM users WHERE id=$1', [req.user.id]);
    res.json({ coins: u.rows[0].coins });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/wallet/missions
router.get('/missions', authRequired, async (req, res) => {
  try {
    const out = [];
    for (const m of MISSIONS) {
      const done = await missionDone(req.user.id, m.id);
      const cl = await pool.query(
        'SELECT 1 FROM mission_claims WHERE user_id=$1 AND mission_id=$2 AND claim_date = CURRENT_DATE',
        [req.user.id, m.id]
      );
      out.push({ ...m, completed: done, claimed: cl.rows.length > 0 });
    }
    res.json(out);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/wallet/missions/claim
router.post('/missions/claim', authRequired, async (req, res) => {
  const { mission_id } = req.body;
  const m = MISSIONS.find((x) => x.id === mission_id);
  if (!m) return res.status(400).json({ message: 'Mission không tồn tại' });
  try {
    const done = await missionDone(req.user.id, m.id);
    if (!done) return res.status(400).json({ message: 'Chưa hoàn thành nhiệm vụ' });
    const cl = await pool.query(
      'SELECT 1 FROM mission_claims WHERE user_id=$1 AND mission_id=$2 AND claim_date = CURRENT_DATE',
      [req.user.id, m.id]
    );
    if (cl.rows.length > 0) return res.status(400).json({ message: 'Đã nhận hôm nay' });
    await pool.query('INSERT INTO mission_claims(user_id, mission_id) VALUES($1,$2)', [req.user.id, m.id]);
    await pool.query('UPDATE users SET coins = coins + $1 WHERE id=$2', [m.reward, req.user.id]);
    await pool.query(
      'INSERT INTO transactions(user_id, amount, type, reason) VALUES($1,$2,$3,$4)',
      [req.user.id, m.reward, 'mission', m.title]
    );
    const u = await pool.query('SELECT coins FROM users WHERE id=$1', [req.user.id]);
    res.json({ reward: m.reward, coins: u.rows[0].coins });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/wallet/unlocks/:chapterId
router.get('/unlocks/:chapterId', authRequired, async (req, res) => {
  try {
    const r = await pool.query('SELECT 1 FROM unlocks WHERE user_id=$1 AND chapter_id=$2',
      [req.user.id, req.params.chapterId]);
    res.json({ unlocked: r.rows.length > 0 });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/wallet/unlock {chapter_id}
router.post('/unlock', authRequired, async (req, res) => {
  const chapterId = parseInt(req.body.chapter_id);
  if (!chapterId) return res.status(400).json({ message: 'chapter_id required' });
  try {
    const ch = await pool.query('SELECT * FROM chapters WHERE id=$1', [chapterId]);
    if (ch.rows.length === 0) return res.status(404).json({ message: 'Chapter không tồn tại' });
    const c = ch.rows[0];
    if (!c.is_locked) return res.json({ message: 'Chương miễn phí', coins: null });
    const un = await pool.query('SELECT 1 FROM unlocks WHERE user_id=$1 AND chapter_id=$2', [req.user.id, chapterId]);
    if (un.rows.length > 0) return res.json({ message: 'Đã mở khóa trước đó' });
    const u = await pool.query('SELECT coins FROM users WHERE id=$1', [req.user.id]);
    if ((u.rows[0].coins || 0) < (c.price_coins || 0))
      return res.status(400).json({ message: `Không đủ coins (cần ${c.price_coins})` });
    await pool.query('UPDATE users SET coins = coins - $1 WHERE id=$2', [c.price_coins, req.user.id]);
    await pool.query('INSERT INTO unlocks(user_id, chapter_id) VALUES($1,$2)', [req.user.id, chapterId]);
    await pool.query(
      'INSERT INTO transactions(user_id, amount, type, reason) VALUES($1,$2,$3,$4)',
      [req.user.id, -(c.price_coins || 0), 'unlock', `Mở chương ${c.title}`]
    );
    const u2 = await pool.query('SELECT coins FROM users WHERE id=$1', [req.user.id]);
    res.json({ message: 'Đã mở khóa', coins: u2.rows[0].coins });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/wallet/vote {novel_id} - đề cử miễn phí, mỗi truyện 1 vote/ngày
router.post('/vote', authRequired, async (req, res) => {
  const novelId = parseInt(req.body.novel_id);
  if (!novelId) return res.status(400).json({ message: 'novel_id required' });
  try {
    const ex = await pool.query(
      'SELECT 1 FROM power_votes WHERE user_id=$1 AND novel_id=$2 AND vote_date = CURRENT_DATE',
      [req.user.id, novelId]
    );
    if (ex.rows.length > 0) return res.status(400).json({ message: 'Hôm nay đã đề cử truyện này' });
    await pool.query('INSERT INTO power_votes(user_id, novel_id) VALUES($1,$2)', [req.user.id, novelId]);
    await pool.query('UPDATE novels SET power_votes = power_votes + 1 WHERE id=$1', [novelId]);
    res.json({ message: 'Đã đề cử' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
