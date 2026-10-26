const { networkInterfaces } = require('node:os');
const marker = 'android_demo_v1';
const id = (n) => `16300000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = {
  users: [id(1), id(2)],
  genres: [id(3), id(4)],
  stories: [id(5), id(6)],
  chapters: [id(7), id(8), id(9), id(10)],
  chapter_pages: Array.from({ length: 6 }, (_, i) => id(11 + i)),
};
function validateHost(host, interfaces = networkInterfaces()) {
  if (
    !Object.values(interfaces)
      .flat()
      .some((x) => x && x.family === 'IPv4' && !x.internal && x.address === host) ||
    !/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(host)
  )
    throw new Error('LAN_HOST_REQUIRED');
  return host;
}
async function identity(db) {
  const r = await db.query('SELECT current_database() AS name, current_schema() AS schema');
  if (r.rows[0]?.name !== 'webnovel_test_db' || r.rows[0]?.schema !== 'public')
    throw new Error('TEST_DATABASE_REQUIRED');
}
async function inventory(db) {
  await identity(db);
  const tables = Object.keys(ids).concat([
    'story_genres',
    'favorites',
    'reading_progress',
    'reading_history',
    'ratings',
    'comments',
    'auth_sessions',
    'refresh_tokens',
  ]);
  const rows = {};
  // Only identity/reference columns; never retrieve password hashes or tokens.
  const columns = {
    users: 'id,username,email,role',
    genres: 'id,slug',
    stories: 'id,slug,created_by',
    chapters: 'id,story_id',
    chapter_pages: 'id,chapter_id',
    story_genres: 'story_id,genre_id',
    auth_sessions: 'id,user_id',
    refresh_tokens: 'id,session_id',
    comments: 'id,user_id,story_id,parent_id',
  };
  for (const t of tables)
    rows[t] = (
      await db.query(`SELECT ${columns[t] || 'id,user_id,story_id'} FROM public."${t}"`)
    ).rows;
  const has = (t, value) => ids[t].includes(value);
  for (const t of tables)
    for (const r of rows[t]) {
      let valid;
      if (t === 'users')
        valid =
          has(t, r.id) &&
          r.username === `${marker}_${r.id === id(1) ? 'admin' : 'user'}` &&
          r.email === `${r.username}@example.invalid` &&
          r.role === (r.id === id(1) ? 'ADMIN' : 'USER');
      else if (t === 'genres')
        valid = has(t, r.id) && r.slug === `${marker}-${r.id === id(3) ? 'fantasy' : 'adventure'}`;
      else if (t === 'stories')
        valid =
          has(t, r.id) &&
          r.created_by === id(1) &&
          r.slug === `${marker}-${r.id === id(5) ? 'novel' : 'comic'}`;
      else if (t === 'chapters')
        valid = has(t, r.id) && r.story_id === (ids.chapters.indexOf(r.id) < 2 ? id(5) : id(6));
      else if (t === 'chapter_pages')
        valid =
          has(t, r.id) && r.chapter_id === (ids.chapter_pages.indexOf(r.id) < 3 ? id(9) : id(10));
      else if (t === 'story_genres')
        valid = has('stories', r.story_id) && has('genres', r.genre_id);
      else if (t === 'auth_sessions') valid = has('users', r.user_id);
      else if (t === 'refresh_tokens')
        valid = rows.auth_sessions.some((s) => s.id === r.session_id);
      else
        valid =
          has('users', r.user_id) &&
          has('stories', r.story_id) &&
          (!r.parent_id ||
            rows.comments.some((c) => c.id === r.parent_id && c.story_id === r.story_id));
      if (!valid) throw new Error('FOREIGN_DATA_REFUSED');
    }
  const count = Object.values(rows).reduce((n, r) => n + r.length, 0);
  const complete =
    Object.entries(ids).every(([t, values]) => rows[t].length === values.length) &&
    rows.story_genres.length === 2;
  if (count && !complete) throw new Error('PARTIAL_FIXTURE_REFUSED');
  return { rows, count, complete };
}
async function write(db, sql, values) {
  await identity(db);
  return db.query(sql, values);
}
async function transaction(db, work) {
  await identity(db);
  await db.query('BEGIN');
  try {
    await db.query(
      `LOCK TABLE ${Object.keys(ids)
        .concat([
          'story_genres',
          'favorites',
          'reading_progress',
          'reading_history',
          'ratings',
          'comments',
          'auth_sessions',
          'refresh_tokens',
        ])
        .map((t) => `public."${t}"`)
        .join(',')} IN SHARE ROW EXCLUSIVE MODE`,
    );
    const result = await work();
    await db.query('COMMIT');
    return result;
  } catch (e) {
    await db.query('ROLLBACK');
    throw e;
  }
}
async function seed(db, base, hashes) {
  return transaction(db, async () => {
    const state = await inventory(db);
    if (state.complete) return { created: 0, existing: true };
    for (let i = 0; i < 2; i++) {
      const username = `${marker}_${i === 0 ? 'admin' : 'user'}`;
      await write(
        db,
        "INSERT INTO users(id,username,email,password_hash,display_name,role,status) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE')",
        [
          ids.users[i],
          username,
          `${username}@example.invalid`,
          hashes[i],
          i === 0 ? 'Demo quản trị' : 'Bạn đọc demo',
          i === 0 ? 'ADMIN' : 'USER',
        ],
      );
      await write(db, 'INSERT INTO genres(id,name,slug) VALUES($1,$2,$3)', [
        ids.genres[i],
        i === 0 ? 'Demo · Kỳ ảo' : 'Demo · Phiêu lưu',
        `${marker}-${i === 0 ? 'fantasy' : 'adventure'}`,
      ]);
      await write(
        db,
        `INSERT INTO stories(id,title,slug,type,author_name,description,cover_url,publish_status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,'PUBLISHED',$8)`,
        [
          ids.stories[i],
          i === 0 ? 'Khu vườn trong gió' : 'Chuyến tàu sắc màu',
          `${marker}-${i === 0 ? 'novel' : 'comic'}`,
          i === 0 ? 'NOVEL' : 'COMIC',
          'WebNovel demo',
          'Nội dung demo tự tạo, không phải tác phẩm thương mại.',
          `${base}/__demo__/cover.png`,
          id(1),
        ],
      );
      await write(db, 'INSERT INTO story_genres(story_id,genre_id) VALUES($1,$2)', [
        ids.stories[i],
        ids.genres[i],
      ]);
    }
    for (let i = 0; i < 4; i++) {
      const content =
        i < 2
          ? `Chương ${i + 1}: Khu vườn trong gió\n\nBuổi sáng, An mở cửa sổ.\nÁnh nắng trải trên những chiếc lá xanh.\n\n` +
            Array.from(
              { length: 80 },
              (_, n) =>
                `Đoạn ${n + 1}: An bước theo con đường nhỏ, lắng nghe tiếng chim và ghi lại một câu chuyện mới.\n`,
            ).join('')
          : null;
      await write(
        db,
        `INSERT INTO chapters(id,story_id,chapter_number,title,content,publish_status) VALUES($1,$2,$3,$4,$5,'PUBLISHED')`,
        [
          ids.chapters[i],
          ids.stories[i < 2 ? 0 : 1],
          (i % 2) + 1,
          `Chương ${(i % 2) + 1}`,
          content,
        ],
      );
    }
    for (let i = 0; i < 6; i++)
      await write(
        db,
        'INSERT INTO chapter_pages(id,chapter_id,page_number,image_url) VALUES($1,$2,$3,$4)',
        [
          ids.chapter_pages[i],
          ids.chapters[i < 3 ? 2 : 3],
          (i % 3) + 1,
          `${base}/__demo__/page-${i + 1}.png`,
        ],
      );
    return { created: 18, existing: false };
  });
}
async function cleanup(db) {
  return transaction(db, async () => {
    const state = await inventory(db);
    if (!state.count) return { deleted: 0 };
    // Ownership verified above; every DELETE is explicitly restricted to fixture references.
    await write(
      db,
      'DELETE FROM refresh_tokens WHERE session_id IN (SELECT id FROM auth_sessions WHERE user_id=ANY($1::uuid[]))',
      [ids.users],
    );
    await write(db, 'DELETE FROM auth_sessions WHERE user_id=ANY($1::uuid[])', [ids.users]);
    for (const t of ['comments', 'ratings', 'favorites', 'reading_progress', 'reading_history'])
      await write(
        db,
        `DELETE FROM "${t}" WHERE user_id=ANY($1::uuid[]) AND story_id=ANY($2::uuid[])`,
        [ids.users, ids.stories],
      );
    await write(db, 'DELETE FROM chapter_pages WHERE id=ANY($1::uuid[])', [ids.chapter_pages]);
    await write(db, 'DELETE FROM chapters WHERE id=ANY($1::uuid[])', [ids.chapters]);
    await write(
      db,
      'DELETE FROM story_genres WHERE story_id=ANY($1::uuid[]) AND genre_id=ANY($2::uuid[])',
      [ids.stories, ids.genres],
    );
    for (const t of ['stories', 'genres', 'users'])
      await write(db, `DELETE FROM "${t}" WHERE id=ANY($1::uuid[])`, [ids[t]]);
    if ((await inventory(db)).count) throw new Error('CLEANUP_INCOMPLETE');
    return { deleted: state.count };
  });
}
module.exports = { marker, ids, id, validateHost, identity, inventory, seed, cleanup };
