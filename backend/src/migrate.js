const pool = require('./config/db');

const sql = `
-- USERS
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  username VARCHAR(50) UNIQUE NOT NULL,
  email VARCHAR(100) UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  avatar_url TEXT,
  coins INT DEFAULT 0,
  role VARCHAR(20) DEFAULT 'user',
  created_at TIMESTAMP DEFAULT NOW()
);

-- CATEGORIES
CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) UNIQUE NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL
);

-- NOVELS
CREATE TABLE IF NOT EXISTS novels (
  id SERIAL PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  author VARCHAR(100) NOT NULL,
  description TEXT,
  cover_url TEXT,
  category_id INT REFERENCES categories(id) ON DELETE SET NULL,
  status VARCHAR(20) DEFAULT 'ongoing', -- ongoing, completed, paused
  total_views INT DEFAULT 0,
  rating DECIMAL(2,1) DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- CHAPTERS
CREATE TABLE IF NOT EXISTS chapters (
  id SERIAL PRIMARY KEY,
  novel_id INT REFERENCES novels(id) ON DELETE CASCADE,
  chapter_number INT NOT NULL,
  title VARCHAR(255) NOT NULL,
  content TEXT NOT NULL,
  views INT DEFAULT 0,
  is_locked BOOLEAN DEFAULT FALSE,
  price_coins INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(novel_id, chapter_number)
);

-- BOOKSHELF (tủ sách)
CREATE TABLE IF NOT EXISTS bookshelf (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  novel_id INT REFERENCES novels(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, novel_id)
);

-- READING HISTORY
CREATE TABLE IF NOT EXISTS reading_history (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  novel_id INT REFERENCES novels(id) ON DELETE CASCADE,
  chapter_id INT REFERENCES chapters(id) ON DELETE SET NULL,
  last_read_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, novel_id)
);

-- RATINGS / BOOKMARKS
CREATE TABLE IF NOT EXISTS ratings (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  novel_id INT REFERENCES novels(id) ON DELETE CASCADE,
  score INT CHECK(score >=1 AND score <=5),
  comment TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, novel_id)
);
`;

async function migrate() {
  try {
    await pool.query(sql);
    console.log('✅ Migration done');
  } catch (e) {
    console.error('❌ Migration failed', e);
  } finally {
    await pool.end();
  }
}
migrate();
