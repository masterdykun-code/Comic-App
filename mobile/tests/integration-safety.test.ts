const mockAssertPrisma = jest.fn(async () => {});
const mockAssertDatabase = jest.fn(async () => {});
const mockAssertEmpty = jest.fn(async () => {});
jest.mock('../scripts/integration/safety.cjs', () => ({
  backendRequire: () => ({ assertPrismaTest: mockAssertPrisma, runPrefix: () => 'e2e_safe_' }),
  assertTestDatabase: mockAssertDatabase,
  assertEmpty: mockAssertEmpty,
  APP_TABLES: ['users'],
}));
const { cleanup } = jest.requireActual('../scripts/integration/fixtures.cjs');
function fixture() {
  const remove = jest.fn(async () => ({}));
  const tx = {
    $queryRawUnsafe: jest.fn(async () => [{ name: 'webnovel_test_db', schema: 'public' }]),
    user: {
      findMany: jest.fn(async () => [
        { id: 'owned', username: 'e2e_safe_reader', email: 'e2e_safe_reader@example.invalid' },
      ]),
      deleteMany: remove,
    },
    story: {
      findMany: jest.fn(async () => [{ id: 'story', createdBy: 'owned', title: 'e2e_safe_NOVEL' }]),
      deleteMany: remove,
    },
    genre: { findMany: jest.fn(async () => [{ id: 'genre' }]), deleteMany: remove },
    chapter: { findMany: jest.fn(async () => [{ id: 'chapter' }]), deleteMany: remove },
    chapterPage: { findMany: jest.fn(async () => [{ id: 'page' }]), deleteMany: remove },
    comment: {
      findMany: jest.fn(async () => [{ userId: 'owned', storyId: 'story' }]),
      deleteMany: remove,
    },
    rating: { findMany: jest.fn(async () => []), deleteMany: remove },
    favorite: { findMany: jest.fn(async () => []), deleteMany: remove },
    readingHistory: { findMany: jest.fn(async () => []), deleteMany: remove },
    readingProgress: { findMany: jest.fn(async () => []), deleteMany: remove },
    storyGenre: { deleteMany: remove },
    refreshToken: { deleteMany: remove },
    authSession: { deleteMany: remove },
  };
  const db = { $transaction: jest.fn(async (work) => work(tx)) };
  const manifest = {
    storyIds: ['story'],
    chapterIds: ['chapter'],
    pageIds: ['page'],
    genre: { id: 'genre' },
  };
  return { tx, db, manifest, remove };
}
beforeEach(() => jest.clearAllMocks());
test.each(['users', 'genres', 'chapters', 'pages', 'interactions'])(
  'cleanup refuses unknown %s before issuing any delete',
  async (kind) => {
    const { tx, db, manifest, remove } = fixture();
    if (kind === 'users')
      tx.user.findMany.mockResolvedValue([
        { id: 'foreign', username: 'real', email: 'real@example.invalid' },
      ]);
    if (kind === 'genres') tx.genre.findMany.mockResolvedValue([{ id: 'foreign' }]);
    if (kind === 'chapters') tx.chapter.findMany.mockResolvedValue([{ id: 'foreign' }]);
    if (kind === 'pages') tx.chapterPage.findMany.mockResolvedValue([{ id: 'foreign' }]);
    if (kind === 'interactions')
      tx.comment.findMany.mockResolvedValue([{ userId: 'foreign', storyId: 'story' }]);
    await expect(cleanup(db, {}, 'a'.repeat(16), manifest)).rejects.toThrow(/cleanup refused/);
    expect(remove).not.toHaveBeenCalled();
    expect(mockAssertDatabase).toHaveBeenCalled();
    expect(mockAssertPrisma).toHaveBeenCalled();
  },
);
test('cleanup refuses a primary database connection inside the transaction before deleting', async () => {
  const { tx, db, manifest, remove } = fixture();
  tx.$queryRawUnsafe.mockResolvedValue([{ name: 'webnovel_db', schema: 'public' }]);
  await expect(cleanup(db, {}, 'a'.repeat(16), manifest)).rejects.toThrow(/target refused/);
  expect(remove).not.toHaveBeenCalled();
});
