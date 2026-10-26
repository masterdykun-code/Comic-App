import type { RankingQuery, RankingStore } from '../types/ranking.types';
import { prismaRankingStore } from './ranking.store';
export function createRankingService(store: RankingStore = prismaRankingStore) {
  return {
    async list(query: RankingQuery) {
      const { data, total } = await store.list(query);
      return {
        data,
        pagination: {
          page: query.page,
          limit: query.limit,
          total,
          totalPages: Math.ceil(total / query.limit),
        },
        ranking: {
          kind: query.kind,
          readMetric: 'STORED_AUTHENTICATED_HISTORY' as const,
        },
      };
    },
  };
}
export type RankingService = ReturnType<typeof createRankingService>;
export const rankingService = createRankingService();
