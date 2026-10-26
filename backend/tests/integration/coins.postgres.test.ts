import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { configureIntegration, APP_TABLES } from './environment';
import { Client } from 'pg';
import { verifySchema } from './database';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client';
test('Coin/VIP PostgreSQL and HTTP: owned fixtures only, real concurrent transactions', async (t) => {
  const raw = configureIntegration();
  const { getPrismaClient, disconnectPrisma } =
    await import('../../src/config/prisma.js');
  const { createCoinService, coinDay } =
    await import('../../src/services/coin.service.js');
  const { createCoinRouter } = await import('../../src/routes/coin.routes.js');
  const { createChapterRouter } =
    await import('../../src/routes/chapter.routes.js');
  const { createFavoriteRouter } =
    await import('../../src/routes/favorite.routes.js');
  const { createReadingHistoryRouter } =
    await import('../../src/routes/reading-history.routes.js');
  const { authService } = await import('../../src/services/auth.service.js');
  const { errorHandler } =
    await import('../../src/middlewares/error-handler.js');
  const { hashPassword } = await import('../../src/utils/password.js');
  const db = getPrismaClient(),
    db2 = new PrismaClient({
      adapter: new PrismaPg({ connectionString: raw }),
      log: [],
    });
  const service = createCoinService(),
    service2 = createCoinService(() => db2);
  const users = [randomUUID(), randomUUID(), randomUUID()],
    stories = [randomUUID(), randomUUID()],
    genre = randomUUID();
  const chapters = Array.from({ length: 5 }, () => randomUUID()),
    prefix = `coinqa_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const password = randomBytes(20).toString('hex');
  let ready = false;
  async function identity() {
    const rows = await db.$queryRaw<
      Array<{ name: string; schema: string }>
    >`SELECT current_database() AS name,current_schema() AS schema`;
    assert.equal(rows[0]?.name, 'webnovel_test_db');
    assert.equal(rows[0]?.schema, 'public');
  }
  async function counts() {
    const result: Record<string, number> = {};
    for (const name of APP_TABLES) {
      assert(/^[a-z_]+$/.test(name));
      result[name] = Number(
        (
          await db.$queryRawUnsafe<Array<{ n: bigint }>>(
            `SELECT count(*) AS n FROM public."${name}"`,
          )
        )[0]!.n,
      );
    }
    return result;
  }
  await identity();
  const before = await counts();
  const app = express();
  app.use(createChapterRouter());
  app.use(express.json());
  app.use(createCoinRouter());
  app.use('/api/me/favorites', createFavoriteRouter());
  app.use('/api/me/reading-history', createReadingHistoryRouter());
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  const tokens: string[] = [];
  async function request(
    path: string,
    method = 'GET',
    body?: unknown,
    actor = 0,
  ) {
    const response = await fetch(`http://127.0.0.1:${port}/api${path}`, {
      method,
      headers: {
        ...(tokens[actor] ? { Authorization: `Bearer ${tokens[actor]}` } : {}),
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get('cache-control'),
    };
  }
  try {
    const passwordHash = await hashPassword(password);
    await identity();
    await db.$transaction(async (tx) => {
      await tx.user.createMany({
        data: users.map((id, i) => ({
          id,
          username: `${prefix}_${i}`,
          email: `${prefix}_${i}@example.test`,
          displayName: 'Coin QA fixture',
          role: i === 2 ? 'ADMIN' : 'USER',
          passwordHash,
        })),
      });
      await tx.genre.create({
        data: { id: genre, name: prefix, slug: prefix },
      });
      for (const [i, id] of stories.entries())
        await tx.story.create({
          data: {
            id,
            title: `${prefix} ${i}`,
            slug: `${prefix}-${i}`,
            type: i === 0 ? 'NOVEL' : 'COMIC',
            authorName: 'Test fixture',
            description: 'Controlled local test only',
            coverUrl: 'https://example.test/cover.png',
            createdBy: users[2]!,
            publishStatus: 'PUBLISHED',
            genres: { create: { genreId: genre } },
          },
        });
      for (const [i, id] of chapters.entries())
        await tx.chapter.create({
          data: {
            id,
            storyId: stories[i === 4 ? 1 : 0]!,
            chapterNumber: i === 4 ? 1 : i + 1,
            title: `Fixture ${i}`,
            content:
              i === 4
                ? null
                : 'Nội dung kiểm thử riêng.\nKhông phải dữ liệu thật.',
            publishStatus: 'PUBLISHED',
            isVip: i === 0 || i === 4,
            ...(i === 4
              ? {
                  pages: {
                    create: [
                      {
                        pageNumber: 1,
                        imageUrl: 'https://example.test/page-1.png',
                      },
                      {
                        pageNumber: 2,
                        imageUrl: 'https://example.test/page-2.png',
                      },
                    ],
                  },
                }
              : {}),
          },
        });
    });
    ready = true;
    for (let i = 0; i < 3; i++)
      tokens.push(
        (await authService.login(`${prefix}_${i}@example.test`, password))
          .accessToken,
      );
    await t.test(
      'all migrations, constraints, indexes and new column guards match PostgreSQL',
      async () => {
        const guard = new Client({
          connectionString: raw,
          options: '-c default_transaction_read_only=on',
        });
        await guard.connect();
        try {
          await verifySchema(guard);
        } finally {
          await guard.end();
        }
      },
    );
    await t.test(
      'empty wallet reads do not create wallets; all private endpoints require login',
      async () => {
        const r = await request('/me/coins');
        assert.equal(r.status, 200);
        assert.equal(r.body.data.balance, 0);
        assert.deepEqual(r.body.data.transactions, []);
        assert.equal(r.cache, 'no-store');
        assert.equal(
          await db.coinWallet.count({ where: { userId: { in: users } } }),
          0,
        );
        for (const [path, method, body] of [
          ['/me/coins', 'GET', undefined],
          ['/me/coins/tasks', 'GET', undefined],
          ['/me/coins/check-in', 'POST', {}],
          [
            `/chapters/${chapters[0]}/unlock`,
            'POST',
            { expectedCoinPrice: 10 },
          ],
        ] as const)
          assert.equal((await request(path, method, body, 9)).status, 401);
      },
    );
    await t.test(
      'Vietnam day boundary is fixed; simultaneous check-in credits exactly once across two clients',
      async () => {
        assert.equal(coinDay(new Date('2026-10-24T16:59:59Z')), '2026-10-24');
        assert.equal(coinDay(new Date('2026-10-24T17:00:00Z')), '2026-10-25');
        const rows = await Promise.all(
          Array.from({ length: 8 }, (_, i) =>
            (i % 2 ? service : service2).claim(users[0]!, 'CHECK_IN'),
          ),
        );
        assert.equal(rows.filter((r) => r.received).length, 1);
        assert.equal((await service.wallet(users[0]!)).balance, 10);
        assert.equal(
          await db.coinTransaction.count({
            where: { userId: users[0], kind: 'CHECK_IN' },
          }),
          1,
        );
      },
    );
    await t.test(
      'incomplete missions cannot claim; one new favorite unlocks reward once and removal retains progress',
      async () => {
        for (const kind of ['FAVORITE', 'READ_THREE'])
          assert.equal(
            (await request(`/me/coins/missions/${kind}/claim`, 'POST', {})).body
              .error.code,
            'MISSION_NOT_READY',
          );
        assert.equal(
          (await request('/me/favorites', 'POST', { storyId: stories[0] }))
            .status,
          201,
        );
        const rows = await Promise.all([
          service.claim(users[0]!, 'FAVORITE'),
          service2.claim(users[0]!, 'FAVORITE'),
        ]);
        assert.equal(rows.filter((r) => r.received).length, 1);
        assert.equal((await service.wallet(users[0]!)).balance, 15);
        await request(`/me/favorites/${stories[0]}`, 'DELETE');
        assert.equal((await service.tasks(users[0]!)).missions[1]!.progress, 1);
      },
    );
    await t.test(
      'three distinct chapter history visits earn 20; repeated visits and clearing history cannot farm rewards',
      async () => {
        const visit = (id: string) =>
          request('/me/reading-history', 'POST', {
            storyId: stories[0],
            chapterId: id,
          });
        assert.equal((await visit(chapters[1]!)).status, 201);
        await visit(chapters[1]!);
        assert.equal((await service.tasks(users[0]!)).missions[0]!.progress, 1);
        await visit(chapters[2]!);
        await visit(chapters[3]!);
        const claimed = await Promise.all([
          service.claim(users[0]!, 'READ_THREE'),
          service2.claim(users[0]!, 'READ_THREE'),
        ]);
        assert.equal(claimed.filter((r) => r.received).length, 1);
        assert.equal((await service.wallet(users[0]!)).balance, 35);
        await request('/me/reading-history', 'DELETE');
        assert.equal((await service.tasks(users[0]!)).missions[0]!.progress, 3);
        assert.equal((await service.claim(users[0]!, 'READ_THREE')).reward, 0);
      },
    );
    await t.test(
      'locked NOVEL/COMIC never expose text or image URLs; active ADMIN can read and manage',
      async () => {
        for (const id of [chapters[0], chapters[4]])
          for (const actor of [0, 1, 9]) {
            const r = await request(`/chapters/${id}`, 'GET', undefined, actor);
            assert.equal(r.status, 402);
            assert.equal(r.body.error.code, 'CHAPTER_LOCKED');
            assert(!('data' in r.body));
            assert(!JSON.stringify(r.body).includes('example.test/page'));
          }
        assert.equal(
          (await request(`/chapters/${chapters[0]}`, 'GET', undefined, 2))
            .status,
          200,
        );
        const access = await request(
          `/chapters/${chapters[4]}/access`,
          'GET',
          undefined,
          9,
        );
        assert.equal(access.body.data.canRead, false);
        assert.equal(access.body.data.coinPrice, 10);
        assert(!JSON.stringify(access.body).includes('imageUrl'));
        assert.equal(
          (
            await request(`/admin/chapters/${chapters[0]}`, 'PATCH', {
              isVip: false,
            })
          ).status,
          403,
        );
        assert.equal(
          (
            await request(
              '/me/reading-history',
              'POST',
              { storyId: stories[0], chapterId: chapters[0] },
              1,
            )
          ).status,
          402,
        );
      },
    );
    await t.test(
      'insufficient balance and stale price roll back every debit/grant',
      async () => {
        assert.equal(
          (
            await request(
              `/chapters/${chapters[0]}/unlock`,
              'POST',
              { expectedCoinPrice: 10 },
              1,
            )
          ).body.error.code,
          'INSUFFICIENT_COINS',
        );
        assert.equal(
          await db.coinWallet.count({ where: { userId: users[1] } }),
          0,
        );
        assert.equal(
          (
            await request(`/chapters/${chapters[0]}/unlock`, 'POST', {
              expectedCoinPrice: 9,
            })
          ).body.error.code,
          'VIP_PRICE_CHANGED',
        );
        assert.equal((await service.wallet(users[0]!)).balance, 35);
        assert.equal(
          await db.chapterUnlock.count({ where: { userId: { in: users } } }),
          0,
        );
      },
    );
    await t.test(
      'duplicate unlock charges once, grants access for both types and keeps another user locked',
      async () => {
        const rows = await Promise.all([
          service.unlock(users[0]!, chapters[0]!, 10),
          service2.unlock(users[0]!, chapters[0]!, 10),
        ]);
        assert.equal(
          rows.reduce((n, r) => n + r.charged, 0),
          10,
        );
        assert.equal(
          (
            await request(`/chapters/${chapters[4]}/unlock`, 'POST', {
              expectedCoinPrice: 10,
            })
          ).body.data.charged,
          10,
        );
        assert.equal((await service.wallet(users[0]!)).balance, 15);
        assert.equal(
          (await request(`/chapters/${chapters[0]}`)).body.data.content,
          'Nội dung kiểm thử riêng.\nKhông phải dữ liệu thật.',
        );
        assert.deepEqual(
          (await request(`/chapters/${chapters[4]}`)).body.data.pages.map(
            (p: any) => p.pageNumber,
          ),
          [1, 2],
        );
        assert.equal(
          (await request(`/chapters/${chapters[0]}`, 'GET', undefined, 1))
            .status,
          402,
        );
        assert.equal(
          (await service.unlock(users[0]!, chapters[0]!, 10)).charged,
          0,
        );
      },
    );
    await t.test(
      'two different purchases racing for 10 coins cannot overdraw the same wallet',
      async () => {
        await service.claim(users[1]!, 'CHECK_IN');
        const results = await Promise.allSettled([
          service.unlock(users[1]!, chapters[0]!, 10),
          service2.unlock(users[1]!, chapters[4]!, 10),
        ]);
        assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
        assert.equal((await service.wallet(users[1]!)).balance, 0);
        assert.equal(
          await db.chapterUnlock.count({ where: { userId: users[1] } }),
          1,
        );
      },
    );
    await t.test(
      'database failure after debit rolls back balance, ledger and grant',
      async () => {
        const nextDay = createCoinService(
          () => db,
          () => Date.now() + 86400000,
        );
        await nextDay.claim(users[1]!, 'CHECK_IN');
        const target = (await db.chapterUnlock.findUnique({
          where: {
            userId_chapterId: { userId: users[1]!, chapterId: chapters[0]! },
          },
        }))
          ? chapters[4]!
          : chapters[0]!;
        const broken = {
          $transaction: (
            work: (tx: Prisma.TransactionClient) => Promise<unknown>,
            options: unknown,
          ) =>
            db.$transaction(
              (tx) =>
                work(
                  new Proxy(tx, {
                    get(obj, key) {
                      if (key === 'coinTransaction')
                        return new Proxy(obj.coinTransaction, {
                          get(delegate, method) {
                            if (method === 'create')
                              return () => {
                                throw Error('Injected ledger rollback');
                              };
                            const value = Reflect.get(delegate, method);
                            return typeof value === 'function'
                              ? value.bind(delegate)
                              : value;
                          },
                        });
                      const value = Reflect.get(obj, key);
                      return typeof value === 'function'
                        ? value.bind(obj)
                        : value;
                    },
                  }),
                ),
              options as never,
            ),
        } as unknown as PrismaClient;
        await assert.rejects(
          createCoinService(() => broken).unlock(users[1]!, target, 10),
          /Injected ledger rollback/,
        );
        assert.equal((await service.wallet(users[1]!)).balance, 10);
        assert.equal(
          await db.chapterUnlock.count({ where: { userId: users[1] } }),
          1,
        );
      },
    );
    await t.test(
      'ADMIN can switch FREE/VIP for NOVEL and COMIC; prior grants remain valid after price change',
      async () => {
        for (const id of [chapters[0], chapters[4]]) {
          const detail = await request(
            `/admin/chapters/${id}`,
            'GET',
            undefined,
            2,
          );
          const free = await request(
            `/admin/chapters/${id}`,
            'PATCH',
            { isVip: false, expectedUpdatedAt: detail.body.data.updatedAt },
            2,
          );
          assert.equal(free.status, 200);
          assert.equal(
            (await request(`/chapters/${id}`, 'GET', undefined, 9)).status,
            200,
          );
          const vip = await request(
            `/admin/chapters/${id}`,
            'PATCH',
            {
              isVip: true,
              coinPrice: 25,
              expectedUpdatedAt: free.body.data.updatedAt,
            },
            2,
          );
          assert.equal(vip.status, 200);
          assert.equal(
            (await request(`/chapters/${id}`, 'GET', undefined, 9)).status,
            402,
          );
          assert.equal((await request(`/chapters/${id}`)).status, 200);
          assert.equal((await service.unlock(users[0]!, id!, 10)).charged, 0);
        }
      },
    );
    await t.test(
      'database CHECKs reject negative balances/bad rewards/prices; HTTP rejects spoofed amounts/day/user',
      async () => {
        await assert.rejects(
          db.coinWallet.update({
            where: { userId: users[0]! },
            data: { balance: -1 },
          }),
        );
        await assert.rejects(
          db.chapter.update({
            where: { id: chapters[0]! },
            data: { coinPrice: 0 },
          }),
        );
        await assert.rejects(
          db.coinTransaction.create({
            data: {
              userId: users[0]!,
              eventKey: randomUUID(),
              kind: 'CHECK_IN',
              amount: 100,
              balanceAfter: 100,
              description: 'Rejected fixture',
            },
          }),
        );
        for (const [path, body] of [
          ['/me/coins/check-in', { amount: 100 }],
          ['/me/coins/check-in', { day: '2000-01-01' }],
          ['/me/coins/missions/FAVORITE/claim', { userId: users[1] }],
          [`/chapters/${chapters[0]}/unlock`, {}],
        ] as const)
          assert.equal((await request(path, 'POST', body)).status, 400);
        assert.equal((await request('/me/coins?limit=101')).status, 400);
        assert.equal(
          (await request('/me/coins/missions/ADMIN/claim', 'POST', {})).status,
          400,
        );
        const w = await service.wallet(users[0]!, 1, 2);
        assert.equal(w.transactions.length, 2);
        assert.equal(w.pagination.total, 5);
        assert.equal(w.balance, 15);
      },
    );
    await t.test(
      'ledger sum equals wallet; banned account loses coin and VIP access immediately',
      async () => {
        for (const id of users.slice(0, 2)) {
          const sum = await db.coinTransaction.aggregate({
            where: { userId: id },
            _sum: { amount: true },
          });
          assert.equal((await service.wallet(id!)).balance, sum._sum.amount);
        }
        await identity();
        await db.user.update({
          where: { id: users[0]! },
          data: { status: 'BANNED' },
        });
        assert.equal((await request('/me/coins')).status, 401);
        assert.equal((await request(`/chapters/${chapters[0]}`)).status, 401);
      },
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
      server.closeAllConnections();
    });
    if (ready) {
      await identity();
      const owners = await db.user.findMany({
        where: { id: { in: users }, username: { startsWith: prefix } },
        select: { id: true },
      });
      assert.equal(owners.length, 3);
      await db.$transaction(async (tx) => {
        await tx.coinTransaction.deleteMany({
          where: { userId: { in: users } },
        });
        await tx.coinWallet.deleteMany({ where: { userId: { in: users } } });
        await tx.coinDailyActivity.deleteMany({
          where: { userId: { in: users } },
        });
        await tx.chapterUnlock.deleteMany({
          where: { userId: { in: users }, chapterId: { in: chapters } },
        });
        await tx.favorite.deleteMany({ where: { userId: { in: users } } });
        await tx.readingHistory.deleteMany({
          where: { userId: { in: users } },
        });
        await tx.chapterPage.deleteMany({
          where: { chapterId: { in: chapters } },
        });
        await tx.chapter.deleteMany({
          where: { id: { in: chapters }, storyId: { in: stories } },
        });
        await tx.storyGenre.deleteMany({
          where: { storyId: { in: stories }, genreId: genre },
        });
        await tx.story.deleteMany({
          where: { id: { in: stories }, createdBy: users[2] },
        });
        await tx.genre.delete({ where: { id: genre } });
        await tx.refreshToken.deleteMany({
          where: { session: { userId: { in: users } } },
        });
        await tx.authSession.deleteMany({ where: { userId: { in: users } } });
        await tx.user.deleteMany({
          where: { id: { in: users }, username: { startsWith: prefix } },
        });
      });
      assert.deepEqual(await counts(), before);
    }
    await db2.$disconnect();
    await disconnectPrisma();
  }
});
