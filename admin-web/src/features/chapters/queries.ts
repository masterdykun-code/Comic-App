import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { storyId } from '../stories/model';
import { storyKeys } from '../stories/queries';
import { ApiError } from '../../lib/api/errors';
import { chaptersApi } from './api';
import type { Chapter } from './model';
export const chapterKeys = {
  list: (epoch: number, id: string, page: number, limit: number) =>
    ['chapters', 'list', epoch, id, page, limit] as const,
  detail: (epoch: number, id: string) => ['chapters', 'detail', epoch, id] as const,
};
export function useChapters(id: string, page: number, limit: number) {
  const { session } = useAuth();
  return useQuery({
    queryKey: chapterKeys.list(session.generation(), id, page, limit),
    enabled: storyId.safeParse(id).success,
    queryFn: ({ signal }) => chaptersApi.list(id, page, limit, signal),
  });
}
export function useChapter(id: string) {
  const { session } = useAuth();
  return useQuery({
    queryKey: chapterKeys.detail(session.generation(), id),
    enabled: storyId.safeParse(id).success,
    queryFn: ({ signal }) => chaptersApi.detail(id, signal),
  });
}
export function useChapterWrite<T>(work: (input: T) => Promise<Chapter>) {
  const { session } = useAuth();
  const epoch = session.generation();
  const cache = useQueryClient();
  return useMutation({
    mutationFn: async (input: T) => {
      const result = await work(input);
      if (session.generation() !== epoch) throw new ApiError(401, 'Phiên đăng nhập đã thay đổi.');
      return result;
    },
    onSuccess: (chapter) => {
      if (session.generation() !== epoch) return;
      cache.setQueryData(chapterKeys.detail(epoch, chapter.id), chapter);
      void cache.invalidateQueries({ queryKey: ['chapters', 'list'] });
      void cache.invalidateQueries({ queryKey: storyKeys.lists });
      void cache.invalidateQueries({ queryKey: storyKeys.detail(epoch, chapter.storyId) });
    },
  });
}
