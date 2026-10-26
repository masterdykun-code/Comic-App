import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { ApiError } from '../../lib/api/errors';
export function useGenreWrite<T, R>(work: (input: T) => Promise<R>) {
  const cache = useQueryClient();
  const { session } = useAuth();
  const epoch = session.generation();
  return useMutation({
    mutationFn: async (input: T) => {
      const result = await work(input);
      if (session.generation() !== epoch) throw new ApiError(401, 'Phiên đăng nhập đã thay đổi.');
      return result;
    },
    onSuccess: async () => {
      if (session.generation() !== epoch) return;
      await Promise.all([
        cache.invalidateQueries({ queryKey: ['genres'] }),
        cache.invalidateQueries({ queryKey: ['stories'] }),
      ]);
    },
  });
}
