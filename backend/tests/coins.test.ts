import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { createCoinRouter } from '../src/routes/coin.routes';
import {
  coinDay,
  COIN_REWARDS,
  type CoinService,
} from '../src/services/coin.service';
import { createAuthService } from '../src/services/auth.service';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { errorHandler } from '../src/middlewares/error-handler';
process.env.JWT_SECRET = randomBytes(48).toString('hex');
test('fixed rewards and Vietnam calendar use server-side day boundaries', () => {
  assert.deepEqual(COIN_REWARDS, { CHECK_IN: 10, READ_THREE: 20, FAVORITE: 5 });
  assert.equal(coinDay(new Date('2026-10-24T16:59:59.999Z')), '2026-10-24');
  assert.equal(coinDay(new Date('2026-10-24T17:00:00.000Z')), '2026-10-25');
});
async function fixture(
  work: (
    request: (
      path: string,
      method?: string,
      body?: unknown,
      guest?: boolean,
    ) => Promise<{ status: number; body: any }>,
    calls: any[],
    store: MemoryAuthStore,
    id: string,
  ) => Promise<void>,
) {
  const store = new MemoryAuthStore(),
    auth = createAuthService(store),
    user = await auth.register({
      username: 'coin_fixture',
      email: 'coin@example.test',
      password: 'Synthetic-only-123',
    }),
    token = (await auth.login(user.email, 'Synthetic-only-123')).accessToken,
    calls: any[] = [];
  const service: CoinService = {
    wallet: async (id, page, limit) => {
      calls.push(['wallet', id, page, limit]);
      return {
        balance: 0,
        transactions: [],
        pagination: {
          page: page ?? 1,
          limit: limit ?? 20,
          total: 0,
          totalPages: 0,
        },
      };
    },
    tasks: async (id) => {
      calls.push(['tasks', id]);
      return {
        day: '2026-10-24',
        timeZone: 'Asia/Ho_Chi_Minh',
        checkedIn: false,
        checkInReward: 10,
        missions: [],
      };
    },
    claim: async (id, kind) => {
      calls.push(['claim', id, kind]);
      return { received: true, reward: 10, balance: 10 };
    },
    access: async (id, owner) => {
      calls.push(['access', id, owner]);
      return {
        id,
        storyId: randomUUID(),
        title: 'VIP',
        type: 'NOVEL',
        isVip: true,
        coinPrice: 10,
        canRead: false,
      };
    },
    unlock: async (id, chapter, price) => {
      calls.push(['unlock', id, chapter, price]);
      return { unlocked: true, charged: 10, balance: 0 };
    },
  };
  const app = express();
  app.use(express.json());
  app.use(createCoinRouter(service, auth));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  try {
    await work(
      async (path, method = 'GET', body, guest = false) => {
        const r = await fetch(`http://127.0.0.1:${port}/api${path}`, {
          method,
          headers: {
            ...(!guest ? { Authorization: `Bearer ${token}` } : {}),
            ...(body !== undefined
              ? { 'Content-Type': 'application/json' }
              : {}),
          },
          ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        });
        return { status: r.status, body: await r.json() };
      },
      calls,
      store,
      user.id,
    );
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((e) => (e ? reject(e) : resolve()));
      server.closeAllConnections();
    });
  }
}
test('coin routes use authenticated identity and validated server-selected reward', () =>
  fixture(async (request, calls, _store, id) => {
    assert.equal((await request('/me/coins?page=2&limit=10')).status, 200);
    assert.deepEqual(calls.pop(), ['wallet', id, 2, 10]);
    assert.equal((await request('/me/coins/check-in', 'POST', {})).status, 200);
    assert.deepEqual(calls.pop(), ['claim', id, 'CHECK_IN']);
    assert.equal(
      (await request('/me/coins/missions/READ_THREE/claim', 'POST', {})).status,
      200,
    );
    assert.deepEqual(calls.pop(), ['claim', id, 'READ_THREE']);
    const chapter = randomUUID();
    assert.equal(
      (
        await request(`/chapters/${chapter}/unlock`, 'POST', {
          expectedCoinPrice: 10,
        })
      ).status,
      200,
    );
    assert.deepEqual(calls.pop(), ['unlock', id, chapter, 10]);
  }));
