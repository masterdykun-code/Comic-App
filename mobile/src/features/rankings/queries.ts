import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { rankingsApi, type RankingKind, type RankingType } from './api';
import { nextPage } from '../stories/queries';
export function useRankings(kind: RankingKind, type: RankingType) {
  const cache = useQueryClient(),
    queryKey = ['public', 'rankings', kind, type] as const;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => rankingsApi.list(kind, type, pageParam, signal),
    getNextPageParam: nextPage,
  });
  return {
    ...query,
    resetPagination: () => {
      void cache.cancelQueries({ queryKey, exact: true });
      cache.removeQueries({ queryKey, exact: true });
    },
  };
}
