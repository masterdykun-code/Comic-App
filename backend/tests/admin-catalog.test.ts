import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createAdminGenreRouter } from '../src/routes/admin-genre.routes';
import { createAdminGenreService } from '../src/services/admin-genre.service';
import { createAdminCommentService } from '../src/services/admin-comment.service';
import { createCommentRouter } from '../src/routes/comment.routes';
import { createCommentService } from '../src/services/comment.service';
import { createAuthService } from '../src/services/auth.service';
import { errorHandler, notFoundHandler } from '../src/middlewares/error-handler';
import type { AdminGenreStore, AdminGenreTransaction, GenreInput, GenreRow } from '../src/types/admin-genre.types';
import type { AdminCommentStore, AdminCommentEntry } from '../src/types/admin-comment.types';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { MemoryFeedbackStore } from './helpers/memory-feedback.store';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
const storyId = '10000000-0000-4000-8000-000000000001'; const draftId = '10000000-0000-4000-8000-000000000002';
class MemoryGenres implements AdminGenreStore {
  rows = new Map<string, GenreRow>(); usage = new Map<string, number>(); failures: string[] = []; deleteFailure?: string;
  constructor(private auth: MemoryAuthStore) {}
  private check(input: GenreInput, id?: string) { if ([...this.rows.values()].some((g) => g.id !== id && (g.name === input.name || g.slug === input.slug))) throw Object.assign(new Error('private unique failure'), { code: 'P2002' }); }
  private tail = Promise.resolve();
  async transaction<T>(work: (tx: AdminGenreTransaction) => Promise<T>): Promise<T> {
    let release!: () => void; const before = this.tail; this.tail = new Promise((resolve) => { release = resolve; }); await before;
    const snapshot = structuredClone(this.rows);
    try {
      const value = await work({
        adminIsActive: async (id) => { const user = this.auth.users.get(id); return user?.role === 'ADMIN' && user.status === 'ACTIVE'; },
        find: async (id) => this.rows.get(id) ?? null,
        create: async (input) => { this.check(input); const row = { ...input, id: randomUUID(), createdAt: new Date() }; this.rows.set(row.id, row); return row; },
        update: async (id, input) => { const row = { ...this.rows.get(id)!, ...input }; this.check(row, id); this.rows.set(id, row); return row; },
        usage: async (id) => this.usage.get(id) ?? 0,
        remove: async (id) => { if (this.deleteFailure) throw Object.assign(new Error('private FK failure'), { code: this.deleteFailure }); this.rows.delete(id); },
      });
      const code = this.failures.shift(); if (code) throw Object.assign(new Error('private transaction failure'), { code }); return value;
    } catch (err) { this.rows = snapshot; throw err; } finally { release(); }
  }
}
async function setup() {
  const authStore = new MemoryAuthStore(); const auth = createAuthService(authStore); const tokens: Record<string, string> = {}; const ids: Record<string, string> = {};
  for (const actor of ['admin', 'user']) {
    const row = await auth.register({ username: `catalog_${actor}`, email: `${actor}@example.test`, password: 'Synthetic-password-123' });
    if (actor === 'admin') authStore.users.get(row.id)!.role = 'ADMIN'; ids[actor] = row.id;
    tokens[actor] = (await auth.login(`${actor}@example.test`, 'Synthetic-password-123')).accessToken;
  }
  const genres = new MemoryGenres(authStore); const feedback = new MemoryFeedbackStore(authStore);
  feedback.stories.set(storyId, { id: storyId, publishStatus: 'PUBLISHED' }); feedback.stories.set(draftId, { id: draftId, publishStatus: 'DRAFT' });
  const readStore: AdminCommentStore = { transaction: async (work) => work({
    adminIsActive: async (id) => authStore.users.get(id)?.role === 'ADMIN' && authStore.users.get(id)?.status === 'ACTIVE',
    list: async (q) => {
      const rows = feedback.commentRows.filter((c) => (!q.storyId || c.storyId === q.storyId) && (!q.status || c.status === q.status) && (!q.parentId || c.parentId === q.parentId))
        .sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)) * (q.sort === 'oldest' ? 1 : -1));
      const data: AdminCommentEntry[] = rows.slice((q.page - 1) * q.limit, q.page * q.limit).map((r) => {
        const p = feedback.commentRows.find((c) => c.id === r.parentId);
        return { id: r.id, storyId: r.storyId, parentId: r.parentId, content: r.content, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, user: r.user,
          story: { id: r.storyId, title: r.storyId === storyId ? 'Published story' : 'Draft story', slug: 'test-story', publishStatus: feedback.stories.get(r.storyId)!.publishStatus },
          parent: p ? { id: p.id, status: p.status, user: p.user } : null, replyCount: feedback.commentRows.filter((c) => c.parentId === r.id).length };
      }); return { data, total: rows.length };
    },
  }) };
  const app = express(); app.use(express.json({ limit: '16kb' })); app.use('/api/admin/genres', createAdminGenreRouter(createAdminGenreService(genres), auth));
  app.use(createCommentRouter(createCommentService(feedback), auth, createAdminCommentService(readStore))); app.use(notFoundHandler); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
  const request = async (path: string, method = 'GET', body?: unknown, actor = 'admin') => {
    const r = await fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: { ...(tokens[actor] ? { Authorization: `Bearer ${tokens[actor]}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    return { status: r.status, body: await r.json(), cache: r.headers.get('cache-control') };
  };
  const create = async (content = 'Root comment', parentId?: string) => { const r = await request(`/api/stories/${storyId}/comments`, 'POST', { content, ...(parentId ? { parentId } : {}) }, 'user'); assert.equal(r.status, 201); return r.body.data as { id: string }; };
  return { genres, feedback, request, create, authStore, ids, close: () => new Promise<void>((resolve, reject) => { server.close((err) => err ? reject(err) : resolve()); server.closeAllConnections(); }) };
}
async function fixture(run: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>) { const f = await setup(); try { await run(f); } finally { await f.close(); } }
test('ADMIN creates, edits and deletes unused genre; only whitelisted fields are returned', () => fixture(async ({ request, genres }) => {
  const created = await request('/api/admin/genres', 'POST', { name: ' Phiêu lưu ', slug: ' ADVENTURE ' });
  assert.equal(created.status, 201); assert.equal(created.cache, 'no-store'); assert.equal(created.body.data.name, 'Phiêu lưu'); assert.equal(created.body.data.slug, 'adventure');
  assert.deepEqual(Object.keys(created.body.data).sort(), ['createdAt', 'id', 'name', 'slug']);
  const id = created.body.data.id;
  assert.equal((await request(`/api/admin/genres/${id}`, 'PATCH', { name: 'Hành trình' })).status, 200);
  assert.equal(genres.rows.get(id)!.slug, 'adventure');
  assert.equal((await request(`/api/admin/genres/${id}`, 'DELETE')).status, 200); assert.equal(genres.rows.size, 0);
}));
test('Guest/USER cannot create/edit/delete genres, list admin comments or moderate', () => fixture(async ({ request, create, genres }) => {
  const root = await create();
  for (const actor of ['guest', 'user']) for (const [path, method, body] of [
    ['/api/admin/genres', 'POST', { name: 'Name', slug: 'slug' }], [`/api/admin/genres/${storyId}`, 'PATCH', { name: 'Name' }], [`/api/admin/genres/${storyId}`, 'DELETE', undefined],
    ['/api/admin/comments', 'GET', undefined], [`/api/admin/comments/${root.id}/moderate`, 'PATCH', { status: 'HIDDEN' }],
  ] as const) assert.equal((await request(path, method, body, actor)).status, actor === 'guest' ? 401 : 403);
  assert.equal(genres.rows.size, 0);
}));
test('genre exact unique name/slug conflicts return 409; database case semantics are preserved', () => fixture(async ({ request }) => {
  const first = await request('/api/admin/genres', 'POST', { name: 'Fantasy', slug: 'fantasy' }); const id = first.body.data.id;
  for (const body of [{ name: 'Fantasy', slug: 'other' }, { name: 'Other', slug: 'fantasy' }]) assert.equal((await request('/api/admin/genres', 'POST', body)).body.error.code, 'GENRE_CONFLICT');
  const other = await request('/api/admin/genres', 'POST', { name: 'fantasy', slug: 'lowercase-name' }); assert.equal(other.status, 201);
  assert.equal((await request(`/api/admin/genres/${other.body.data.id}`, 'PATCH', { slug: 'fantasy' })).status, 409);
  assert.equal((await request(`/api/admin/genres/${id}`, 'PATCH', { slug: 'new-fantasy' })).status, 200);
}));
test('linked genre cannot be deleted; FK race also returns 409 without unlinking', () => fixture(async ({ request, genres }) => {
  const { body } = await request('/api/admin/genres', 'POST', { name: 'Linked', slug: 'linked' }); const id = body.data.id;
  const before = structuredClone(genres.rows.get(id)); genres.usage.set(id, 1);
  assert.equal((await request(`/api/admin/genres/${id}`, 'DELETE')).body.error.code, 'GENRE_IN_USE'); assert.deepEqual(genres.rows.get(id), before); assert.equal(genres.usage.get(id), 1);
  genres.usage.set(id, 0); genres.deleteFailure = 'P2003';
  assert.equal((await request(`/api/admin/genres/${id}`, 'DELETE')).status, 409); assert.deepEqual(genres.rows.get(id), before);
}));
test('genre validation rejects mass assignment, invalid slug/name, empty update and malformed UUID', () => fixture(async ({ request, genres }) => {
  for (const body of [{ name: '', slug: 'a' }, { name: 'A', slug: 'bad/path' }, { name: '<script>', slug: 'a' }, { name: 'A', slug: 'a', createdAt: 'forged' }, { name: 'A', slug: 'a', role: 'ADMIN' }, { name: 'A'.repeat(101), slug: 'a' }]) assert.equal((await request('/api/admin/genres', 'POST', body)).status, 400);
  assert.equal((await request(`/api/admin/genres/${storyId}`, 'PATCH', {})).status, 400);
  assert.equal((await request('/api/admin/genres/bad', 'DELETE')).status, 400);
  assert.equal((await request(`/api/admin/genres/${storyId}`, 'DELETE', { unlink: true })).status, 400);
  assert.equal((await request('/api/admin/genres?unknown=1', 'POST', { name: 'A', slug: 'a' })).status, 400);
  assert.equal((await request(`/api/admin/genres/${storyId}`, 'PATCH', { name: 'Missing' })).status, 404);
  assert.equal((await request(`/api/admin/genres/${storyId}`, 'DELETE')).status, 404); assert.equal(genres.rows.size, 0);
}));
test('genre writes retry transaction conflicts and roll back on exhausted retries', () => fixture(async ({ request, genres }) => {
  genres.failures.push('P2034'); const first = await request('/api/admin/genres', 'POST', { name: 'Retry', slug: 'retry' }); assert.equal(first.status, 201); assert.equal(genres.rows.size, 1);
  genres.failures.push('P2034', 'P2034', 'P2034'); const before = structuredClone(genres.rows);
  assert.equal((await request(`/api/admin/genres/${first.body.data.id}`, 'PATCH', { name: 'Must rollback' })).status, 409); assert.deepEqual(genres.rows, before);
}));
test('admin comment list shows hidden roots/replies and safe author/story projections; public rules stay intact', () => fixture(async ({ request, create }) => {
  const root = await create('Root'); const reply = await create('Reply', root.id);
  assert.equal((await request(`/api/admin/comments/${root.id}/moderate`, 'PATCH', { status: 'HIDDEN' })).status, 200);
  const admin = await request('/api/admin/comments'); assert.equal(admin.status, 200); assert.equal(admin.body.pagination.total, 2); assert.equal(admin.cache, 'no-store');
  const child = admin.body.data.find((r: AdminCommentEntry) => r.id === reply.id); assert.equal(child.parent.status, 'HIDDEN'); assert.equal(child.story.title, 'Published story');
  for (const row of admin.body.data) { assert.deepEqual(Object.keys(row.user).sort(), ['avatarUrl', 'displayName', 'username']); assert(!('passwordHash' in row)); assert(!('userId' in row)); }
  assert.deepEqual((await request(`/api/stories/${storyId}/comments`, 'GET', undefined, 'guest')).body.data, []);
  assert.equal((await request(`/api/comments/${root.id}/replies`, 'GET', undefined, 'guest')).status, 404);
  await request(`/api/admin/comments/${root.id}/moderate`, 'PATCH', { status: 'VISIBLE' });
  assert.equal((await request(`/api/stories/${storyId}/comments`, 'GET', undefined, 'guest')).body.data[0].replies[0].id, reply.id);
  await request(`/api/admin/comments/${reply.id}/moderate`, 'PATCH', { status: 'HIDDEN' });
  assert.equal((await request(`/api/stories/${storyId}/comments`, 'GET', undefined, 'guest')).body.data[0].replies.length, 0);
}));
test('admin comment pagination and filters combine, including drafts and empty pages', () => fixture(async ({ request, create, feedback }) => {
  const root = await create('Root'); const a = await create('A', root.id); await create('B', root.id);
  await request(`/api/admin/comments/${a.id}/moderate`, 'PATCH', { status: 'HIDDEN' });
  const filtered = await request(`/api/admin/comments?storyId=${storyId}&parentId=${root.id}&status=HIDDEN&limit=1&sort=oldest`);
  assert.deepEqual(filtered.body.data.map((r: AdminCommentEntry) => r.id), [a.id]); assert.equal(filtered.body.pagination.totalPages, 1);
  const p1 = await request('/api/admin/comments?limit=1&page=1'); const p2 = await request('/api/admin/comments?limit=1&page=2'); assert.notEqual(p1.body.data[0].id, p2.body.data[0].id);
  assert.deepEqual((await request('/api/admin/comments?page=9')).body.data, []);
  feedback.stories.get(storyId)!.publishStatus = 'DRAFT'; assert.equal((await request('/api/admin/comments')).body.pagination.total, 3);
  assert.equal((await request(`/api/stories/${storyId}/comments`, 'GET', undefined, 'guest')).status, 404);
}));
test('admin comment query validation and moderation body validation reject unsafe input', () => fixture(async ({ request, create }) => {
  for (const query of ['page=0', 'limit=101', 'page=2147483647&limit=100', 'status=OTHER', 'storyId=bad', 'parentId=bad', 'status=VISIBLE&status=HIDDEN', 'search=unindexed', 'limit[x]=1']) assert.equal((await request('/api/admin/comments?' + query)).status, 400);
  const root = await create(); assert.equal((await request(`/api/admin/comments/${root.id}/moderate`, 'PATCH', { status: 'HIDDEN', content: 'forged' })).status, 400);
}));
test('ban/demotion invalidates admin management access without leaking errors', () => fixture(async ({ request, authStore, ids }) => {
  authStore.users.get(ids.admin)!.role = 'USER'; assert.equal((await request('/api/admin/comments')).status, 403);
  authStore.users.get(ids.admin)!.role = 'ADMIN'; authStore.users.get(ids.admin)!.status = 'BANNED';
  assert.equal((await request('/api/admin/genres', 'POST', { name: 'No', slug: 'no' })).status, 401);
}));
test('genre management is rate limited after authenticated validation failures', () => fixture(async ({ request }) => {
  for (let i = 0; i < 60; i++) assert.equal((await request('/api/admin/genres', 'POST', {})).status, 400);
  assert.equal((await request('/api/admin/genres', 'POST', {})).status, 429);
}));
