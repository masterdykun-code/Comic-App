import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createAuthService } from '../src/services/auth.service';
import { createRatingService } from '../src/services/rating.service';
import { createCommentService } from '../src/services/comment.service';
import { createRatingRouter } from '../src/routes/rating.routes';
import { createCommentRouter } from '../src/routes/comment.routes';
import { errorHandler, notFoundHandler } from '../src/middlewares/error-handler';
import { hashPassword } from '../src/utils/password';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { MemoryFeedbackStore } from './helpers/memory-feedback.store';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
const story = '10000000-0000-4000-8000-000000000001';
const otherStory = '10000000-0000-4000-8000-000000000002';
const draft = '10000000-0000-4000-8000-000000000003';
const absent = '20000000-0000-4000-8000-000000000001';
const ratings = (id = story) => `/api/stories/${id}/ratings`;
const myRating = (id = story) => `/api/stories/${id}/my-rating`;
const comments = (id = story) => `/api/stories/${id}/comments`;
const comment = (id: string) => `/api/comments/${id}`;
const moderate = (id: string) => `/api/admin/comments/${id}/moderate`;

async function setup() {
  const authStore = new MemoryAuthStore(); const auth = createAuthService(authStore);
  const tokens: Record<string, string> = {}; const ids: Record<string, string> = {};
  const passwordHash = await hashPassword('Test-password-123');
  for (const name of ['user', 'other', 'admin']) {
    const u = await authStore.createUser({ username: name, email: `${name}@example.test`, passwordHash, displayName: `Display ${name}` });
    if (name === 'admin') u.role = 'ADMIN'; ids[name] = u.id;
    tokens[name] = (await auth.login(u.email, 'Test-password-123')).accessToken;
  }
  const store = new MemoryFeedbackStore(authStore);
  for (const id of [story, otherStory, draft]) store.stories.set(id, { id, publishStatus: id === draft ? 'DRAFT' : 'PUBLISHED' });
  const ratingService = createRatingService(store); const commentService = createCommentService(store);
  const app = express(); app.use(express.json({ limit: '16kb' }));
  app.use(createRatingRouter(ratingService, auth)); app.use(createCommentRouter(commentService, auth));
  app.use(notFoundHandler); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); assert(address && typeof address !== 'string');
  const request = async (path: string, method = 'GET', body?: unknown, actor = 'guest') => {
    const res = await fetch(`http://127.0.0.1:${address.port}${path}`, { method,
      headers: { ...(tokens[actor] ? { Authorization: `Bearer ${tokens[actor]}` } : {}), ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}) },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return { status: res.status, body: await res.json(), cache: res.headers.get('cache-control'), retry: res.headers.get('retry-after') };
  };
  const create = async (content = 'Test comment', parentId?: string, actor = 'user', storyId = story) => {
    const r = await request(comments(storyId), 'POST', { content, ...(parentId ? { parentId } : {}) }, actor); assert.equal(r.status, 201); return r.body.data;
  };
  return { store, authStore, ids, request, create, ratingService, commentService,
    close: () => new Promise<void>((resolve, reject) => { server.close((e) => e ? reject(e) : resolve()); server.closeAllConnections(); }) };
}
type Fixture = Awaited<ReturnType<typeof setup>>;
async function fixture(run: (s: Fixture) => Promise<void>) { const s = await setup(); try { await run(s); } finally { await s.close(); } }

