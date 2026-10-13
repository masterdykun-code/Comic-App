const express = require('express');
const pool = require('../config/db');
const { authRequired } = require('../middlewares/auth');
const router = express.Router();

router.get('/', authRequired, async (req, res) => {
  const result = await pool.query(`
    SELECT n.*, c.name as category_name, b.created_at as saved_at
    FROM bookshelf b JOIN novels n ON b.novel_id=n.id LEFT JOIN categories c ON n.category_id=c.id
    WHERE b.user_id=$1 ORDER BY b.created_at DESC`, [req.user.id]);
  res.json(result.rows);
});

router.post('/:novelId', authRequired, async (req, res) => {
  try {
    await pool.query('INSERT INTO bookshelf(user_id, novel_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.user.id, req.params.novelId]);
    res.json({ message: 'Added to bookshelf' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.delete('/:novelId', authRequired, async (req, res) => {
  await pool.query('DELETE FROM bookshelf WHERE user_id=$1 AND novel_id=$2', [req.user.id, req.params.novelId]);
  res.json({ message: 'Removed' });
});

module.exports = router;
