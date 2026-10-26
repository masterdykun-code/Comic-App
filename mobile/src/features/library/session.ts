import type { QueryClient } from '@tanstack/react-query';
import { useAuth } from '../../hooks/use-auth';
import { authSession } from '../../services/runtime';
import { ApiError } from '../../lib/errors';
export async function runOwnedRequest<T>(
  active: () => boolean,
  work: (signal: AbortSignal) => Promise<T>,
  source?: AbortSignal,
): Promise<T> {
  if (!active()) throw new ApiError(401, 'Phiên đã thay đổi.');
  const controller = new AbortController();
  const abort = () => controller.abort();
  const unsubscribe = authSession.store.subscribe(() => {
    if (!active()) abort();
  });
  source?.addEventListener('abort', abort);
  if (source?.aborted || !active()) abort();
  try {
    if (controller.signal.aborted) throw new ApiError(401, 'Yêu cầu đã bị hủy.');
    const data = await work(controller.signal);
    if (!active() || controller.signal.aborted) throw new ApiError(401, 'Phiên đã thay đổi.');
    return data;
  } finally {
    unsubscribe();
    source?.removeEventListener('abort', abort);
  }
}
export function usePrivateScope() {
  const auth = useAuth();
  const userId =
    auth.status === 'authenticated' && auth.user?.status === 'ACTIVE' ? auth.user.id : null;
  const epoch = authSession.generation();
  const prefix = ['private', userId, epoch] as const;
  const active = () => {
    const current = authSession.store.getState();
    return (
      !!userId &&
      authSession.generation() === epoch &&
      current.status === 'authenticated' &&
      current.user?.id === userId &&
      current.user.status === 'ACTIVE'
    );
  };
  const run = <T>(work: (signal: AbortSignal) => Promise<T>, source?: AbortSignal) =>
    runOwnedRequest(active, work, source);
  return { userId, epoch, prefix, active, run };
}
export async function clearPrivateCache(client: QueryClient) {
  const cancelled = client.cancelQueries({ queryKey: ['private'] });
  client.removeQueries({ queryKey: ['private'] });
  for (const mutation of client.getMutationCache().getAll()) {
    if (mutation.options.mutationKey?.[0] === 'private') client.getMutationCache().remove(mutation);
  }
  await cancelled;
}
