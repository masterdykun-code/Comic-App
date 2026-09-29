const express = require('express');
const pool = require('../config/db');
const { authRequired } = require('../middlewares/auth');
const router = express.Router();

// GET /api/history - lịch sử đọc của user
router.get('/', authRequired, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT h.*, n.title, n.cover_url, n.author, c.name as category_name,
             ch.title as chapter_title, ch.chapter_number
      FROM reading_history h
      JOIN novels n ON h.novel_id=n.id
      LEFT JOIN categories c ON n.category_id=c.id
      LEFT JOIN chapters ch ON h.chapter_id=ch.id
      WHERE h.user_id=$1 ORDER BY h.last_read_at DESC
    `, [req.user.id]);
    res.json(result.rows);
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// POST /api/history - cập nhật lịch sử
router.post('/', authRequired, async (req, res) => {
  const { novel_id, chapter_id } = req.body;
  if (!novel_id) return res.status(400).json({ message: 'novel_id required' });
  try {
    await pool.query(`
      INSERT INTO reading_history(user_id, novel_id, chapter_id, last_read_at)
      VALUES($1,$2,$3,NOW())
      ON CONFLICT (user_id, novel_id) DO UPDATE SET chapter_id=$3, last_read_at=NOW()
    `, [req.user.id, novel_id, chapter_id || null]);
    res.json({ message: 'History updated' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// DELETE /api/history/:novelId
router.delete('/:novelId', authRequired, async (req, res) => {
  await pool.query('DELETE FROM reading_history WHERE user_id=$1 AND novel_id=$2', [req.user.id, req.params.novelId]);
  res.json({ message: 'Deleted' });
});

module.exports = router;
