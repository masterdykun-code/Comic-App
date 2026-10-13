const jwt = require('jsonwebtoken');
require('dotenv').config();

function authRequired(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ message: 'Missing token' });
  const token = header.split(' ')[1];
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ message: 'Invalid token' });
  }
}

function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ message: 'Missing token' });
  if (req.user.role !== 'admin') return res.status(403).json({ message: 'Cần quyền admin' });
  next();
}

// Parse token nếu có, không có/không hợp lệ vẫn cho qua (dùng cho đếm view chống spam)
function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (header) {
    const token = header.split(' ')[1];
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch {}
  }
  next();
}
module.exports = { authRequired, requireAdmin, optionalAuth };
