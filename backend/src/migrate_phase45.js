const pool = require('./config/db');

const sql = `
-- Thêm owner cho novels để biết ai tạo (Phase 4)
ALTER TABLE novels ADD COLUMN IF NOT EXISTS owner_id INT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE novels ADD COLUMN IF NOT EXISTS owner_username VARCHAR(50);

-- Đảm bảo ratings có comment (đã có)
-- Thêm index cho search
CREATE INDEX IF NOT EXISTS idx_novels_title ON novels(title);
CREATE INDEX IF NOT EXISTS idx_novels_author ON novels(author);

-- Thêm bảng comments riêng nếu muốn tách khỏi ratings (optional, dùng ratings luôn)
CREATE TABLE IF NOT EXISTS comments (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  novel_id INT REFERENCES novels(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Phase 4 Social: reply + like bình luận
ALTER TABLE comments ADD COLUMN IF NOT EXISTS parent_id INT REFERENCES comments(id) ON DELETE CASCADE;
ALTER TABLE comments ADD COLUMN IF NOT EXISTS likes_count INT DEFAULT 0;
CREATE TABLE IF NOT EXISTS comment_likes (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  comment_id INT REFERENCES comments(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, comment_id)
);

-- Phase 5 Coins / Nhiệm vụ / Unlock / Vote
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(20) DEFAULT 'user';
ALTER TABLE novels ADD COLUMN IF NOT EXISTS power_votes INT DEFAULT 0;
CREATE TABLE IF NOT EXISTS checkins (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  checkin_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, checkin_date)
);
CREATE TABLE IF NOT EXISTS transactions (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  amount INT NOT NULL,
  type VARCHAR(30) NOT NULL,
  reason TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS unlocks (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  chapter_id INT REFERENCES chapters(id) ON DELETE CASCADE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, chapter_id)
);
CREATE TABLE IF NOT EXISTS mission_claims (
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  mission_id VARCHAR(50) NOT NULL,
  claim_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, mission_id, claim_date)
);
CREATE TABLE IF NOT EXISTS power_votes (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  novel_id INT REFERENCES novels(id) ON DELETE CASCADE,
  vote_date DATE NOT NULL DEFAULT CURRENT_DATE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Final: báo cáo vi phạm để admin kiểm duyệt
CREATE TABLE IF NOT EXISTS reports (
  id SERIAL PRIMARY KEY,
  user_id INT REFERENCES users(id) ON DELETE CASCADE,
  novel_id INT REFERENCES novels(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status VARCHAR(20) DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, novel_id)
);
`;

async function migrate() {
  try {
    await pool.query(sql);
    console.log('✅ Phase 4/5 migration done');
  } catch (e) { console.error(e); } finally { await pool.end(); }
}
migrate();
