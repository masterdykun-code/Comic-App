import { useEffect, useRef } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { libraryApi, type LibraryKind, type ReadingEntry } from './api';
import { nextPage } from '../stories/queries';
import { usePrivateScope } from './session';
import type { Page } from '../stories/api';

export function useReadingList(kind: LibraryKind) {
  const scope = usePrivateScope();
  const query = useInfiniteQuery({
    queryKey: [...scope.prefix, kind, 'list'],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }): Promise<Page<ReadingEntry>> =>
      scope.run<Page<ReadingEntry>>(
        (ownedSignal) =>
          kind === 'favorites'
            ? libraryApi.favorites(pageParam, 12, ownedSignal)
            : kind === 'progress'
              ? libraryApi.progress(pageParam, ownedSignal)
              : libraryApi.history(pageParam, ownedSignal),
        signal,
      ),
    getNextPageParam: nextPage,
    enabled: !!scope.userId,
  });
  return { ...query, scope };
}
export function useFavoriteStatus(storyId: string) {
  const scope = usePrivateScope();
  const query = useInfiniteQuery({
    queryKey: [...scope.prefix, 'favorites', 'status'],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      scope.run((ownedSignal) => libraryApi.favorites(pageParam, 100, ownedSignal), signal),
    getNextPageParam: nextPage,
    enabled: !!scope.userId,
  });
  const found = !!query.data?.pages.some((page) =>
    page.data.some((row) => row.storyId === storyId),
  );
  const more = query.fetchNextPage;
  useEffect(() => {
    if (!found && !query.error && query.hasNextPage && !query.isFetching) void more();
  }, [found, query.error, query.hasNextPage, query.isFetching, more]);
  return {
    ...query,
    found,
    known:
      !!scope.userId &&
      !query.isPending &&
      !query.isFetching &&
      !query.error &&
      (found || !query.hasNextPage),
  };
}
export function useFavoriteChange() {
  const scope = usePrivateScope();
  const client = useQueryClient();
  const lock = useRef(false);
  const mutation = useMutation({
    mutationKey: [...scope.prefix, 'favorite-change'],
    mutationFn: ({ storyId, remove }: { storyId: string; remove: boolean }) =>
      scope.run<unknown>((signal) =>
        remove ? libraryApi.remove(storyId, signal) : libraryApi.add(storyId, signal),
      ),
    onSettled: async () => {
      if (scope.active())
        await client.invalidateQueries({ queryKey: [...scope.prefix, 'favorites'] });
    },
  });
  function change(storyId: string, remove: boolean) {
    if (lock.current || !scope.active()) return;
    lock.current = true;
    mutation.mutate(
      { storyId, remove },
      {
        onSettled: () => {
          lock.current = false;
        },
      },
    );
  }
  return { ...mutation, change };
}
