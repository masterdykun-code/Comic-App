const express = require('express');
const pool = require('../config/db');
const { authRequired } = require('../middlewares/auth');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const router = express.Router();

// Multer config for cover upload
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(__dirname, '../../uploads');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `cover_${Date.now()}${ext}`);
  }
});
const upload = multer({ storage, limits: { fileSize: 5*1024*1024 }, fileFilter: (req, file, cb) => {
  if (!file.mimetype.startsWith('image/')) return cb(new Error('Only images allowed'));
  cb(null, true);
}});

// GET /api/novels?category=&search=&status=&sort=&period=daily|weekly|monthly&page=1&limit=10
router.get('/', async (req, res) => {
  let { category, search, status, sort, period, page = 1, limit = 10 } = req.query;
  page = parseInt(page) || 1;
  limit = parseInt(limit) || 10;
  if (limit > 50) limit = 50;
  const offset = (page - 1) * limit;

  let where = 'WHERE 1=1';
  const params = [];
  let idx = 1;

  if (category) {
    // hỗ trợ cả name và slug
    where += ` AND (c.name = $${idx} OR c.slug = $${idx})`;
    params.push(category);
    idx++;
  }
  if (status) {
    where += ` AND n.status = $${idx++}`;
    params.push(status);
  }
  if (search) {
    where += ` AND (n.title ILIKE $${idx} OR n.author ILIKE $${idx} OR n.description ILIKE $${idx})`;
    params.push(`%${search}%`);
    idx++;
  }
  // Phase 3: lọc theo thời gian cập nhật để làm BXH ngày/tuần/tháng
  if (period === 'daily') where += ` AND n.updated_at >= NOW() - INTERVAL '1 day'`;
  if (period === 'weekly') where += ` AND n.updated_at >= NOW() - INTERVAL '7 days'`;
  if (period === 'monthly') where += ` AND n.updated_at >= NOW() - INTERVAL '30 days'`;

  let order = 'ORDER BY n.updated_at DESC';
  if (sort === 'ranking' || sort === 'views') order = 'ORDER BY n.total_views DESC';
  if (sort === 'rating') order = 'ORDER BY n.rating DESC';
  if (sort === 'newest') order = 'ORDER BY n.created_at DESC';
  if (sort === 'oldest') order = 'ORDER BY n.created_at ASC';

  // count total
  const countQuery = `SELECT COUNT(*) FROM novels n LEFT JOIN categories c ON n.category_id = c.id ${where}`;
  const dataQuery = `SELECT n.*, c.name as category_name, c.slug as category_slug FROM novels n LEFT JOIN categories c ON n.category_id = c.id ${where} ${order} LIMIT $${idx++} OFFSET $${idx++}`;

  try {
    const countResult = await pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    const dataParams = [...params, limit, offset];
    const result = await pool.query(dataQuery, dataParams);

    res.json({
      data: result.rows,
      pagination: { page, limit, total, totalPages, hasNext: page < totalPages, hasPrev: page > 1 }
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: e.message });
  }
});

