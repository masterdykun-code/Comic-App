import assert from 'node:assert/strict';
import test from 'node:test';
import { once } from 'node:events';
import express from 'express';
import { createRankingRouter } from '../src/routes/ranking.routes';
import { createRankingService } from '../src/services/ranking.service';
import { createPrismaRankingStore } from '../src/services/ranking.store';
import {
  errorHandler,
  notFoundHandler,
} from '../src/middlewares/error-handler';
import type { PrismaClient } from '../src/generated/prisma/client';
import type { RankedStory, RankingQuery } from '../src/types/ranking.types';
const row: RankedStory = {
  id: '10000000-0000-4000-8000-000000000001',
  title: 'Truyện kiểm thử',
  type: 'COMIC',
  authorName: 'Fixture',
  coverUrl: 'https://example.test/cover.png',
  rank: 1,
  readCount: 12,
  averageScore: 4.5,
  ratingCount: 2,
  updatedAt: new Date('2026-10-24T00:00:00Z'),
};
async function fixture(
  work: (f: {
    request: (
      path?: string,
      method?: string,
    ) => Promise<{ status: number; body: any; cache: string | null }>;
    calls: RankingQuery[];
    fail: () => void;
  }) => Promise<void>,
) {
  const calls: RankingQuery[] = [];
  let broken = false;
  const service = createRankingService({
    list: async (query) => {
      calls.push(query);
      if (broken) throw Error('private connection information');
      return { data: query.page === 1 ? [row] : [], total: 1 };
    },
  });
  const app = express();
  app.use('/api/stories/rankings', createRankingRouter(service));
  app.get('/api/stories/:id', (_req, res) =>
    res.status(400).json({ error: 'detail' }),
  );
  app.use(notFoundHandler);
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  try {
    await work({
      calls,
      fail: () => {
        broken = true;
      },
      request: async (path = '', method = 'GET') => {
        const r = await fetch(
          `http://127.0.0.1:${port}/api/stories/rankings${path}`,
          { method },
        );
        return {
          status: r.status,
          body: await r.json(),
          cache: r.headers.get('cache-control'),
        };
      },
    });
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((e) => (e ? reject(e) : resolve()));
      server.closeAllConnections();
    });
  }
}
test('public ranking defaults and response metadata work without login; not captured as UUID detail', () =>
  fixture(async (f) => {
    const r = await f.request();
    assert.equal(r.status, 200);
    assert.equal(r.cache, 'no-store');
    assert.deepEqual(f.calls, [{ kind: 'reads', page: 1, limit: 20 }]);
    assert.equal(r.body.ranking.readMetric, 'STORED_AUTHENTICATED_HISTORY');
    assert.equal(r.body.data[0].rank, 1);
    assert(!('content' in r.body.data[0]));
    assert(!('createdBy' in r.body.data[0]));
    assert.deepEqual(r.body.pagination, {
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });
  }));
test('three ranking modes, story type and pagination are validated and forwarded', () =>
  fixture(async (f) => {
    for (const kind of ['reads', 'rating', 'updated'])
      assert.equal(
        (await f.request(`?kind=${kind}&type=COMIC&page=2&limit=10`)).status,
        200,
      );
    assert.deepEqual(f.calls.at(-1), {
      kind: 'updated',
      type: 'COMIC',
      page: 2,
      limit: 10,
    });
    assert.deepEqual((await f.request('?page=2')).body.data, []);
  }));
test('invalid, repeated, injected and private filters never reach the store', () =>
  fixture(async (f) => {
    for (const query of [
      'kind=popular',
      'kind=reads&kind=rating',
      'type=comic',
      'type=COMIC&type=NOVEL',
      'page=0',
      'page=1.5',
      'page=1e2',
      'limit=101',
      'limit=0',
      'page=2147483647&limit=100',
      'publishStatus=DRAFT',
      'userId=forged',
      'kind=reads%27%3BDROP%20TABLE%20stories%3B',
    ])
      assert.equal((await f.request(`?${query}`)).status, 400);
    assert.equal(f.calls.length, 0);
    assert.equal((await f.request('', 'POST')).status, 404);
  }));
test('empty rating board has no fabricated stories; internal failures remain sanitized', async () => {
  const empty = createRankingService({
    list: async () => ({ data: [], total: 0 }),
  });
  const r = await empty.list({ kind: 'rating', page: 1, limit: 20 });
  assert.deepEqual(r.data, []);
  assert.equal(r.pagination.totalPages, 0);
  await fixture(async (f) => {
    f.fail();
    const result = await f.request();
    assert.equal(result.status, 500);
    assert(!JSON.stringify(result.body).includes('private connection'));
    assert.equal(result.body.error.code, 'INTERNAL_SERVER_ERROR');
  });
});
test('Prisma ranking adapter uses one bounded snapshot, whitelist projection and parameterized filters', async () => {
  let options: any, where: any, sql: any;
  const store = createPrismaRankingStore(
    () =>
      ({
        $transaction: async (work: any, o: any) => {
          options = o;
          return work({
            story: {
              count: async (q: any) => {
                where = q.where;
                return 25;
              },
            },
            $queryRaw: async (q: any) => {
              sql = q;
              return [{ ...row, rank: 21n, readCount: 12n, ratingCount: 2n }];
            },
          });
        },
      }) as unknown as PrismaClient,
  );
  const r = await store.list({
    kind: 'rating',
    type: 'COMIC',
    page: 2,
    limit: 20,
  });
  assert.equal(options.isolationLevel, 'RepeatableRead');
  assert.equal(options.timeout, 10000);
  assert.deepEqual(where, {
    publishStatus: 'PUBLISHED',
    type: 'COMIC',
    ratings: { some: {} },
  });
  assert.equal(r.data[0]!.rank, 21);
  assert.equal(r.data[0]!.readCount, 12);
  assert(sql.values.includes('COMIC'));
  assert(sql.values.includes(20));
  assert(!sql.sql.includes('COMIC'));
  assert.match(sql.sql, /row_number\(\) OVER/);
  assert.match(sql.sql, /c.publish_status='PUBLISHED'/);
  assert.match(sql.sql, /s.publish_status='PUBLISHED'/);
  assert.match(sql.sql, /rating_count>0/);
  assert(!sql.sql.includes('password_hash'));
  assert(!sql.sql.includes('c.content'));
});
