import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/auth-context';
import { ApiError } from '../../lib/api/errors';
import { usersApi, type UserQuery } from './api';
export function useUsers(query: UserQuery, enabled = true) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['admin-users', session.generation(), query],
    queryFn: () => usersApi.list(query),
    enabled,
    retry: false,
  });
}
export function useManagedUser(id: string, enabled = true) {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['admin-user', session.generation(), id],
    queryFn: () => usersApi.detail(id),
    enabled,
    retry: false,
  });
}
export function useDashboard() {
  const { session } = useAuth();
  return useQuery({
    queryKey: ['admin-dashboard', session.generation()],
    queryFn: () => usersApi.dashboard(),
    retry: false,
  });
}
export function useUserStatus() {
  const { session } = useAuth(),
    cache = useQueryClient(),
    epoch = session.generation();
  return useMutation({
    retry: false,
    mutationFn: async (input: Parameters<typeof usersApi.status>[0]) => {
      if (session.generation() !== epoch) throw new ApiError(401, 'Phiên đăng nhập đã thay đổi.');
      const result = await usersApi.status(input);
      if (session.generation() !== epoch) throw new ApiError(401, 'Phiên đăng nhập đã thay đổi.');
      return result;
    },
    onSuccess: async () => {
      if (session.generation() !== epoch) return;
      await Promise.all(
        ['admin-users', 'admin-user', 'admin-dashboard'].map((key) =>
          cache.invalidateQueries({ queryKey: [key, epoch] }),
        ),
      );
    },
  });
}
