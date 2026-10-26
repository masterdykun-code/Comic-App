const demo = jest.requireActual('../scripts/demo/core.cjs');
function database(name = 'webnovel_test_db', rows: Record<string, object[]> = {}) {
  return {
    query: jest.fn(async (sql: string) => {
      if (sql.startsWith('SELECT current_database')) return { rows: [{ name, schema: 'public' }] };
      const table = /FROM public\."([^"]+)"/.exec(sql)?.[1];
      return { rows: table ? (rows[table] ?? []) : [] };
    }),
  };
}
test('demo refuses main database before INSERT or DELETE', async () => {
  for (const operation of ['seed', 'cleanup']) {
    const db = database('webnovel_db');
    await expect(demo[operation](db, 'http://192.168.1.43:4001', ['hash', 'hash'])).rejects.toThrow(
      'TEST_DATABASE_REQUIRED',
    );
    expect(db.query.mock.calls.some(([sql]) => /INSERT|DELETE|BEGIN/.test(sql))).toBe(false);
  }
});
test('foreign records refuse seed and cleanup and roll back without data writes', async () => {
  for (const operation of ['seed', 'cleanup']) {
    const db = database('webnovel_test_db', { users: [{ id: 'foreign', username: 'real' }] });
    await expect(demo[operation](db, 'http://192.168.1.43:4001', ['hash', 'hash'])).rejects.toThrow(
      'FOREIGN_DATA_REFUSED',
    );
    expect(db.query.mock.calls.some(([sql]) => /^(INSERT|DELETE)/.test(sql))).toBe(false);
    expect(db.query).toHaveBeenCalledWith('ROLLBACK');
  }
});
test('partial demo refuses repair or cleanup automatically', async () => {
  const db = database('webnovel_test_db', {
    genres: [{ id: demo.id(3), slug: 'android_demo_v1-fantasy' }],
  });
  await expect(demo.inventory(db)).rejects.toThrow('PARTIAL_FIXTURE_REFUSED');
});
test('empty fixture seed creates 18 parameterized rows with a guard before each INSERT', async () => {
  const db = database();
  await expect(
    demo.seed(db, 'http://192.168.1.43:4001', ['admin-hash', 'user-hash']),
  ).resolves.toEqual({ created: 18, existing: false });
  const calls = db.query.mock.calls;
  const inserts = calls.filter(([sql]) => sql.startsWith('INSERT'));
  expect(inserts).toHaveLength(18);
  for (let i = 0; i < calls.length; i++)
    if (calls[i][0].startsWith('INSERT'))
      expect(calls[i - 1][0]).toContain('SELECT current_database');
  expect(calls.at(-1)?.[0]).toBe('COMMIT');
  expect(inserts.some(([sql]) => sql.includes('admin-hash') || sql.includes('user-hash'))).toBe(
    false,
  );
});
test('empty cleanup is a no-op, never a whole database reset', async () => {
  const db = database();
  await expect(demo.cleanup(db)).resolves.toEqual({ deleted: 0 });
  expect(db.query.mock.calls.some(([sql]) => /DELETE|DROP|TRUNCATE/.test(sql))).toBe(false);
});
test('completed demo seed is idempotent and never overwrites credentials', async () => {
  const id = demo.id;
  const rows = {
    users: [1, 2].map((n) => ({
      id: id(n),
      username: `android_demo_v1_${n === 1 ? 'admin' : 'user'}`,
      email: `android_demo_v1_${n === 1 ? 'admin' : 'user'}@example.invalid`,
      role: n === 1 ? 'ADMIN' : 'USER',
    })),
    genres: [3, 4].map((n) => ({
      id: id(n),
      slug: `android_demo_v1-${n === 3 ? 'fantasy' : 'adventure'}`,
    })),
    stories: [5, 6].map((n) => ({
      id: id(n),
      slug: `android_demo_v1-${n === 5 ? 'novel' : 'comic'}`,
      created_by: id(1),
    })),
    chapters: [7, 8, 9, 10].map((n) => ({ id: id(n), story_id: id(n < 9 ? 5 : 6) })),
    chapter_pages: [11, 12, 13, 14, 15, 16].map((n) => ({
      id: id(n),
      chapter_id: id(n < 14 ? 9 : 10),
    })),
    story_genres: [
      { story_id: id(5), genre_id: id(3) },
      { story_id: id(6), genre_id: id(4) },
    ],
  };
  const db = database('webnovel_test_db', rows);
  await expect(demo.seed(db, 'http://192.168.1.43:4001', [])).resolves.toEqual({
    created: 0,
    existing: true,
  });
  expect(db.query.mock.calls.some(([sql]) => /INSERT|UPDATE|DELETE/.test(sql))).toBe(false);
});
test('failed insertion rolls back without committing', async () => {
  const db = database();
  const query = db.query.getMockImplementation()!;
  db.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith('INSERT')) throw new Error('simulated write failure');
    return query(sql);
  });
  await expect(demo.seed(db, 'http://192.168.1.43:4001', ['hash', 'hash'])).rejects.toThrow(
    'simulated write failure',
  );
  expect(db.query).toHaveBeenCalledWith('ROLLBACK');
  expect(db.query).not.toHaveBeenCalledWith('COMMIT');
});
test('LAN host must belong to a private local IPv4 adapter', () => {
  const interfaces = { wifi: [{ family: 'IPv4', internal: false, address: '192.168.1.43' }] };
  expect(demo.validateHost('192.168.1.43', interfaces)).toBe('192.168.1.43');
  for (const host of ['localhost', '127.0.0.1', '192.168.1.99', '8.8.8.8'])
    expect(() => demo.validateHost(host, interfaces)).toThrow('LAN_HOST_REQUIRED');
});