// GET /api/novels/featured/banner - top 5 views cho carousel (đặt trước /:id)
router.get('/featured/banner', async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT n.*, c.name as category_name FROM novels n LEFT JOIN categories c ON n.category_id=c.id ORDER BY n.total_views DESC LIMIT 5'
    );
    res.json(r.rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/novels/mine - truyện của tôi (cần auth) - phải đặt trước /:id
router.get('/mine/list', authRequired, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT n.*, c.name as category_name,
        (SELECT COUNT(*) FROM chapters WHERE novel_id=n.id) as chapter_count
       FROM novels n LEFT JOIN categories c ON n.category_id=c.id
       WHERE n.owner_id=$1 ORDER BY n.updated_at DESC`, [req.user.id]);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/novels/mine/stats - dashboard tác giả
router.get('/mine/stats', authRequired, async (req, res) => {
  try {
    const n = await pool.query(
      `SELECT COUNT(*) as total_novels, COALESCE(SUM(total_views),0) as total_views,
        COALESCE(SUM(power_votes),0) as total_votes FROM novels WHERE owner_id=$1`, [req.user.id]);
    const c = await pool.query(
      `SELECT COUNT(*) as total_chapters FROM chapters ch
       JOIN novels n ON ch.novel_id=n.id WHERE n.owner_id=$1`, [req.user.id]);
    const r = await pool.query(
      `SELECT COUNT(*) as total_ratings FROM ratings rt
       JOIN novels n ON rt.novel_id=n.id WHERE n.owner_id=$1`, [req.user.id]);
    res.json({
      total_novels: parseInt(n.rows[0].total_novels),
      total_views: parseInt(n.rows[0].total_views),
      total_votes: parseInt(n.rows[0].total_votes),
      total_chapters: parseInt(c.rows[0].total_chapters),
      total_ratings: parseInt(r.rows[0].total_ratings),
    });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/novels - tạo truyện (cần auth)
router.post('/', authRequired, upload.single('cover'), async (req, res) => {
  const { title, author, description, category_id, status } = req.body;
  if (!title || !author) return res.status(400).json({ message: 'Missing title/author' });
  let cover_url = req.body.cover_url || null;
  if (req.file) {
    cover_url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  }
  try {
    const result = await pool.query(
      'INSERT INTO novels(title, author, description, cover_url, category_id, status, owner_id, owner_username) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [title, author, description, cover_url, category_id || null, status || 'ongoing', req.user.id, req.user.username]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// PUT /api/novels/:id - cập nhật (cần auth + check chủ)
router.put('/:id', authRequired, upload.single('cover'), async (req, res) => {
  const { title, author, description, category_id, status } = req.body;
  try {
    const own = await pool.query('SELECT owner_id FROM novels WHERE id=$1', [req.params.id]);
    if (own.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (own.rows[0].owner_id && own.rows[0].owner_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Không phải truyện của bạn' });
    if (status && !['ongoing', 'completed', 'paused', 'draft'].includes(status))
      return res.status(400).json({ message: 'Status không hợp lệ' });
    let cover_url = req.body.cover_url;
    if (req.file) cover_url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
    // build dynamic update
    const fields = [];
    const vals = [];
    let idx = 1;
    if (title) { fields.push(`title=$${idx++}`); vals.push(title); }
    if (author) { fields.push(`author=$${idx++}`); vals.push(author); }
    if (description !== undefined) { fields.push(`description=$${idx++}`); vals.push(description); }
    if (category_id) { fields.push(`category_id=$${idx++}`); vals.push(category_id); }
    if (status) { fields.push(`status=$${idx++}`); vals.push(status); }
    if (cover_url) { fields.push(`cover_url=$${idx++}`); vals.push(cover_url); }
    fields.push(`updated_at=NOW()`);
    if (fields.length === 1) return res.status(400).json({ message: 'Nothing to update' });
    vals.push(req.params.id);
    const q = `UPDATE novels SET ${fields.join(', ')} WHERE id=$${idx} RETURNING *`;
    const r = await pool.query(q, vals);
    if (r.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE /api/novels/:id (check chủ)
router.delete('/:id', authRequired, async (req, res) => {
  try {
    const own = await pool.query('SELECT owner_id FROM novels WHERE id=$1', [req.params.id]);
    if (own.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (own.rows[0].owner_id && own.rows[0].owner_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Không phải truyện của bạn' });
    await pool.query('DELETE FROM novels WHERE id=$1', [req.params.id]);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/novels/:id
router.get('/:id', async (req, res) => {
  try {
    const result = await pool.query('SELECT n.*, c.name as category_name, c.slug as category_slug FROM novels n LEFT JOIN categories c ON n.category_id=c.id WHERE n.id=$1', [req.params.id]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    await pool.query('UPDATE novels SET total_views = total_views + 1 WHERE id=$1', [req.params.id]);
    // Lấy số chương
    const chapCount = await pool.query('SELECT COUNT(*) FROM chapters WHERE novel_id=$1', [req.params.id]);
    const novel = result.rows[0];
    novel.chapter_count = parseInt(chapCount.rows[0].count);
    res.json(novel);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// GET /api/novels/:id/chapters
router.get('/:id/chapters', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, novel_id, chapter_number, title, views, is_locked, price_coins, created_at FROM chapters WHERE novel_id=$1 ORDER BY chapter_number ASC', [req.params.id]);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// POST /api/novels/:id/chapters - thêm chương (auth + check chủ)
router.post('/:id/chapters', authRequired, async (req, res) => {
  const { title, content, is_locked, price_coins } = req.body;
  if (!title || !content) return res.status(400).json({ message: 'Missing title/content' });
  try {
    const own = await pool.query('SELECT owner_id FROM novels WHERE id=$1', [req.params.id]);
    if (own.rows.length === 0) return res.status(404).json({ message: 'Truyện không tồn tại' });
    if (own.rows[0].owner_id && own.rows[0].owner_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Không phải truyện của bạn' });
    const maxRes = await pool.query('SELECT COALESCE(MAX(chapter_number),0) as max FROM chapters WHERE novel_id=$1', [req.params.id]);
    const nextNum = parseInt(maxRes.rows[0].max) + 1;
    const chapter_number = req.body.chapter_number || nextNum;
    const result = await pool.query('INSERT INTO chapters(novel_id, chapter_number, title, content, is_locked, price_coins) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [req.params.id, chapter_number, title, content, is_locked || false, price_coins || 0]);
    await pool.query('UPDATE novels SET updated_at=NOW() WHERE id=$1', [req.params.id]);
    res.status(201).json(result.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'Chapter number exists' });
    res.status(500).json({ message: e.message });
  }
});

// GET /api/novels/:novelId/chapters/:chapterNumber
router.get('/:novelId/chapters/:chapterNumber', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM chapters WHERE novel_id=$1 AND chapter_number=$2', [req.params.novelId, req.params.chapterNumber]);
    if (result.rows.length === 0) return res.status(404).json({ message: 'Chapter not found' });
    await pool.query('UPDATE chapters SET views = views + 1 WHERE id=$1', [result.rows[0].id]);
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// PUT /api/novels/:novelId/chapters/:chapterNumber - sửa chương (chủ truyện)
router.put('/:novelId/chapters/:chapterNumber', authRequired, async (req, res) => {
  const { title, content, is_locked, price_coins } = req.body;
  try {
    const own = await pool.query('SELECT owner_id FROM novels WHERE id=$1', [req.params.novelId]);
    if (own.rows.length === 0) return res.status(404).json({ message: 'Truyện không tồn tại' });
    if (own.rows[0].owner_id && own.rows[0].owner_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Không phải truyện của bạn' });
    const r = await pool.query(
      `UPDATE chapters SET title=COALESCE($1,title), content=COALESCE($2,content),
        is_locked=COALESCE($3,is_locked), price_coins=COALESCE($4,price_coins)
       WHERE novel_id=$5 AND chapter_number=$6 RETURNING *`,
      [title || null, content || null, is_locked ?? null, price_coins ?? null,
       req.params.novelId, req.params.chapterNumber]
    );
    if (r.rows.length === 0) return res.status(404).json({ message: 'Chapter not found' });
    await pool.query('UPDATE novels SET updated_at=NOW() WHERE id=$1', [req.params.novelId]);
    res.json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE /api/novels/:novelId/chapters/:chapterNumber - xóa chương (chủ truyện)
router.delete('/:novelId/chapters/:chapterNumber', authRequired, async (req, res) => {
  try {
    const own = await pool.query('SELECT owner_id FROM novels WHERE id=$1', [req.params.novelId]);
    if (own.rows.length === 0) return res.status(404).json({ message: 'Truyện không tồn tại' });
    if (own.rows[0].owner_id && own.rows[0].owner_id !== req.user.id && req.user.role !== 'admin')
      return res.status(403).json({ message: 'Không phải truyện của bạn' });
    const r = await pool.query('DELETE FROM chapters WHERE novel_id=$1 AND chapter_number=$2 RETURNING id',
      [req.params.novelId, req.params.chapterNumber]);
    if (r.rows.length === 0) return res.status(404).json({ message: 'Chapter not found' });
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// RATINGS & COMMENTS - Phase 5
// GET /api/novels/:id/ratings
router.get('/:id/ratings', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT r.*, u.username FROM ratings r JOIN users u ON r.user_id=u.id
      WHERE r.novel_id=$1 ORDER BY r.created_at DESC
    `, [req.params.id]);
    const avg = await pool.query('SELECT AVG(score)::numeric(2,1) as avg, COUNT(*) as count FROM ratings WHERE novel_id=$1', [req.params.id]);
    res.json({ ratings: result.rows, avg: avg.rows[0].avg || 0, count: parseInt(avg.rows[0].count) });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/novels/:id/ratings (cần auth)
router.post('/:id/ratings', authRequired, async (req, res) => {
  const { score, comment } = req.body;
  if (!score || score < 1 || score > 5) return res.status(400).json({ message: 'Score 1-5 required' });
  try {
    const result = await pool.query(`
      INSERT INTO ratings(user_id, novel_id, score, comment)
      VALUES($1,$2,$3,$4)
      ON CONFLICT (user_id, novel_id) DO UPDATE SET score=$3, comment=$4, created_at=NOW()
      RETURNING *
    `, [req.user.id, req.params.id, score, comment || null]);
    // cập nhật rating trung bình cho novels
    const avg = await pool.query('SELECT AVG(score)::numeric(2,1) as avg FROM ratings WHERE novel_id=$1', [req.params.id]);
    await pool.query('UPDATE novels SET rating=$1 WHERE id=$2', [avg.rows[0].avg || 0, req.params.id]);
    res.json(result.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// GET /api/novels/:id/comments (kèm likes_count + username, flat để frontend group reply)
router.get('/:id/comments', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT c.*, u.username FROM comments c JOIN users u ON c.user_id=u.id
      WHERE c.novel_id=$1 ORDER BY c.created_at DESC LIMIT 100
    `, [req.params.id]);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/:id/comments', authRequired, async (req, res) => {
  const { content, parent_id } = req.body;
  if (!content || !content.trim()) return res.status(400).json({ message: 'Content required' });
  try {
    if (parent_id) {
      const p = await pool.query('SELECT id FROM comments WHERE id=$1 AND novel_id=$2', [parent_id, req.params.id]);
      if (p.rows.length === 0) return res.status(400).json({ message: 'Parent comment not found' });
    }
    const result = await pool.query(
      'INSERT INTO comments(user_id, novel_id, content, parent_id) VALUES($1,$2,$3,$4) RETURNING *',
      [req.user.id, req.params.id, content.trim(), parent_id || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE /api/novels/comments/:commentId - chỉ chủ comment được xóa
router.delete('/comments/:commentId', authRequired, async (req, res) => {
  try {
    const c = await pool.query('SELECT * FROM comments WHERE id=$1', [req.params.commentId]);
    if (c.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    if (c.rows[0].user_id !== req.user.id && req.user.role !== 'admin') return res.status(403).json({ message: 'Không có quyền xóa' });
    await pool.query('DELETE FROM comments WHERE id=$1', [req.params.commentId]);
    res.json({ message: 'Deleted' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/novels/comments/:commentId/like - toggle like (cần auth)
router.post('/comments/:commentId/like', authRequired, async (req, res) => {
  try {
    const c = await pool.query('SELECT id FROM comments WHERE id=$1', [req.params.commentId]);
    if (c.rows.length === 0) return res.status(404).json({ message: 'Not found' });
    const ex = await pool.query('SELECT * FROM comment_likes WHERE user_id=$1 AND comment_id=$2', [req.user.id, req.params.commentId]);
    if (ex.rows.length > 0) {
      await pool.query('DELETE FROM comment_likes WHERE user_id=$1 AND comment_id=$2', [req.user.id, req.params.commentId]);
      await pool.query('UPDATE comments SET likes_count = GREATEST(0, likes_count - 1) WHERE id=$1', [req.params.commentId]);
      return res.json({ liked: false });
    }
    await pool.query('INSERT INTO comment_likes(user_id, comment_id) VALUES($1,$2)', [req.user.id, req.params.commentId]);
    await pool.query('UPDATE comments SET likes_count = likes_count + 1 WHERE id=$1', [req.params.commentId]);
    res.json({ liked: true });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/novels/:id/reports - báo cáo vi phạm (cần auth, mỗi user 1 report/truyện)
router.post('/:id/reports', authRequired, async (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim() || reason.trim().length < 5)
    return res.status(400).json({ message: 'Nêu lý do ít nhất 5 ký tự' });
  try {
    const r = await pool.query(
      `INSERT INTO reports(user_id, novel_id, reason) VALUES($1,$2,$3)
       ON CONFLICT (user_id, novel_id) DO UPDATE SET reason=$3, status='pending', created_at=NOW()
       RETURNING *`,
      [req.user.id, req.params.id, reason.trim()]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
