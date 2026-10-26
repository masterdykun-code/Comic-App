import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createPrismaFeedbackStore, THREAD_REPLY_LIMIT } from '../src/services/feedback.store';

test('Prisma feedback adapter aggregates scores, bounds replies and scopes writes (mock transaction)', async () => {
  const storyId = '10000000-0000-4000-8000-000000000001';
  const userId = '20000000-0000-4000-8000-000000000001';
  const id = '30000000-0000-4000-8000-000000000001';
  const calls: Array<{ operation: string; args: any }> = [];
  const sql: Array<{ text: string; values: unknown[] }> = []; const configs: any[] = [];
  const row = { id, userId, storyId, parentId: null, content: 'Text', status: 'VISIBLE', createdAt: new Date(), updatedAt: new Date(), user: { username: 'user', displayName: 'User', avatarUrl: null } };
  const op = (operation: string, value: unknown) => async (args: unknown) => { calls.push({ operation, args }); return value; };
  const tx = {
    $queryRaw: async (text: TemplateStringsArray, ...values: unknown[]) => { sql.push({ text: text.join('?'), values }); return []; },
    $executeRaw: async (text: TemplateStringsArray) => { sql.push({ text: text.join('?'), values: [] }); return 0; },
    user: { findFirst: op('user.findFirst', { id: userId }) }, story: { findUnique: op('story.findUnique', { id: storyId, publishStatus: 'PUBLISHED' }) },
    rating: { groupBy: op('rating.groupBy', [1, 4, 5].map((score) => ({ score, _count: { _all: 1 } }))), findMany: op('rating.findMany', []), upsert: op('rating.upsert', {}), deleteMany: op('rating.deleteMany', { count: 1 }) },
    comment: { count: op('comment.count', 2), findFirst: op('comment.findFirst', row), findUnique: op('comment.findUnique', { storyId }),
      findMany: async (args: any) => { calls.push({ operation: 'comment.findMany', args }); return args.select.replies ? [{ ...row, replies: [], _count: { replies: 2 } }] : [row]; },
      create: op('comment.create', row), update: op('comment.update', row), delete: op('comment.delete', row),
    },
  };
  const fake = { $transaction: async (work: (tx: unknown) => Promise<unknown>, options: unknown) => { configs.push(options); return work(tx); } };
  const store = createPrismaFeedbackStore(() => fake as unknown as PrismaClient);
  await store.transaction(storyId, 'write', async (adapter) => {
    assert.equal(sql.length, 2); assert.equal(await adapter.activeUser(userId, true), true); await adapter.story(storyId, true);
    const result = await adapter.ratings(storyId, { page: 2, limit: 1, sort: 'newest' });
    assert.equal(result.total, 3); assert.deepEqual(result.summary, { averageScore: 3.33, totalRatings: 3, distribution: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 1 } });
    await adapter.saveRating(userId, storyId, { score: 5 }); await adapter.deleteRating(userId, storyId);
    const roots = await adapter.roots(storyId, { page: 1, limit: 20, sort: 'oldest' }); assert.equal(roots.data[0].replyCount, 2);
    await adapter.replies(id, storyId, { page: 2, limit: 20, sort: 'oldest' });
    assert.equal(await adapter.commentStoryId(id), storyId); await adapter.comment(id, storyId);
    await adapter.createComment(userId, storyId, { content: 'Text' }); await adapter.editComment(id, 'Edited');
    await adapter.replyCount(id); await adapter.deleteComment(id); await adapter.moderate(id, 'HIDDEN');
  });
  const args = (name: string) => calls.filter((r) => r.operation === name).map((r) => r.args);
  assert.equal(configs[0].isolationLevel, 'ReadCommitted'); assert.match(sql[1].text, /pg_advisory_xact_lock/); assert.deepEqual(sql[1].values, [storyId]);
  assert.match(sql[2].text, /public\.stories.*FOR SHARE/); assert.deepEqual(sql[2].values, [storyId]);
  assert.deepEqual(args('user.findFirst')[0].where, { id: userId, status: 'ACTIVE', role: 'ADMIN' });
  assert.deepEqual(args('user.findFirst')[0].select, { id: true });
  assert.deepEqual(args('rating.groupBy')[0].where, { storyId }); assert.equal(args('rating.findMany')[0].skip, 1);
  const upsert = args('rating.upsert')[0]; assert.deepEqual(upsert.where, { userId_storyId: { userId, storyId } }); assert.deepEqual(upsert.update, { score: 5 });
  assert.deepEqual(upsert.select.user.select, { username: true, displayName: true, avatarUrl: true });
  assert.deepEqual(args('rating.deleteMany')[0].where, { userId, storyId });
  const [roots, replies] = args('comment.findMany');
  assert.deepEqual(roots.where, { storyId, parentId: null, status: 'VISIBLE' });
  assert.equal(roots.select.replies.take, THREAD_REPLY_LIMIT); assert.deepEqual(roots.select.replies.where, { status: 'VISIBLE', storyId });
  assert.deepEqual(roots.select._count.select.replies.where, { status: 'VISIBLE', storyId });
  assert.deepEqual(replies.where, { storyId, parentId: id, status: 'VISIBLE' }); assert.equal(replies.skip, 20);
  assert.deepEqual(args('comment.findFirst')[0].where, { id, storyId }); assert.deepEqual(args('comment.findUnique')[0].select, { storyId: true });
  assert.deepEqual(args('comment.create')[0].data, { userId, storyId, content: 'Text', parentId: null, status: 'VISIBLE' });
  assert.deepEqual(args('comment.update').map((r) => r.data), [{ content: 'Edited' }, { status: 'HIDDEN' }]);
  assert.deepEqual(args('comment.count').at(-1).where, { parentId: id }); // Includes HIDDEN replies for safe deletion.
  const before = sql.length;
  await store.transaction(null, 'read', (adapter) => adapter.story(storyId, false));
  assert.equal(sql.length, before); assert.equal(configs[1].isolationLevel, 'RepeatableRead');
  await assert.rejects(store.transaction(null, 'write', async () => null));
});
