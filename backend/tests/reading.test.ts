import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createAuthService } from '../src/services/auth.service';
import { createFavoriteService } from '../src/services/favorite.service';
import { createReadingProgressService } from '../src/services/reading-progress.service';
import { createReadingHistoryService, HISTORY_DEDUP_MS } from '../src/services/reading-history.service';
import { createFavoriteRouter } from '../src/routes/favorite.routes';
import { createReadingProgressRouter } from '../src/routes/reading-progress.routes';
import { createReadingHistoryRouter } from '../src/routes/reading-history.routes';
import { errorHandler, notFoundHandler } from '../src/middlewares/error-handler';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { MemoryReadingStore } from './helpers/memory-reading.store';
import { hashPassword } from '../src/utils/password';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
const novel = '10000000-0000-4000-8000-000000000001';
const comic = '10000000-0000-4000-8000-000000000002';
const draftStory = '10000000-0000-4000-8000-000000000003';
const novelChapter = '20000000-0000-4000-8000-000000000001';
const comicChapter = '20000000-0000-4000-8000-000000000002';
const draftChapter = '20000000-0000-4000-8000-000000000003';
const unknown = '30000000-0000-4000-8000-000000000001';
const f = '/api/me/favorites'; const p = '/api/me/reading-progress'; const h = '/api/me/reading-history';
const novelInput = { chapterId: novelChapter, progressPercent: 25.25, expectedUpdatedAt: null, textOffset: 5 };
const comicInput = { chapterId: comicChapter, progressPercent: 50, expectedUpdatedAt: null, pageNumber: 2, scrollOffset: 100 };