test('guest and BANNED accounts cannot operate wallets; public access leaks no content', () =>
  fixture(async (request, calls, store, id) => {
    for (const path of ['/me/coins', '/me/coins/tasks'])
      assert.equal((await request(path, 'GET', undefined, true)).status, 401);
    assert.equal(
      (await request('/me/coins/check-in', 'POST', {}, true)).status,
      401,
    );
    assert.equal(calls.length, 0);
    const r = await request(
      `/chapters/${randomUUID()}/access`,
      'GET',
      undefined,
      true,
    );
    assert.equal(r.status, 200);
    assert.equal(r.body.data.canRead, false);
    assert(!('content' in r.body.data));
    assert(!('pages' in r.body.data));
    store.users.get(id)!.status = 'BANNED';
    assert.equal((await request('/me/coins')).status, 401);
  }));
test('malformed pagination/UUIDs and spoofed rewards or dates never reach coin service', () =>
  fixture(async (request, calls) => {
    for (const path of [
      '/me/coins?limit=101',
      '/me/coins?page=0',
      '/me/coins?page=1&page=2',
      '/me/coins?userId=forged',
      '/chapters/bad/access',
    ])
      assert.equal((await request(path)).status, 400);
    for (const body of [
      { amount: 999 },
      { userId: randomUUID() },
      { day: '2000-01-01' },
      { coinPrice: 0 },
    ])
      assert.equal(
        (await request('/me/coins/check-in', 'POST', body)).status,
        400,
      );
    for (const body of [
      {},
      { expectedCoinPrice: 0 },
      { expectedCoinPrice: 10.5 },
      { expectedCoinPrice: 10, amount: 0 },
    ])
      assert.equal(
        (await request(`/chapters/${randomUUID()}/unlock`, 'POST', body))
          .status,
        400,
      );
    assert.equal(
      (await request('/me/coins/missions/ADMIN/claim', 'POST', {})).status,
      400,
    );
    assert.equal(calls.length, 0);
  }));
test('coin additive migration is atomic and preserves old chapter defaults', async () => {
  const sql = await readFile(
    'prisma/migrations/20261024020000_coin_wallet_vip/migration.sql',
    'utf8',
  );
  assert(!/DROP TABLE|DROP COLUMN|DELETE FROM|TRUNCATE/i.test(sql));
  assert.match(sql, /^BEGIN;/);
  assert.match(sql, /COMMIT;/);
  assert.match(sql, /"is_vip" BOOLEAN NOT NULL DEFAULT false/);
  assert.match(sql, /"coin_price" INTEGER NOT NULL DEFAULT 10/);
  assert.match(sql, /coin_transactions_event_key_key/);
  assert.match(sql, /coin_wallets_balance_check/);
  assert.match(sql, /chapter_unlocks_pkey/);
});

test('coin service maps aborted Prisma transactions to a safe conflict without replaying writes', async () => {
  const { createCoinService } = await import('../src/services/coin.service.js');
  for (const error of [
    { code: 'P2034' },
    { code: 'P2010', meta: { code: '40001' } },
    {
      code: 'P2010',
      meta: { driverAdapterError: { cause: { originalCode: '40P01' } } },
    },
  ]) {
    let calls = 0;
    const fake = {
      $transaction: async () => {
        calls++;
        throw error;
      },
    } as unknown as import('../src/generated/prisma/client').PrismaClient;
    await assert.rejects(
      createCoinService(() => fake).claim(randomUUID(), 'CHECK_IN'),
      { statusCode: 409, code: 'COIN_BUSY' },
    );
    assert.equal(calls, 1);
  }
});
