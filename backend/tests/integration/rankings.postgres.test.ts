import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { configureIntegration, APP_TABLES } from './environment';
test('rankings PostgreSQL: real aggregates, published filters, stable order, rollback-only fixtures', async (t) => {
  configureIntegration();
  const { getPrismaClient, disconnectPrisma } =
    await import('../../src/config/prisma.js');
  const { createPrismaRankingStore } =
    await import('../../src/services/ranking.store.js');
  const { createRankingService } =
    await import('../../src/services/ranking.service.js');
  const db = getPrismaClient();
  const identity = async () => {
    const r = await db.$queryRaw<
      Array<{ name: string; schema: string }>
    >`SELECT current_database() AS name,current_schema() AS schema`;
    assert.equal(r[0]?.name, 'webnovel_test_db');
    assert.equal(r[0]?.schema, 'public');
  };
  const counts = async () => {
    const result: Record<string, number> = {};
    for (const table of APP_TABLES) {
      assert(/^[a-z_]+$/.test(table));
      result[table] = Number(
        (
          await db.$queryRawUnsafe<Array<{ n: bigint }>>(
            `SELECT count(*) AS n FROM public."${table}"`,
          )
        )[0]!.n,
      );
    }
    return result;
  };
  const rollback = Error('ROLLBACK_RANKING_FIXTURES');
  try {
    await identity();
    const before = await counts();
    if ((await db.story.count()) > 90) {
      t.skip('More than 90 existing test stories; no fixtures created.');
      return;
    }
    await assert.rejects(
      db.$transaction(
        async (tx) => {
          const users = [randomUUID(), randomUUID(), randomUUID()],
            ids: string[] = Array.from({ length: 5 }, () => randomUUID()),
            chapters = Array.from({ length: 6 }, () => randomUUID()),
            prefix = `rankqa_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
          await tx.user.createMany({
            data: users.map((id, i) => ({
              id,
              username: `${prefix}_${i}`,
              email: `${prefix}_${i}@example.test`,
              displayName: 'Ranking fixture',
              role: i === 2 ? 'ADMIN' : 'USER',
            })),
          });
          for (const [i, id] of ids.entries())
            await tx.story.create({
              data: {
                id,
                title: `${prefix} ${i}`,
                slug: `${prefix}-${i}`,
                authorName: 'Test only',
                description: 'Rollback-only fixture',
                coverUrl: 'https://example.test/cover.png',
                createdBy: users[2]!,
                type: i === 1 || i === 4 ? 'COMIC' : 'NOVEL',
                publishStatus: i === 3 ? 'DRAFT' : 'PUBLISHED',
                updatedAt: new Date(
                  i === 2
                    ? '2050-01-04T00:00:00Z'
                    : i === 0
                      ? '2050-01-01T00:00:00Z'
                      : '2050-01-03T00:00:00Z',
                ),
              },
            });
          for (const [i, id] of chapters.entries())
            await tx.chapter.create({
              data: {
                id,
                storyId: ids[i === 5 ? 0 : i]!,
                chapterNumber: i === 5 ? 2 : 1,
                title: 'Fixture chapter',
                content: i === 1 || i === 4 ? null : 'Text',
                publishStatus: i === 5 ? 'DRAFT' : 'PUBLISHED',
              },
            });
          for (const [storyIndex, n] of [
            [0, 3],
            [1, 1],
            [3, 4],
            [4, 1],
            [5, 4],
          ] as const)
            for (let j = 0; j < n; j++)
              await tx.readingHistory.create({
                data: {
                  userId: users[0]!,
                  storyId: ids[storyIndex === 5 ? 0 : storyIndex]!,
                  chapterId: chapters[storyIndex]!,
                  readAt: new Date(Date.UTC(2049, 0, 1, 0, j)),
                },
              });
          for (const [s, u, score] of [
            [0, 0, 4],
            [0, 1, 5],
            [1, 0, 5],
            [4, 0, 5],
            [4, 1, 5],
            [3, 0, 5],
            [3, 1, 5],
            [3, 2, 5],
          ] as const)
            await tx.rating.create({
              data: { userId: users[u]!, storyId: ids[s]!, score },
            });
          const injected = {
            $transaction: (work: any) => work(tx),
          } as unknown as PrismaClient;
          const service = createRankingService(
            createPrismaRankingStore(() => injected),
          );
          const query = { kind: 'reads' as const, page: 1, limit: 100 };
          await t.test(
            'published stories only; reads exclude draft chapters; aggregates do not multiply',
            async () => {
              const r = await service.list(query);
              const own = r.data.filter((s) => ids.includes(s.id));
              assert.equal(own.length, 4);
              assert(!r.data.some((s) => s.id === ids[3]));
              assert.equal(own.find((s) => s.id === ids[0])!.readCount, 3);
              assert.equal(own.find((s) => s.id === ids[0])!.ratingCount, 2);
              assert.equal(own.find((s) => s.id === ids[0])!.averageScore, 4.5);
              assert.equal(own.find((s) => s.id === ids[2])!.readCount, 0);
              assert.equal(
                own.find((s) => s.id === ids[2])!.averageScore,
                null,
              );
              assert.equal(own[0]!.id, ids[0]);
              const tied = [ids[1]!, ids[4]!].sort();
              assert.deepEqual(
                own.slice(1, 3).map((s) => s.id),
                tied,
              );
              assert(r.data.every((s, i) => s.rank === i + 1));
            },
          );
          await t.test(
            'rating board uses average first, then vote count, excludes unrated/draft',
            async () => {
              const r = await service.list({ ...query, kind: 'rating' }),
                own = r.data.filter((s) => ids.includes(s.id));
              assert.deepEqual(
                own.map((s) => s.id),
                [ids[4], ids[1], ids[0]],
              );
              assert(
                r.data.every(
                  (s) => s.ratingCount > 0 && s.averageScore !== null,
                ),
              );
            },
          );
          await t.test(
            'updated board, both type filters and offset ranks are correct',
            async () => {
              const r = await service.list({ ...query, kind: 'updated' }),
                own = r.data.filter((s) => ids.includes(s.id));
              assert.equal(own[0]!.id, ids[2]);
              for (const type of ['NOVEL', 'COMIC'] as const) {
                const filtered = await service.list({ ...query, type });
                assert(filtered.data.every((s) => s.type === type));
                assert.equal(
                  filtered.data.filter((s) => ids.includes(s.id)).length,
                  2,
                );
              }
              const second = await service.list({
                ...query,
                page: 2,
                limit: 2,
              });
              assert.equal(second.data.length, 2);
              assert.deepEqual(
                second.data.map((s) => s.rank),
                [3, 4],
              );
              const beyond = await service.list({ ...query, page: 100 });
              assert.deepEqual(beyond.data, []);
              assert.equal(beyond.pagination.total, r.pagination.total);
            },
          );
          await t.test(
            'unpublishing a fixture immediately removes it and its ratings from every board',
            async () => {
              await tx.story.update({
                where: { id: ids[0]! },
                data: { publishStatus: 'DRAFT' },
              });
              for (const kind of ['reads', 'rating', 'updated'] as const)
                assert(
                  !(await service.list({ ...query, kind })).data.some(
                    (s) => s.id === ids[0],
                  ),
                );
            },
          );
          throw rollback;
        },
        { isolationLevel: 'RepeatableRead', timeout: 30000 },
      ),
      (error) => error === rollback,
    );
    await identity();
    assert.deepEqual(await counts(), before);
  } finally {
    await disconnectPrisma();
  }
});