async function setup() {
  const authStore = new MemoryAuthStore();
  const auth = createAuthService(authStore);
  const token: Record<string, string> = {};
  const userIds: Record<string, string> = {};
  for (const name of ['user', 'other', 'admin']) {
    const user = await authStore.createUser({ username: name, email: `${name}@example.test`, passwordHash: '', displayName: name });
    if (name === 'admin') user.role = 'ADMIN';
    userIds[name] = user.id;
    // Token generation uses the real service; test-only plaintext/hash never reaches PostgreSQL.
    user.passwordHash = await hashPassword('Test-password-123');
    token[name] = (await auth.login(user.email, 'Test-password-123')).accessToken;
  }
  const store = new MemoryReadingStore(authStore);
  for (const [id, type, status] of [[novel, 'NOVEL', 'PUBLISHED'], [comic, 'COMIC', 'PUBLISHED'], [draftStory, 'NOVEL', 'DRAFT']] as const) {
    store.stories.set(id, { id, title: type + id.slice(-1), slug: id, coverUrl: 'https://example.test/cover.png', authorName: 'Test author', type, publishStatus: status });
  }
  for (const [id, storyId, type, status] of [[novelChapter, novel, 'NOVEL', 'PUBLISHED'], [comicChapter, comic, 'COMIC', 'PUBLISHED'], [draftChapter, novel, 'NOVEL', 'DRAFT']] as const) {
    store.chapters.set(id, { id, storyId, chapterNumber: status === 'DRAFT' ? 2 : 1, title: 'Chapter', content: type === 'NOVEL' ? 'Example novel text 😀' : null,
      isVip: false, coinPrice: 10, publishStatus: status, createdAt: new Date(), updatedAt: new Date(), pages: type === 'NOVEL' ? [] : [1, 2].map((pageNumber) => ({
        id: randomUUID(), chapterId: id, pageNumber, imageUrl: `https://example.test/${pageNumber}.png`, storagePublicId: null, createdAt: new Date(),
      })) });
  }
  let now = Date.now();
  const favorite = createFavoriteService(store);
  const progress = createReadingProgressService(store, () => now);
  const history = createReadingHistoryService(store, () => now);
  const app = express(); app.use(express.json({ limit: '16kb' }));
  app.use(f, createFavoriteRouter(favorite, auth));
  app.use(p, createReadingProgressRouter(progress, auth));
  app.use(h, createReadingHistoryRouter(history, auth));
  app.use(notFoundHandler); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const request = async (url: string, method = 'GET', body?: unknown, actor = 'user') => {
    const response = await fetch(`http://127.0.0.1:${address.port}${url}`, { method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token[actor] ? { Authorization: `Bearer ${token[actor]}` } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: response.status, body: await response.json(), cache: response.headers.get('cache-control') };
  };
  return { store, authStore, userIds, request, favorite, progress, history, advance: (ms: number) => { now += ms; },
    close: () => new Promise<void>((resolve, reject) => { server.close((e) => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function fixture(work: (s: Fixture) => Promise<void>) { const s = await setup(); try { await work(s); } finally { await s.close(); } }

test('favorites add, list metadata and idempotent remove do not delete Story', () => fixture(async ({ request, store }) => {
  const added = await request(f, 'POST', { storyId: novel }); assert.equal(added.status, 201);
  assert.equal(added.body.data.story.id, novel); assert.equal('userId' in added.body.data, false);
  const list = await request(f); assert.equal(list.status, 200); assert.equal(list.cache, 'no-store');
  assert.equal(list.body.pagination.total, 1); assert.equal(list.body.data[0].story.authorName, 'Test author');
  assert.equal((await request(`${f}/${novel}`, 'DELETE')).body.data.removed, true);
  assert.equal((await request(`${f}/${novel}`, 'DELETE')).body.data.removed, false);
  assert.equal(store.stories.size, 3);
}));
test('concurrent duplicate favorites yield exactly one 201 and one 409', () => fixture(async ({ request, store }) => {
  const results = await Promise.all([request(f, 'POST', { storyId: novel }), request(f, 'POST', { storyId: novel })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]); assert.equal(store.favoriteRows.length, 1);
}));
test('USER and ADMIN own their shelves; other user cannot read/delete favorites', () => fixture(async ({ request, store }) => {
  await request(f, 'POST', { storyId: novel });
  assert.deepEqual((await request(f, 'GET', undefined, 'other')).body.data, []);
  await request(`${f}/${novel}`, 'DELETE', undefined, 'other'); assert.equal(store.favoriteRows.length, 1);
  assert.equal((await request(f, 'POST', { storyId: novel }, 'admin')).status, 201);
  assert.equal((await request(f, 'GET', undefined, 'admin')).body.pagination.total, 1);
}));
test('draft/missing stories cannot be favorited and newly hidden favorites are excluded', () => fixture(async ({ request, store }) => {
  for (const storyId of [draftStory, unknown]) assert.equal((await request(f, 'POST', { storyId })).status, 404);
  await request(f, 'POST', { storyId: novel }); store.stories.get(novel)!.publishStatus = 'DRAFT';
  assert.equal((await request(f)).body.pagination.total, 0);
  assert.equal((await request(`${f}/${novel}`, 'DELETE')).status, 200);
}));
test('favorite pagination sorts newest first with stable ID tie breaker', () => fixture(async ({ request, store }) => {
  await request(f, 'POST', { storyId: novel }); await request(f, 'POST', { storyId: comic });
  store.favoriteRows[0].createdAt = new Date(1000); store.favoriteRows[1].createdAt = new Date(2000);
  const first = await request(`${f}?page=1&limit=1`); assert.equal(first.body.data[0].storyId, comic);
  assert.deepEqual(first.body.pagination, { page: 1, limit: 1, total: 2, totalPages: 2 });
  assert.equal((await request(`${f}?page=2&limit=1`)).body.data[0].storyId, novel);
}));
test('new reader receives explicit first-chapter state without creating data', () => fixture(async ({ request, store }) => {
  assert.deepEqual((await request(`${p}/${novel}`)).body, { success: true, message: 'Reading position retrieved', data: null, version: null, resume: 'FIRST_PUBLISHED_CHAPTER' });
  assert.equal(store.progressRows.length, 0);
}));
test('NOVEL saves exact chapter/offset/decimal percentage and resumes saved position', () => fixture(async ({ request, store }) => {
  const saved = await request(`${p}/${novel}`, 'PUT', novelInput); assert.equal(saved.status, 200);
  const r = await request(`${p}/${novel}`); assert.equal(r.body.resume, 'SAVED_POSITION');
  assert.equal(r.body.data.chapter.id, novelChapter); assert.equal(r.body.data.textOffset, 5);
  assert.equal(r.body.data.progressPercent, 25.25); assert.equal(r.body.data.pageNumber, null);
  assert.equal(r.body.version, saved.body.version); assert.equal(store.historyRows.length, 0);
  assert.deepEqual((await request(p)).body.data[0], saved.body.data);
}));
test('COMIC saves page and scroll offset with a null text offset', () => fixture(async ({ request }) => {
  const saved = await request(`${p}/${comic}`, 'PUT', comicInput); assert.equal(saved.status, 200);
  const resumed = await request(`${p}/${comic}`); assert.equal(resumed.body.data.pageNumber, 2);
  assert.equal(resumed.body.data.scrollOffset, 100); assert.equal(resumed.body.data.textOffset, null);
}));
test('stale/null/missing optimistic versions cannot overwrite saved progress; same millisecond versions increase', () => fixture(async ({ request, store }) => {
  const first = await request(`${p}/${novel}`, 'PUT', novelInput);
  assert.equal((await request(`${p}/${novel}`, 'PUT', { ...novelInput, textOffset: 1 })).status, 409);
  const second = await request(`${p}/${novel}`, 'PUT', { ...novelInput, expectedUpdatedAt: first.body.version, textOffset: 8 });
  assert.equal(second.status, 200); assert.notEqual(first.body.version, second.body.version);
  const old = await request(`${p}/${novel}`, 'PUT', { ...novelInput, expectedUpdatedAt: first.body.version, textOffset: 2 });
  assert.equal(old.status, 409); assert.equal(store.progressRows[0].textOffset, 8);
  const { expectedUpdatedAt: _version, ...withoutVersion } = novelInput;
  assert.equal((await request(`${p}/${novel}`, 'PUT', withoutVersion)).status, 400);
}));
test('two concurrent first progress saves or updates cannot silently overwrite each other', () => fixture(async ({ request, store }) => {
  const first = await Promise.all([request(`${p}/${novel}`, 'PUT', novelInput), request(`${p}/${novel}`, 'PUT', { ...novelInput, textOffset: 9 })]);
  assert.deepEqual(first.map((r) => r.status).sort(), [200, 409]); assert.equal(store.progressRows.length, 1);
  const version = first.find((r) => r.status === 200)!.body.version;
  const next = await Promise.all([10, 11].map((textOffset) => request(`${p}/${novel}`, 'PUT', { ...novelInput, textOffset, expectedUpdatedAt: version })));
  assert.deepEqual(next.map((r) => r.status).sort(), [200, 409]);
}));
test('chapter must belong to story and both must be published/readable', () => fixture(async ({ request, store }) => {
  for (const chapterId of [comicChapter, draftChapter, unknown]) {
    assert.equal((await request(`${p}/${novel}`, 'PUT', { ...novelInput, chapterId })).status, 404);
    assert.equal((await request(h, 'POST', { storyId: novel, chapterId })).status, 404);
  }
  for (const storyId of [draftStory, unknown]) {
    assert.equal((await request(`${p}/${storyId}`)).status, 404);
    assert.equal((await request(`${p}/${storyId}`, 'PUT', novelInput)).status, 404);
    assert.equal((await request(h, 'POST', { storyId, chapterId: novelChapter })).status, 404);
  }
  store.chapters.get(novelChapter)!.content = '  ';
  assert.equal((await request(`${p}/${novel}`, 'PUT', novelInput)).status, 404);
  assert.equal((await request(h, 'POST', { storyId: novel, chapterId: novelChapter })).status, 404);
}));
const invalidProgress: Array<[string, object]> = [
  ['negative percent', { progressPercent: -1 }], ['percent above 100', { progressPercent: 101 }],
  ['fractional cents', { progressPercent: 1.234 }], ['string percent', { progressPercent: '50' }],
  ['negative text', { textOffset: -1 }], ['text beyond content', { textOffset: 1000 }],
  ['fractional offset', { textOffset: 1.5 }], ['overflow offset', { textOffset: 2147483648 }],
  ['negative scroll', { scrollOffset: -1 }], ['zero page', { pageNumber: 0 }],
  ['NOVEL page', { pageNumber: 1 }], ['NOVEL scroll', { scrollOffset: 0 }],
  ['invalid chapter UUID', { chapterId: 'bad' }], ['invalid version', { expectedUpdatedAt: 'yesterday' }],
  ['user mass assignment', { userId: unknown }], ['unknown field', { role: 'ADMIN' }],
];
for (const [name, input] of invalidProgress) test(`invalid progress: ${name}`, () => fixture(async ({ request, store }) => {
  assert.equal((await request(`${p}/${novel}`, 'PUT', { ...novelInput, ...input })).status, 400); assert.equal(store.progressRows.length, 0);
}));
test('COMIC rejects absent/out-of-range/gap page numbers and text offset, accepts actual page identifiers', () => fixture(async ({ request, store }) => {
  for (const extra of [{ pageNumber: null }, { pageNumber: 3 }, { textOffset: 0 }]) {
    assert.equal((await request(`${p}/${comic}`, 'PUT', { ...comicInput, ...extra })).status, 400);
  }
  store.chapters.get(comicChapter)!.pages[1].pageNumber = 5;
  assert.equal((await request(`${p}/${comic}`, 'PUT', comicInput)).status, 400);
  assert.equal((await request(`${p}/${comic}`, 'PUT', { ...comicInput, pageNumber: 5 })).status, 200);
}));
test('progress allows intentional backward reading with current version and offsets at content boundaries', () => fixture(async ({ request, store }) => {
  const length = store.chapters.get(novelChapter)!.content!.length;
  const end = await request(`${p}/${novel}`, 'PUT', { ...novelInput, textOffset: length, progressPercent: 100 }); assert.equal(end.status, 200);
  const back = await request(`${p}/${novel}`, 'PUT', { ...novelInput, textOffset: 0, progressPercent: 0, expectedUpdatedAt: end.body.version });
  assert.equal(back.status, 200); assert.equal(back.body.data.textOffset, 0);
}));
test('progress is private and list paginates by latest update', () => fixture(async ({ request, advance }) => {
  await request(`${p}/${novel}`, 'PUT', novelInput); advance(1000); await request(`${p}/${comic}`, 'PUT', comicInput);
  const first = await request(`${p}?limit=1`); assert.equal(first.body.data[0].storyId, comic); assert.equal(first.body.pagination.totalPages, 2);
  assert.equal((await request(`${p}?page=2&limit=1`)).body.data[0].storyId, novel);
  assert.deepEqual((await request(p, 'GET', undefined, 'other')).body.data, []);
  assert.equal((await request(`${p}/${novel}`, 'GET', undefined, 'other')).body.data, null);
}));
test('resume clamps stale offsets after content edits without writing data', () => fixture(async ({ request, store }) => {
  await request(`${p}/${novel}`, 'PUT', { ...novelInput, textOffset: 10 }); store.chapters.get(novelChapter)!.content = 'abc';
  const r = await request(`${p}/${novel}`); assert.equal(r.body.data.textOffset, 3); assert.equal(r.body.positionAdjusted, true);
  assert.equal(store.progressRows[0].textOffset, 10);
  await request(`${p}/${comic}`, 'PUT', comicInput); store.chapters.get(comicChapter)!.pages.pop();
  const c = await request(`${p}/${comic}`); assert.equal(c.body.data.pageNumber, 1); assert.equal(c.body.data.scrollOffset, 0); assert.equal(c.body.positionAdjusted, true);
}));
test('hidden saved chapter returns safe first-chapter state with version so reader can save another chapter', () => fixture(async ({ request, store }) => {
  const saved = await request(`${p}/${novel}`, 'PUT', novelInput);
  store.chapters.get(novelChapter)!.publishStatus = 'DRAFT';
  const r = await request(`${p}/${novel}`); assert.equal(r.body.data, null); assert.equal(r.body.version, saved.body.version);
  assert.equal(r.body.resume, 'FIRST_PUBLISHED_CHAPTER'); assert.equal((await request(p)).body.pagination.total, 0);
  store.chapters.get(draftChapter)!.publishStatus = 'PUBLISHED';
  assert.equal((await request(`${p}/${novel}`, 'PUT', { ...novelInput, chapterId: draftChapter, expectedUpdatedAt: r.body.version })).status, 200);
}));
test('history records chapter visits, debounces concurrent duplicates, permits later revisit', () => fixture(async ({ request, store, advance }) => {
  const results = await Promise.all([request(h, 'POST', { storyId: novel, chapterId: novelChapter }), request(h, 'POST', { storyId: novel, chapterId: novelChapter })]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]); assert.equal(store.historyRows.length, 1);
  assert.deepEqual(results.map((r) => r.body.recorded).sort(), [false, true]);
  advance(HISTORY_DEDUP_MS); assert.equal((await request(h, 'POST', { storyId: novel, chapterId: novelChapter })).status, 200);
  advance(1); assert.equal((await request(h, 'POST', { storyId: novel, chapterId: novelChapter })).status, 201);
  assert.equal(store.historyRows.length, 2);
}));
test('history pagination newest first, private ownership and clear leaves progress/favorites/other history intact', () => fixture(async ({ request, store, advance }) => {
  await request(f, 'POST', { storyId: novel }); await request(`${p}/${novel}`, 'PUT', novelInput);
  await request(h, 'POST', { storyId: novel, chapterId: novelChapter }); advance(1000);
  await request(h, 'POST', { storyId: comic, chapterId: comicChapter });
  await request(h, 'POST', { storyId: novel, chapterId: novelChapter }, 'other');
  const first = await request(`${h}?limit=1`); assert.equal(first.body.data[0].chapter.id, comicChapter); assert.equal(first.body.pagination.total, 2);
  assert.equal((await request(`${h}?page=2&limit=1`)).body.data[0].chapterId, novelChapter);
  const deleted = await request(h, 'DELETE'); assert.equal(deleted.body.data.deletedCount, 2);
  assert.equal(store.progressRows.length, 1); assert.equal(store.favoriteRows.length, 1); assert.equal(store.historyRows.length, 1);
  assert.equal((await request(h)).body.pagination.total, 0); assert.equal((await request(h, 'GET', undefined, 'other')).body.pagination.total, 1);
}));
test('newly draft story/chapter disappear from history without deleting records', () => fixture(async ({ request, store }) => {
  await request(h, 'POST', { storyId: novel, chapterId: novelChapter }); await request(h, 'POST', { storyId: comic, chapterId: comicChapter });
  store.stories.get(novel)!.publishStatus = 'DRAFT'; store.chapters.get(comicChapter)!.publishStatus = 'DRAFT';
  assert.equal((await request(h)).body.pagination.total, 0); assert.equal(store.historyRows.length, 2);
}));
test('Guest is rejected on every personal endpoint before resource validation', () => fixture(async ({ request }) => {
  for (const [url, method, body] of [[f, 'GET'], [f, 'POST', { storyId: novel }], [`${f}/${novel}`, 'DELETE'], [p, 'GET'], [`${p}/${novel}`, 'GET'], [`${p}/${novel}`, 'PUT', novelInput], [h, 'GET'], [h, 'POST', { storyId: novel, chapterId: novelChapter }], [h, 'DELETE']] as const) {
    assert.equal((await request(url, method, body, 'guest')).status, 401);
  }
}));
test('UUIDs, pagination and userId injection in body/query are rejected on all modules', () => fixture(async ({ request }) => {
  for (const base of [f, p, h]) {
    for (const query of ['page=0', 'limit=101', 'limit=1.5', 'page=1e2', 'page=1&page=2', 'limit[x]=1', 'page=2147483647&limit=100', `userId=${unknown}`]) {
      assert.equal((await request(`${base}?${query}`)).status, 400);
    }
    assert.equal((await request(`${base}?page=1&limit=100`)).status, 200);
  }
  assert.equal((await request(`${p}/bad`)).status, 400); assert.equal((await request(`${f}/bad`, 'DELETE')).status, 400);
  assert.equal((await request(f, 'POST', { storyId: 'bad' })).status, 400);
  assert.equal((await request(h, 'POST', { storyId: novel, chapterId: 'bad' })).status, 400);
  assert.equal((await request(f, 'POST', { storyId: novel, userId: unknown })).status, 400);
  assert.equal((await request(h, 'POST', { storyId: novel, chapterId: novelChapter, userId: unknown })).status, 400);
  assert.equal((await request(h, 'DELETE', { userId: unknown })).status, 400);
  assert.equal((await request(`${h}?userId=${unknown}`, 'DELETE')).status, 400);
  assert.equal((await request(`${f}/${novel}`, 'DELETE', { userId: unknown })).status, 400);
}));
test('ban invalidates tokens for private reading APIs and no sensitive fields are returned', () => fixture(async ({ request, authStore, userIds }) => {
  const result = await request(f, 'POST', { storyId: novel });
  const output = JSON.stringify(result.body); for (const secret of ['passwordHash', 'accessToken', 'refreshToken', 'userId', 'publishStatus', 'content']) assert(!output.includes(secret));
  authStore.users.get(userIds.user)!.status = 'BANNED';
  for (const url of [f, p, h]) assert.equal((await request(url)).status, 401);
}));
test('transaction rollback and database errors return sanitized responses without partial writes', () => fixture(async ({ request, store }) => {
  store.failCommit = true;
  const r = await request(f, 'POST', { storyId: novel }); assert.equal(r.status, 500); assert.equal(store.favoriteRows.length, 0);
  assert.deepEqual(r.body, { success: false, message: 'Internal server error', error: { code: 'INTERNAL_SERVER_ERROR' } });
  store.failCommit = false;
  for (const code of ['P2002', 'P2034', 'P2028', '55P03', 'P2003', 'P2025']) {
    store.failCode = code; const e = await request(f, 'POST', { storyId: novel });
    assert.equal(e.status, ['P2003', 'P2025'].includes(code) ? 404 : 409); assert(!JSON.stringify(e.body).includes('PRIVATE'));
  }
}));
