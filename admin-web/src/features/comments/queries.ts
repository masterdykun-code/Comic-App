import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { ApiError } from '../../lib/api/errors';
import { commentsApi } from './api';
import type { CommentQuery, CommentStatus } from './model';
export function useAdminComments(query: CommentQuery, enabled: boolean) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['comments', 'admin', session.generation(), query],
    enabled,
    queryFn: ({ signal }) => commentsApi.list(query, signal),
  });
}
export function useModerateComment() {
  const cache = useQueryClient();
  const { session } = useAuth();
  const epoch = session.generation();
  return useMutation({
    mutationFn: async ({ id, status }: { id: string; status: CommentStatus }) => {
      const result = await commentsApi.moderate(id, status);
      if (session.generation() !== epoch) throw new ApiError(401, 'Phiên đăng nhập đã thay đổi.');
      return result;
    },
    onSuccess: async () => {
      if (session.generation() === epoch) await cache.invalidateQueries({ queryKey: ['comments'] });
    },
  });
}
