import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { ApiError } from '../../lib/api/errors';
import { storiesApi } from './api';
import { storyId, type Story, type StoryInput, type StoryQuery } from './model';

export const storyKeys = {
  lists: ['stories', 'list'] as const,
  list: (epoch: number, query: StoryQuery) => ['stories', 'list', epoch, query] as const,
  detail: (epoch: number, id: string) => ['stories', 'detail', epoch, id] as const,
};
export function useStories(query: StoryQuery) {
  const { session } = useAuth();
  return useQuery({
    queryKey: storyKeys.list(session.generation(), query),
    queryFn: ({ signal }) => storiesApi.list(query, signal),
  });
}
export function useStory(id: string) {
  const { session } = useAuth();
  return useQuery({
    queryKey: storyKeys.detail(session.generation(), id),
    enabled: storyId.safeParse(id).success,
    queryFn: ({ signal }) => storiesApi.detail(id, signal),
  });
}
export function useGenres() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['genres', session.generation()],
    queryFn: ({ signal }) => storiesApi.genres(signal),
  });
}
export function useStoryWrite(mode: 'create' | 'update' | 'publish', id = '', typeLocked = false) {
  const cache = useQueryClient();
  const { session } = useAuth();
  const epoch = session.generation();
  return useMutation({
    mutationFn: async (input?: StoryInput) => {
      const result =
        mode === 'publish'
          ? await storiesApi.publish(id)
          : mode === 'create'
            ? await storiesApi.create(input!)
            : await storiesApi.update(id, input!, typeLocked);
      if (session.generation() !== epoch) throw new ApiError(401, 'Phiên đăng nhập đã thay đổi.');
      return result;
    },
    onSuccess: (story: Story) => {
      if (session.generation() !== epoch) return;
      cache.setQueryData(storyKeys.detail(epoch, story.id), story);
      void cache.invalidateQueries({ queryKey: storyKeys.lists });
      void cache.invalidateQueries({ queryKey: storyKeys.detail(epoch, story.id) });
    },
  });
}

export function useStoryLifecycle() {
  const cache = useQueryClient();
  const { session } = useAuth();
  const epoch = session.generation();
  return useMutation({
    retry: false,
    mutationFn: async ({ kind, story }: { kind: 'hide' | 'delete'; story: Story }) => {
      if (session.generation() !== epoch) throw new ApiError(401, 'Phiên đăng nhập đã thay đổi.');
      const result =
        kind === 'hide'
          ? await storiesApi.unpublish(story.id)
          : await storiesApi.remove(story.id, story.updatedAt);
      if (session.generation() !== epoch) throw new ApiError(401, 'Phiên đăng nhập đã thay đổi.');
      return result;
    },
    onSuccess: async (result, { kind, story }) => {
      if (session.generation() !== epoch) return;
      if (kind === 'hide') {
        cache.setQueryData(storyKeys.detail(epoch, story.id), result);
      } else {
        const owned = (query: { queryKey: readonly unknown[]; state: { data: unknown } }) => {
          const key = query.queryKey;
          if (key[0] === 'stories' && key[1] === 'detail')
            return key[2] === epoch && key[3] === story.id;
          if (key[0] !== 'chapters' || key[2] !== epoch) return false;
          return key[1] === 'list'
            ? key[3] === story.id
            : (query.state.data as { storyId?: string } | undefined)?.storyId === story.id;
        };
        await cache.cancelQueries({ predicate: owned });
        if (session.generation() !== epoch) return;
        cache.removeQueries({ predicate: owned });
      }
      void cache.invalidateQueries({ queryKey: storyKeys.lists });
      void cache.invalidateQueries({ queryKey: ['comments', 'admin'] });
    },
  });
}
