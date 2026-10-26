import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import { api } from '../../services/runtime';
import { ApiError } from '../../lib/errors';
export const rankingKinds = ['reads', 'rating', 'updated'] as const;
export type RankingKind = (typeof rankingKinds)[number];
export type RankingType = '' | 'NOVEL' | 'COMIC';
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const rankedStory = z
  .object({
    publishStatus: z.literal('PUBLISHED').optional(),
    id: z.uuid(),
    title: z.string(),
    authorName: z.string(),
    coverUrl: z.string().nullable(),
    type: z.enum(['NOVEL', 'COMIC']),
    updatedAt: z.iso.datetime({ offset: true }),
    rank: count.positive(),
    readCount: count,
    averageScore: z.number().min(1).max(5).nullable(),
    ratingCount: count,
  })
  .refine((r) => (r.ratingCount === 0) === (r.averageScore === null))
  .transform(({ publishStatus: _status, ...story }) => story);
export type RankedStory = z.infer<typeof rankedStory>;
const response = z.object({
  success: z.literal(true),
  data: z.array(rankedStory),
  pagination: z.object({
    page: count.positive(),
    limit: count.positive().max(100),
    total: count,
    totalPages: count,
  }),
  ranking: z.object({
    kind: z.enum(rankingKinds),
    readMetric: z.literal('STORED_AUTHENTICATED_HISTORY'),
  }),
});
export function createRankingsApi(client: AxiosInstance) {
  return {
    async list(kind: RankingKind, type: RankingType = '', page = 1, signal?: AbortSignal) {
      const query = z
        .object({
          kind: z.enum(rankingKinds),
          type: z.enum(['', 'NOVEL', 'COMIC']),
          page: z
            .number()
            .int()
            .positive()
            .max(Math.floor(2147483647 / 20) + 1),
        })
        .parse({ kind, type, page });
      const raw = (
        await client.get('/stories/rankings', {
          params: { kind: query.kind, type: query.type || undefined, page: query.page, limit: 20 },
          signal,
        })
      ).data;
      const parsed = response.safeParse(raw);
      if (!parsed.success) throw new ApiError(502, 'Dữ liệu bảng xếp hạng chưa hợp lệ.');
      const result = parsed.data;
      if (
        result.ranking.kind !== kind ||
        result.pagination.page !== page ||
        result.pagination.limit !== 20 ||
        result.pagination.totalPages !== Math.ceil(result.pagination.total / 20) ||
        result.data.length !==
          Math.min(20, Math.max(0, result.pagination.total - (page - 1) * 20)) ||
        new Set(result.data.map((r) => r.id)).size !== result.data.length ||
        result.data.some(
          (r, i) =>
            r.rank !== (page - 1) * 20 + i + 1 ||
            (type && r.type !== type) ||
            (kind === 'rating' && r.ratingCount === 0),
        )
      )
        throw new ApiError(502, 'Dữ liệu bảng xếp hạng không khớp yêu cầu.');
      return result;
    },
  };
}
export const rankingsApi = createRankingsApi(api);
