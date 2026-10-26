import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { usePrivateScope } from '../library/session';
import { bookmarkApi, type BookmarkInput } from './api';
import { nextPage } from '../stories/queries';
export function useBookmarks() {
  const scope = usePrivateScope();
  return {
    scope,
    ...useInfiniteQuery({
      queryKey: [...scope.prefix, 'bookmarks', 'list'],
      initialPageParam: 1,
      enabled: !!scope.userId,
      queryFn: ({ pageParam, signal }) =>
        scope.run((owned) => bookmarkApi.list(pageParam, owned), signal),
      getNextPageParam: nextPage,
    }),
  };
}
export function useBookmarkSave() {
  const scope = usePrivateScope(),
    cache = useQueryClient();
  const mutation = useMutation({
    mutationKey: [...scope.prefix, 'bookmark-add'],
    retry: false,
    mutationFn: (input: BookmarkInput) => scope.run((signal) => bookmarkApi.add(input, signal)),
    onSettled: async () => {
      if (scope.active())
        await cache.invalidateQueries({ queryKey: [...scope.prefix, 'bookmarks'] });
    },
  });
  return { ...mutation, scope };
}