for (const score of [1, 2, 3, 4, 5]) test(`rating accepts integer ${score} with public user metadata`, () => fixture(async ({ request, store }) => {
  const r = await request(myRating(), 'PUT', { score, reviewText: '  Good story  ' }, 'user'); assert.equal(r.status, 200);
  assert.equal(r.body.data.score, score); assert.equal(r.body.data.reviewText, 'Good story'); assert.equal(store.ratingRows.length, 1);
  assert.deepEqual(r.body.data.user, { username: 'user', displayName: 'Display user', avatarUrl: null });
  const list = await request(ratings()); assert.equal(list.status, 200); assert.equal(list.cache, 'no-store'); assert.equal(list.body.summary.averageScore, score);
}));
for (const [name, input] of [
  ['zero', { score: 0 }], ['above five', { score: 6 }], ['negative', { score: -1 }], ['fraction', { score: 3.5 }],
  ['string', { score: '5' }], ['missing score', {}], ['null', { score: null }],
  ['review length', { score: 3, reviewText: 'x'.repeat(2001) }], ['blank review', { score: 3, reviewText: '  ' }],
  ['HTML review', { score: 3, reviewText: '<script>bad</script>' }], ['control review', { score: 3, reviewText: 'bad\0' }],
  ['forged user', { score: 3, userId: absent }], ['forged role', { score: 3, role: 'ADMIN' }],
] as const) test(`invalid rating rejected: ${name}`, () => fixture(async ({ request, store }) => {
  assert.equal((await request(myRating(), 'PUT', input, 'user')).status, 400); assert.equal(store.ratingRows.length, 0);
}));
test('rating upsert retains ID/creation time, omitted review unchanged, explicit null clears', () => fixture(async ({ request, store }) => {
  const first = await request(myRating(), 'PUT', { score: 1, reviewText: 'Original' }, 'user');
  const updated = await request(myRating(), 'PUT', { score: 5 }, 'user');
  assert.equal(updated.body.data.id, first.body.data.id); assert.equal(updated.body.data.createdAt, first.body.data.createdAt);
  assert.equal(updated.body.data.reviewText, 'Original'); assert.equal(updated.body.data.score, 5); assert.equal(store.ratingRows.length, 1);
  assert.equal((await request(myRating(), 'PUT', { score: 4, reviewText: null }, 'user')).body.data.reviewText, null);
}));
test('concurrent ratings retain exactly one row per user/story', () => fixture(async ({ request, store }) => {
  const results = await Promise.all([1, 5].map((score) => request(myRating(), 'PUT', { score }, 'user')));
  assert.deepEqual(results.map((r) => r.status), [200, 200]); assert.equal(store.ratingRows.length, 1);
  assert.equal(results[0].body.data.id, results[1].body.data.id);
}));
test('rating summary and pagination compute across all ratings, not just current page', () => fixture(async ({ request, store }) => {
  await request(myRating(), 'PUT', { score: 1 }, 'user'); await request(myRating(), 'PUT', { score: 4 }, 'other'); await request(myRating(), 'PUT', { score: 5 }, 'admin');
  store.ratingRows.forEach((r, i) => { r.createdAt = new Date(i * 1000); });
  const newest = await request(`${ratings()}?limit=1&sort=newest`);
  assert.equal(newest.body.data[0].score, 5); assert.deepEqual(newest.body.summary, { averageScore: 3.33, totalRatings: 3, distribution: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 1 } });
  assert.deepEqual(newest.body.pagination, { page: 1, limit: 1, total: 3, totalPages: 3 });
  assert.equal((await request(`${ratings()}?page=2&limit=1&sort=oldest`)).body.data[0].score, 4);
}));
test('empty ratings summary and out-of-range page are explicit', () => fixture(async ({ request }) => {
  const r = await request(`${ratings()}?page=20`); assert.deepEqual(r.body.data, []);
  assert.deepEqual(r.body.summary, { averageScore: null, totalRatings: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
}));
test('rating deletion only affects current user, is idempotent and permits withdrawal after unpublishing', () => fixture(async ({ request, store }) => {
  await request(myRating(), 'PUT', { score: 1 }, 'user'); await request(myRating(), 'PUT', { score: 4 }, 'other');
  const removed = await request(myRating(), 'DELETE', undefined, 'user'); assert.equal(removed.body.data.removed, true);
  assert.equal(store.ratingRows.length, 1); assert.equal((await request(myRating(), 'DELETE', undefined, 'user')).body.data.removed, false);
  store.stories.get(story)!.publishStatus = 'DRAFT'; assert.equal((await request(myRating(), 'DELETE', undefined, 'other')).body.data.removed, true);
}));
test('draft and missing stories do not expose ratings/comments or accept writes', () => fixture(async ({ request, store }) => {
  await request(myRating(), 'PUT', { score: 5 }, 'user'); store.stories.get(story)!.publishStatus = 'DRAFT';
  for (const id of [story, draft, absent]) {
    assert.equal((await request(ratings(id))).status, 404); assert.equal((await request(comments(id))).status, 404);
    assert.equal((await request(myRating(id), 'PUT', { score: 4 }, 'user')).status, 404);
    assert.equal((await request(comments(id), 'POST', { content: 'Hi' }, 'user')).status, 404);
  }
}));
test('comments support roots and a single reply level with safe public projection', () => fixture(async ({ request, create }) => {
  const root = await create('  Hello world  '); const reply = await create('Reply', root.id, 'other');
  assert.equal(root.content, 'Hello world'); assert.equal(root.parentId, null); assert.equal(reply.parentId, root.id);
  const list = await request(comments()); assert.equal(list.body.pagination.total, 1); assert.equal(list.body.data[0].replies[0].id, reply.id);
  assert.deepEqual(list.body.data[0].repliesPagination, { page: 1, limit: 20, total: 1, totalPages: 1 });
  const nested = await request(comments(), 'POST', { content: 'Nested', parentId: reply.id }, 'user'); assert.equal(nested.status, 400);
}));
test('parent must exist in same story and be visible', () => fixture(async ({ request, create }) => {
  const root = await create('Another story', undefined, 'user', otherStory);
  for (const parentId of [root.id, absent]) assert.equal((await request(comments(), 'POST', { content: 'Reply', parentId }, 'user')).status, 404);
  const own = await create(); await request(moderate(own.id), 'PATCH', { status: 'HIDDEN' }, 'admin');
  assert.equal((await request(comments(), 'POST', { content: 'Reply', parentId: own.id }, 'other')).status, 404);
}));
test('only owner can edit/delete, including denial to ADMIN acting as non-owner', () => fixture(async ({ request, create }) => {
  const root = await create();
  for (const actor of ['other', 'admin']) {
    assert.equal((await request(comment(root.id), 'PATCH', { content: 'Stolen edit' }, actor)).status, 403);
    assert.equal((await request(comment(root.id), 'DELETE', undefined, actor)).status, 403);
  }
  const edited = await request(comment(root.id), 'PATCH', { content: 'Edited' }, 'user'); assert.equal(edited.status, 200); assert.equal(edited.body.data.content, 'Edited');
  assert.equal((await request(comment(root.id), 'DELETE', undefined, 'user')).status, 200);
  assert.equal((await request(comment(root.id), 'DELETE', undefined, 'user')).status, 404);
}));
test('comments with any replies cannot be deleted; deleting a leaf preserves everyone else', () => fixture(async ({ request, create, store }) => {
  const root = await create(); const reply = await create('Other reply', root.id, 'other');
  await request(moderate(reply.id), 'PATCH', { status: 'HIDDEN' }, 'admin');
  const blocked = await request(comment(root.id), 'DELETE', undefined, 'user'); assert.equal(blocked.status, 409); assert.equal(blocked.body.error.code, 'COMMENT_HAS_REPLIES');
  assert.equal(store.commentRows.length, 2);
  assert.equal((await request(comment(reply.id), 'DELETE', undefined, 'other')).status, 200);
  assert.equal(store.commentRows.length, 1); assert.equal(store.commentRows[0].id, root.id);
}));
test('ADMIN moderation hides replies and entire root branches without leaking hidden content', () => fixture(async ({ request, create }) => {
  const root = await create('Secret root'); const reply = await create('Secret reply', root.id, 'other');
  const denied = await request(moderate(root.id), 'PATCH', { status: 'HIDDEN' }, 'user'); assert.equal(denied.status, 403);
  const hidden = await request(moderate(reply.id), 'PATCH', { status: 'HIDDEN' }, 'admin'); assert.equal(hidden.status, 200); assert(!('content' in hidden.body.data));
  const r = await request(comments()); assert.deepEqual(r.body.data[0].replies, []); assert.equal(r.body.data[0].repliesPagination.total, 0);
  assert(!JSON.stringify(r.body).includes('Secret reply'));
  await request(moderate(root.id), 'PATCH', { status: 'HIDDEN' }, 'admin');
  assert.deepEqual((await request(comments())).body.data, []);
  assert.equal((await request(`${comment(root.id)}/replies`)).status, 404);
  // Restoring a child never bypasses its hidden parent.
  await request(moderate(reply.id), 'PATCH', { status: 'VISIBLE' }, 'admin'); assert.deepEqual((await request(comments())).body.data, []);
  await request(moderate(root.id), 'PATCH', { status: 'VISIBLE' }, 'admin'); assert.equal((await request(comments())).body.data[0].replies.length, 1);
}));
test('hidden comment/thread cannot be edited by owner until restored', () => fixture(async ({ request, create }) => {
  const root = await create(); const reply = await create('Reply', root.id);
  await request(moderate(root.id), 'PATCH', { status: 'HIDDEN' }, 'admin');
  for (const id of [root.id, reply.id]) assert.equal((await request(comment(id), 'PATCH', { content: 'Changed' }, 'user')).status, 409);
  await request(moderate(root.id), 'PATCH', { status: 'VISIBLE' }, 'admin');
  assert.equal((await request(comment(root.id), 'PATCH', { content: 'Allowed' }, 'user')).status, 200);
}));
test('root pagination counts roots only and separately paginates bounded visible replies', () => fixture(async ({ request, commentService, ids, store }) => {
  const first = await commentService.create(ids.user, story, { content: 'First' });
  const second = await commentService.create(ids.user, story, { content: 'Second' });
  store.commentRows[0].createdAt = new Date(1000); store.commentRows[1].createdAt = new Date(2000);
  for (let i = 0; i < 23; i++) {
    const reply = await commentService.create(ids.other, story, { content: `Reply ${i}`, parentId: first.id });
    store.commentRows.find((r) => r.id === reply.id)!.createdAt = new Date(3000 + i);
  }
  const roots = await request(`${comments()}?sort=oldest&limit=1`); assert.equal(roots.body.data[0].id, first.id);
  assert.equal(roots.body.pagination.total, 2); assert.equal(roots.body.data[0].replies.length, 20); assert.equal(roots.body.data[0].repliesPagination.total, 23);
  assert.equal((await request(`${comments()}?sort=newest&limit=1`)).body.data[0].id, second.id);
  const page = await request(`${comment(first.id)}/replies?page=2&limit=20`); assert.equal(page.body.data.length, 3); assert.equal(page.body.data[0].content, 'Reply 20');
  assert.equal(page.body.pagination.total, 23);
  const child = store.commentRows.find((r) => r.parentId === first.id)!;
  assert.equal((await request(`${comment(child.id)}/replies`)).status, 404);
}));
test('concurrent root deletion vs reply cannot orphan a reply or delete another user content', () => fixture(async ({ create, commentService, ids, store }) => {
  const root = await create();
  const results = await Promise.allSettled([
    commentService.create(ids.other, story, { content: 'Racing reply', parentId: root.id }),
    commentService.remove(ids.user, root.id),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  for (const child of store.commentRows.filter((r) => r.parentId)) assert(store.commentRows.some((r) => r.id === child.parentId));
}));
test('concurrent moderation vs reply serializes and never exposes hidden threads', () => fixture(async ({ create, commentService, ids, store, request }) => {
  const root = await create();
  await Promise.allSettled([commentService.moderate(ids.admin, root.id, 'HIDDEN'), commentService.create(ids.other, story, { content: 'Concurrent reply', parentId: root.id })]);
  assert.equal(store.commentRows.find((r) => r.id === root.id)!.status, 'HIDDEN'); assert.deepEqual((await request(comments())).body.data, []);
}));
for (const [name, input] of [
  ['blank', { content: ' \n ' }], ['too long', { content: 'x'.repeat(3001) }], ['control', { content: 'bad\0' }],
  ['HTML', { content: '<img src=x onerror=alert(1)>' }], ['invisible', { content: '\u200b\u200d' }],
  ['missing', {}], ['invalid parent', { content: 'x', parentId: 'bad' }], ['forged user', { content: 'x', userId: absent }],
  ['forged status', { content: 'x', status: 'HIDDEN' }], ['forged story', { content: 'x', storyId: otherStory }],
] as const) test(`invalid comment rejected: ${name}`, () => fixture(async ({ request, store }) => {
  assert.equal((await request(comments(), 'POST', input, 'user')).status, 400); assert.equal(store.commentRows.length, 0);
}));
test('comment edit and moderation reject reassignment and mass assignment', () => fixture(async ({ create, request }) => {
  const root = await create();
  for (const field of ['status', 'storyId', 'parentId', 'userId', 'role']) assert.equal((await request(comment(root.id), 'PATCH', { content: 'Edit', [field]: absent }, 'user')).status, 400);
  assert.equal((await request(moderate(root.id), 'PATCH', { status: 'DELETED' }, 'admin')).status, 400);
  assert.equal((await request(moderate(root.id), 'PATCH', { status: 'HIDDEN', content: 'Override' }, 'admin')).status, 400);
  assert.equal((await request(comment(root.id), 'DELETE', { userId: absent }, 'user')).status, 400);
}));
test('Guest can read public feedback but cannot write or moderate', () => fixture(async ({ request, create }) => {
  const root = await create(); assert.equal((await request(comments())).status, 200); assert.equal((await request(ratings())).status, 200);
  assert.equal((await request(`${comment(root.id)}/replies`)).status, 200);
  for (const [url, method, body] of [[myRating(), 'PUT', { score: 5 }], [myRating(), 'DELETE'], [comments(), 'POST', { content: 'x' }], [comment(root.id), 'PATCH', { content: 'x' }], [comment(root.id), 'DELETE'], [moderate(root.id), 'PATCH', { status: 'HIDDEN' }]] as const) {
    assert.equal((await request(url, method, body)).status, 401);
  }
}));
test('invalid UUIDs/query parameters and missing comments return safe 400/404', () => fixture(async ({ request }) => {
  for (const url of [ratings('bad'), comments('bad'), `${comment('bad')}/replies`]) assert.equal((await request(url)).status, 400);
  for (const base of [ratings(), comments()]) for (const query of ['page=0', 'page=1.5', 'limit=101', 'page=2147483647&limit=100', 'page=1&page=2', 'sort=bad', 'userId=abc']) assert.equal((await request(`${base}?${query}`)).status, 400);
  for (const [url, method, body] of [[comment(absent), 'PATCH', { content: 'x' }], [comment(absent), 'DELETE'], [moderate(absent), 'PATCH', { status: 'HIDDEN' }]] as const) {
    assert.equal((await request(url, method, body, method === 'PATCH' && url.includes('/admin/') ? 'admin' : 'user')).status, 404);
  }
  assert.equal((await request(`${comment(absent)}/replies`)).status, 404);
  assert.equal((await request(`${myRating()}?userId=${absent}`, 'DELETE', undefined, 'user')).status, 400);
}));
test('comment create/edit share per-user rate limit, public reads/other users unaffected', () => fixture(async ({ request, create }) => {
  const root = await create();
  for (let i = 0; i < 9; i++) assert.equal((await request(comment(root.id), 'PATCH', { content: `Edit ${i}` }, 'user')).status, 200);
  const blocked = await request(comments(), 'POST', { content: 'Too fast' }, 'user'); assert.equal(blocked.status, 429); assert(blocked.retry);
  assert.equal((await request(comments(), 'POST', { content: 'Another user' }, 'other')).status, 201);
  assert.equal((await request(comments())).status, 200);
}));
test('ban/demotion invalidate access and service rechecks live ADMIN privileges', () => fixture(async ({ request, create, authStore, ids, commentService }) => {
  const root = await create(); authStore.users.get(ids.admin)!.role = 'USER';
  assert.equal((await request(moderate(root.id), 'PATCH', { status: 'HIDDEN' }, 'admin')).status, 403);
  await assert.rejects(commentService.moderate(ids.admin, root.id, 'HIDDEN'), (e: any) => e.statusCode === 403 || e.status === 403);
  authStore.users.get(ids.user)!.status = 'BANNED'; assert.equal((await request(myRating(), 'PUT', { score: 5 }, 'user')).status, 401);
}));
test('feedback never exposes password hashes, email, role, sessions or user IDs', () => fixture(async ({ request, create }) => {
  await create(); await request(myRating(), 'PUT', { score: 5 }, 'user');
  for (const url of [ratings(), comments()]) {
    const output = JSON.stringify((await request(url)).body);
    for (const key of ['passwordHash', 'email', 'role', 'userId', 'accessToken', 'refreshToken', 'status']) assert(!output.includes(`"${key}"`));
  }
}));
test('transaction failures rollback and sanitize all errors', () => fixture(async ({ request, store }) => {
  store.failCommits = 1;
  const failure = await request(myRating(), 'PUT', { score: 5 }, 'user'); assert.equal(failure.status, 500); assert.equal(store.ratingRows.length, 0);
  assert(!JSON.stringify(failure.body).includes('PRIVATE'));
  for (const code of ['P2002', 'P2003', 'P2034', 'P2028', '55P03', 'P2025']) {
    store.failCode = code; const r = await request(myRating(), 'PUT', { score: 5 }, 'user'); assert.equal(r.status, code === 'P2025' ? 404 : 409); assert(!JSON.stringify(r.body).includes('PRIVATE'));
  }
}));

test('owner can remove unpublished leaf comments while edit stays blocked; moderation remains available', () => fixture(async ({ request, create, store }) => {
  const root = await create(); store.stories.get(story)!.publishStatus = 'DRAFT';
  assert.equal((await request(comment(root.id), 'PATCH', { content: 'Cannot publish indirectly' }, 'user')).status, 404);
  assert.equal((await request(moderate(root.id), 'PATCH', { status: 'HIDDEN' }, 'admin')).status, 200);
  assert.equal((await request(comment(root.id), 'DELETE', undefined, 'user')).status, 200);
  assert.equal(store.commentRows.length, 0);
}));

test('simultaneous edit and moderation never reset the HIDDEN status', () => fixture(async ({ create, commentService, ids, store, request }) => {
  const root = await create();
  await Promise.allSettled([commentService.edit(ids.user, root.id, 'Edit racing moderation'), commentService.moderate(ids.admin, root.id, 'HIDDEN')]);
  assert.equal(store.commentRows.find((r) => r.id === root.id)!.status, 'HIDDEN');
  assert.deepEqual((await request(comments())).body.data, []);
}));
