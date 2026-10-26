import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '../src/generated/prisma/client';
import { createPrismaAdminGenreStore } from '../src/services/admin-genre.store';
import { createPrismaAdminCommentStore } from '../src/services/admin-comment.store';

test('genre adapter locks before checking usage and never deletes StoryGenre (mock Prisma)', async () => {
  const id = '30000000-0000-4000-8000-000000000001'; const calls: string[] = []; let options: any; let sqlValues: unknown[] = [];
  const tx = { $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => { assert.match(parts.join('?'), /public\.genres.*FOR UPDATE/); sqlValues = values; calls.push('lock'); return []; }, user: { findFirst: async (args: any) => { assert.deepEqual(args, { where: { id, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } }); return { id }; } }, genre: { findUnique: async () => { calls.push('find'); return { id, name: 'Name', slug: 'name', createdAt: new Date() }; }, delete: async (args: any) => { assert.deepEqual(args, { where: { id } }); calls.push('deleteGenre'); } }, storyGenre: { count: async (args: any) => { assert.deepEqual(args, { where: { genreId: id } }); calls.push('usage'); return 0; } } };
  const client = { $transaction: async (work: (tx: unknown) => Promise<unknown>, config: unknown) => { options = config; return work(tx); } };
  const store = createPrismaAdminGenreStore(() => client as unknown as PrismaClient);
  await store.transaction(async (adapter) => { assert.equal(await adapter.adminIsActive(id), true); await adapter.find(id); await adapter.usage(id); await adapter.remove(id); });
  assert.equal(options.isolationLevel, 'Serializable'); assert.deepEqual(sqlValues, [id]); assert.deepEqual(calls, ['lock', 'find', 'usage', 'deleteGenre']);
});

test('admin comment read uses one bounded snapshot and a safe author whitelist (mock Prisma)', async () => {
  const id = '30000000-0000-4000-8000-000000000001'; let options: any; let counted: any; let listed: any;
  const tx = { user: { findFirst: async () => ({ id }) }, comment: { count: async (args: unknown) => { counted = args; return 21; }, findMany: async (args: unknown) => { listed = args; return [{ id, _count: { replies: 4 } }]; } } };
  const client = { $transaction: async (work: (tx: unknown) => Promise<unknown>, config: unknown) => { options = config; return work(tx); } };
  const store = createPrismaAdminCommentStore(() => client as unknown as PrismaClient);
  const result = await store.transaction(async (adapter) => { await adapter.adminIsActive(id); return adapter.list({ page: 2, limit: 20, sort: 'oldest', status: 'HIDDEN', storyId: id, parentId: id }); });
  assert.equal(options.isolationLevel, 'RepeatableRead'); assert.deepEqual(listed.where, counted.where); assert.deepEqual(counted.where, { storyId: id, status: 'HIDDEN', parentId: id });
  assert.equal(listed.skip, 20); assert.equal(listed.take, 20); assert.deepEqual(listed.orderBy, [{ createdAt: 'asc' }, { id: 'asc' }]);
  assert.deepEqual(listed.select.user.select, { username: true, displayName: true, avatarUrl: true }); assert.deepEqual(listed.select.parent.select.user.select, listed.select.user.select);
  for (const forbidden of ['passwordHash', 'email', 'refreshToken']) assert.equal(JSON.stringify(listed.select).includes(forbidden), false);
  assert.equal(result.total, 21); assert.equal(result.data[0].replyCount, 4); assert.equal('_count' in result.data[0], false);
});
