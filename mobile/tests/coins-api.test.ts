import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { createCoinsApi } from '../src/features/coins/api';
import { safeError } from '../src/lib/errors';
const client = axios.create(),
  mock = new MockAdapter(client),
  api = createCoinsApi(client);
const id = '20000000-0000-4000-8000-000000000001';
afterEach(() => mock.reset());
afterAll(() => mock.restore());
test('wallet parses integer balances and whitelists ledger fields', async () => {
  mock.onGet('/me/coins').reply(200, {
    success: true,
    data: {
      balance: 10,
      transactions: [
        {
          id,
          kind: 'CHECK_IN',
          amount: 10,
          balanceAfter: 10,
          description: 'Điểm danh',
          createdAt: '2026-10-24T00:00:00Z',
          eventKey: 'private',
          userId: 'private',
        },
      ],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
  });
  const result = await api.wallet();
  expect(result.balance).toBe(10);
  expect(result.transactions[0]).not.toHaveProperty('eventKey');
  expect(result.transactions[0]).not.toHaveProperty('userId');
});
test('invalid balances or malformed responses fail safely', async () => {
  mock.onGet('/me/coins').reply(200, {
    success: true,
    data: {
      balance: -1,
      transactions: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
  });
  await expect(api.wallet()).rejects.toMatchObject({ status: 502 });
});
test('reward requests never send user/day/amount and unlock includes confirmed price', async () => {
  mock
    .onPost('/me/coins/check-in')
    .reply(200, { success: true, data: { received: true, reward: 10, balance: 10 } });
  mock
    .onPost('/me/coins/missions/FAVORITE/claim')
    .reply(200, { success: true, data: { received: true, reward: 5, balance: 15 } });
  mock
    .onPost(`/chapters/${id}/unlock`)
    .reply(200, { success: true, data: { unlocked: true, charged: 10, balance: 5 } });
  await api.claim('CHECK_IN');
  await api.claim('FAVORITE');
  await api.unlock(id, 10);
  expect(mock.history.post.map((r) => JSON.parse(r.data as string))).toEqual([
    {},
    {},
    { expectedCoinPrice: 10 },
  ]);
});
test('invalid chapter UUID does not send network request', async () => {
  await expect(api.access('bad')).rejects.toThrow();
  await expect(api.unlock('bad', 10)).rejects.toThrow();
  expect(mock.history.post).toHaveLength(0);
  expect(mock.history.get).toHaveLength(0);
});
test('known coin errors retain safe codes without reflecting raw messages/secrets', async () => {
  mock.onPost(`/chapters/${id}/unlock`).reply(409, {
    success: false,
    message: 'private connection secret',
    error: { code: 'INSUFFICIENT_COINS' },
  });
  try {
    await api.unlock(id, 10);
    throw Error('Expected rejection');
  } catch (error) {
    const result = safeError(error);
    expect(result).toMatchObject({ status: 409, code: 'INSUFFICIENT_COINS' });
    expect(result.message).toContain('chưa đủ Coin');
    expect(JSON.stringify(result)).not.toContain('secret');
  }
});
