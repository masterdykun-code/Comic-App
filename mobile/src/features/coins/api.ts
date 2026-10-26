import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import { api } from '../../services/runtime';
import { ApiError } from '../../lib/errors';
const nonnegative = z.number().int().min(0),
  kind = z.enum(['READ_THREE', 'FAVORITE']);
const pagination = z.object({
  page: nonnegative,
  limit: nonnegative,
  total: nonnegative,
  totalPages: nonnegative,
});
const wallet = z.object({
  balance: nonnegative,
  transactions: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['CHECK_IN', 'READ_THREE', 'FAVORITE', 'UNLOCK']),
      amount: z.number().int(),
      balanceAfter: nonnegative,
      description: z.string(),
      createdAt: z.iso.datetime({ offset: true }),
    }),
  ),
  pagination,
});
const tasks = z.object({
  day: z.string(),
  timeZone: z.literal('Asia/Ho_Chi_Minh'),
  checkedIn: z.boolean(),
  checkInReward: z.literal(10),
  missions: z.array(
    z.object({
      kind,
      title: z.string(),
      progress: nonnegative,
      target: nonnegative,
      reward: nonnegative,
      claimed: z.boolean(),
    }),
  ),
});
const access = z.object({
  id: z.uuid(),
  storyId: z.uuid(),
  title: z.string(),
  type: z.enum(['NOVEL', 'COMIC']),
  isVip: z.boolean(),
  coinPrice: nonnegative,
  canRead: z.boolean(),
});
function data<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = z.object({ success: z.literal(true), data: schema }).safeParse(value);
  if (!parsed.success) throw new ApiError(502, 'Dữ liệu Coin chưa hợp lệ.');
  return parsed.data.data;
}
export function createCoinsApi(client: AxiosInstance) {
  return {
    async wallet(page = 1, signal?: AbortSignal) {
      return data(
        wallet,
        (await client.get('/me/coins', { params: { page, limit: 20 }, signal })).data,
      );
    },
    async tasks(signal?: AbortSignal) {
      return data(tasks, (await client.get('/me/coins/tasks', { signal })).data);
    },
    async claim(mission: 'CHECK_IN' | 'READ_THREE' | 'FAVORITE', signal?: AbortSignal) {
      const path =
        mission === 'CHECK_IN'
          ? '/me/coins/check-in'
          : `/me/coins/missions/${kind.parse(mission)}/claim`;
      return data(
        z.object({ received: z.boolean(), reward: nonnegative, balance: nonnegative }),
        (await client.post(path, {}, { signal })).data,
      );
    },
    async access(id: string, signal?: AbortSignal) {
      z.uuid().parse(id);
      const result = data(access, (await client.get(`/chapters/${id}/access`, { signal })).data);
      if (result.id !== id) throw new ApiError(502, 'Thông tin chương không khớp.');
      return result;
    },
    async unlock(id: string, expectedCoinPrice: number, signal?: AbortSignal) {
      z.uuid().parse(id);
      return data(
        z.object({ unlocked: z.literal(true), charged: nonnegative, balance: nonnegative }),
        (await client.post(`/chapters/${id}/unlock`, { expectedCoinPrice }, { signal })).data,
      );
    },
  };
}
export const coinsApi = createCoinsApi(api);
