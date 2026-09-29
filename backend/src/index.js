require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const pool = require('./config/db');

const app = express();
app.use(cors());
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(morgan('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(require('path').join(__dirname, '../uploads')));

app.get('/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use('/api/auth', require('./routes/auth'));
app.use('/api/novels', require('./routes/novels'));
app.use('/api/categories', require('./routes/categories'));
app.use('/api/bookshelf', require('./routes/bookshelf'));
app.use('/api/history', require('./routes/history'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/admin', require('./routes/admin'));

app.get('/', (req, res) => res.send('WebNovel API running. See /health'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Backend listening on http://localhost:${PORT}`);
});

// test DB on startup
pool.query('SELECT NOW()').then(r => console.log('DB time', r.rows[0].now)).catch(e => console.error('DB connect failed', e.message));
