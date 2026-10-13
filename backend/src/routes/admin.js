const express = require('express');
const pool = require('../config/db');
const { authRequired, requireAdmin } = require('../middlewares/auth');
const router = express.Router();

router.use(authRequired, requireAdmin);

// GET /api/admin/stats - tổng quan cho slide bảo vệ
router.get('/stats', async (req, res) => {
  try {
    const [u, n, c, cm, tx] = await Promise.all([
      pool.query('SELECT COUNT(*) as c FROM users'),
      pool.query('SELECT COUNT(*) as c, COALESCE(SUM(total_views),0) as views FROM novels'),
      pool.query('SELECT COUNT(*) as c FROM chapters'),
      pool.query('SELECT COUNT(*) as c FROM comments'),
      pool.query('SELECT COALESCE(SUM(amount),0) as coins FROM transactions WHERE amount > 0'),
    ]);
    res.json({
      users: parseInt(u.rows[0].c),
      novels: parseInt(n.rows[0].c),
      total_views: parseInt(n.rows[0].views),
      chapters: parseInt(c.rows[0].c),
      comments: parseInt(cm.rows[0].c),
      coins_issued: parseInt(tx.rows[0].coins),
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/admin/novels - tất cả truyện kèm chủ
router.get('/novels', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT n.*, c.name as category_name, u.username as owner_name,
        (SELECT COUNT(*) FROM chapters WHERE novel_id=n.id) as chapter_count
       FROM novels n LEFT JOIN categories c ON n.category_id=c.id
       LEFT JOIN users u ON n.owner_id=u.id ORDER BY n.id DESC LIMIT 50`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE /api/admin/novels/:id - admin xóa mọi truyện
router.delete('/novels/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM novels WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/admin/users
router.get('/users', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id, username, email, coins, role, created_at FROM users ORDER BY id ASC LIMIT 50');
    res.json(r.rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PUT /api/admin/users/:id/role - cấp/hạ quyền (không tự hạ chính mình)
router.put('/users/:id/role', async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) return res.status(400).json({ message: 'Role admin|user' });
  if (parseInt(req.params.id) === req.user.id && role !== 'admin')
    return res.status(400).json({ message: 'Không tự hạ quyền chính mình' });
  try {
    const r = await pool.query('UPDATE users SET role=$1 WHERE id=$2 RETURNING id, username, email, role',
      [role, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/admin/reports - duyệt báo cáo
router.get('/reports', async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT rp.*, u.username, n.title as novel_title FROM reports rp
       JOIN users u ON rp.user_id=u.id JOIN novels n ON rp.novel_id=n.id
       ORDER BY CASE WHEN rp.status='pending' THEN 0 ELSE 1 END, rp.created_at DESC LIMIT 50`
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PUT /api/admin/reports/:id - duyệt/bỏ qua {status: resolved|dismissed}
router.put('/reports/:id', async (req, res) => {
  const { status } = req.body;
  if (!['resolved', 'dismissed'].includes(status)) return res.status(400).json({ message: 'Status resolved|dismissed' });
  try {
    const r = await pool.query('UPDATE reports SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
