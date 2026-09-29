const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const router = express.Router();

router.post('/register', async (req, res) => {
  const { username, email, password } = req.body;
  if (!username || !email || !password) return res.status(400).json({ message: 'Thiếu username/email/password' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const result = await pool.query('INSERT INTO users(username,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id, username, email, role, coins', [username, email, hash, 'user']);
    res.json(result.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'Username hoặc email đã tồn tại' });
    res.status(500).json({ message: e.message });
  }
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query('SELECT * FROM users WHERE email=$1', [email]);
    if (result.rows.length === 0) return res.status(401).json({ message: 'Email hoặc mật khẩu sai' });
    const user = result.rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ message: 'Email hoặc mật khẩu sai' });
    const token = jwt.sign({ id: user.id, username: user.username, role: user.role || 'user' }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ token, user: { id: user.id, username: user.username, email: user.email, coins: user.coins, role: user.role || 'user' } });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/me', require('../middlewares/auth').authRequired, async (req, res) => {
  const result = await pool.query('SELECT id, username, email, coins, avatar_url, role, created_at FROM users WHERE id=$1', [req.user.id]);
  res.json(result.rows[0]);
});

// PUT /api/auth/me - sửa profile (username, avatar_url)
router.put('/me', require('../middlewares/auth').authRequired, async (req, res) => {
  const { username, avatar_url } = req.body;
  try {
    if (username && (username.length < 3 || username.length > 50))
      return res.status(400).json({ message: 'Username 3-50 ký tự' });
    const r = await pool.query(
      'UPDATE users SET username=COALESCE($1,username), avatar_url=COALESCE($2,avatar_url) WHERE id=$3 RETURNING id, username, email, coins, avatar_url, role',
      [username || null, avatar_url || null, req.user.id]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ message: 'Username đã tồn tại' });
    res.status(500).json({ message: e.message });
  }
});

// PUT /api/auth/password - đổi mật khẩu
router.put('/password', require('../middlewares/auth').authRequired, async (req, res) => {
  const { old_password, new_password } = req.body;
  if (!old_password || !new_password || new_password.length < 6)
    return res.status(400).json({ message: 'Mật khẩu mới tối thiểu 6 ký tự' });
  try {
    const r = await pool.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const ok = await bcrypt.compare(old_password, r.rows[0].password_hash);
    if (!ok) return res.status(400).json({ message: 'Mật khẩu cũ sai' });
    const hash = await bcrypt.hash(new_password, 10);
    await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [hash, req.user.id]);
    res.json({ message: 'Đã đổi mật khẩu' });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
