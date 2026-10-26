import assert from 'node:assert/strict';
import test from 'node:test';
import { Prisma, type PrismaClient } from '../src/generated/prisma/client';
import { createPrismaReadingStore } from '../src/services/reading.store';

test('Prisma reading adapter scopes queries, serializes writes and preserves publication filters (mock transaction)', async () => {
  const userId = '10000000-0000-4000-8000-000000000001';
  const storyId = '20000000-0000-4000-8000-000000000001';
  const chapterId = '30000000-0000-4000-8000-000000000001';
  const sql: Array<{ text: string; values: unknown[] }> = [];
  const calls: Array<{ operation: string; args: any }> = [];
  const now = new Date();
  const row = { id: storyId, storyId, chapterId, progressPercent: new Prisma.Decimal('25.25'), textOffset: 1, pageNumber: null, scrollOffset: null, updatedAt: now,
    story: { id: storyId, title: 'Title', slug: 'title', type: 'NOVEL', coverUrl: 'https://example.test/cover.png', authorName: 'Author' }, chapter: { id: chapterId, chapterNumber: 1, title: 'Chapter' } };
  const operation = (name: string, result: unknown) => async (args: unknown) => { calls.push({ operation: name, args }); return result; };
  const tx = {
    $queryRaw: async (strings: TemplateStringsArray, ...values: unknown[]) => { sql.push({ text: strings.join('?'), values }); return []; },
    $executeRaw: async (strings: TemplateStringsArray) => { sql.push({ text: strings.join('?'), values: [] }); return 0; },
    user: { findFirst: operation('user.findFirst', { id: userId }) },
    story: { findUnique: operation('story.findUnique', null) },
    chapter: { findFirst: operation('chapter.findFirst', null) },
    favorite: { count: operation('favorite.count', 0), findMany: operation('favorite.findMany', []), findUnique: operation('favorite.findUnique', null), create: operation('favorite.create', {}), deleteMany: operation('favorite.deleteMany', { count: 1 }) },
    readingProgress: { count: operation('progress.count', 1), findMany: operation('progress.findMany', [row]), findUnique: operation('progress.findUnique', row), upsert: operation('progress.upsert', row) },
    readingHistory: { count: operation('history.count', 0), findMany: operation('history.findMany', []), findFirst: operation('history.findFirst', null), create: operation('history.create', {}), deleteMany: operation('history.deleteMany', { count: 1 }) },
  };
  const options: Array<any> = [];
  const replacement = async (work: (value: unknown) => Promise<unknown>, config: unknown) => { options.push(config); return work(tx); };
  const prismaReadingStore = createPrismaReadingStore(() => ({ $transaction: replacement }) as unknown as PrismaClient);
    await prismaReadingStore.transaction(userId, 'write', async (adapter) => {
      assert.equal(sql.length, 2); // Lock timeout and advisory lock precede any callback query.
      assert.equal(await adapter.activeUser(userId), true);
      await adapter.story(storyId, true); await adapter.chapter(chapterId, storyId, true);
      await adapter.favorites(userId, { page: 2, limit: 10 }); await adapter.favoriteExists(userId, storyId);
      await adapter.addFavorite(userId, storyId); await adapter.removeFavorite(userId, storyId);
      assert.equal((await adapter.progressList(userId, { page: 1, limit: 20 })).data[0].progressPercent, 25.25);
      assert.equal((await adapter.progress(userId, storyId))!.progressPercent, 25.25);
      await adapter.saveProgress(userId, storyId, { chapterId, textOffset: 1, pageNumber: null, scrollOffset: null, progressPercent: 25.25 }, now);
      await adapter.history(userId, { page: 1, limit: 20 });
      await adapter.recentHistory(userId, storyId, chapterId, now); await adapter.addHistory(userId, storyId, chapterId, now);
      await adapter.clearHistory(userId);
    });
    assert.equal(options[0].isolationLevel, 'ReadCommitted');
    assert.match(sql[1].text, /pg_advisory_xact_lock\(hashtextextended/); assert.deepEqual(sql[1].values, [userId]);
    assert.match(sql[2].text, /public\.stories.*FOR SHARE/); assert.deepEqual(sql[2].values, [storyId]);
    assert.match(sql[3].text, /public\.chapters.*FOR SHARE/); assert.deepEqual(sql[3].values, [chapterId, storyId]);
    const args = (op: string) => calls.find((c) => c.operation === op)!.args;
    assert.deepEqual(args('user.findFirst').select, { id: true });
    assert.deepEqual(args('favorite.deleteMany').where, { userId, storyId });
    assert.deepEqual(args('history.deleteMany').where, { userId });
    assert.deepEqual(args('favorite.findMany').where, { userId, story: { publishStatus: 'PUBLISHED' } });
    assert.equal(args('favorite.findMany').skip, 10);
    for (const op of ['progress.findMany', 'history.findMany']) assert.deepEqual(args(op).where, { userId, story: { publishStatus: 'PUBLISHED' }, chapter: { publishStatus: 'PUBLISHED' } });
    assert.deepEqual(args('progress.upsert').where, { userId_storyId: { userId, storyId } });
    assert.equal(args('progress.upsert').update.updatedAt, now);
    assert.deepEqual(args('history.findFirst').where, { userId, storyId, chapterId, readAt: { gte: now } });
    const sqlBeforeRead = sql.length;
    await prismaReadingStore.transaction(userId, 'read', (adapter) => adapter.progress(userId, storyId));
    assert.equal(sql.length, sqlBeforeRead); assert.equal(options[1].isolationLevel, 'RepeatableRead');
});
