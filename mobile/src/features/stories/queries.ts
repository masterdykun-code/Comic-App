import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { catalogApi, isUuid, type Page, type StoryFilters } from './api';

export function nextPage<T>(page: Page<T>) {
  return page.pagination.page < page.pagination.totalPages ? page.pagination.page + 1 : undefined;
}
export function useStories(filters: StoryFilters, enabled = true) {
  const client = useQueryClient();
  const queryKey = ['public', 'stories', filters];
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => catalogApi.stories(filters, pageParam, signal),
    getNextPageParam: nextPage,
    enabled,
  });
  return {
    ...query,
    resetPagination: () => {
      // Drop this exact list before changing Explore filters, including cached later pages.
      void client.cancelQueries({ queryKey, exact: true });
      client.removeQueries({ queryKey, exact: true });
    },
  };
}
export function useGenres() {
  return useQuery({
    queryKey: ['public', 'genres'],
    queryFn: ({ signal }) => catalogApi.genres(signal),
  });
}
export function useStory(id: string) {
  return useQuery({
    queryKey: ['public', 'story', id],
    queryFn: ({ signal }) => catalogApi.story(id, signal),
    enabled: isUuid(id),
  });
}
export function useChapters(id: string, enabled: boolean) {
  return useInfiniteQuery({
    queryKey: ['public', 'chapters', id],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => catalogApi.chapters(id, pageParam, signal),
    getNextPageParam: nextPage,
    enabled: isUuid(id) && enabled,
  });
}
