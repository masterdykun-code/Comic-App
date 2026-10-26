import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from './session';
import { session as defaultSession } from './runtime';
import { AuthContext } from './auth-context';
export function AuthProvider({
  children,
  session = defaultSession,
}: {
  children: ReactNode;
  session?: Session;
}) {
  const view = useSyncExternalStore(session.subscribe, session.snapshot, session.snapshot);
  const cache = useQueryClient();
  const profile = useQuery({
    queryKey: ['auth', 'me', session.generation()],
    queryFn: () => session.verify(),
    enabled: view.status === 'authenticated',
    staleTime: 30_000,
    retry: false,
    refetchOnWindowFocus: 'always',
    refetchOnReconnect: true,
    refetchInterval: 60_000,
  });
  useEffect(() => {
    if (view.status === 'anonymous') {
      void cache.cancelQueries();
      cache.clear();
    }
  }, [cache, view.status]);
  async function logout() {
    void cache.cancelQueries();
    cache.clear();
    return session.logout();
  }
  return (
    <AuthContext.Provider
      value={{
        session,
        view,
        checking: profile.isFetching,
        recheck: () => {
          void profile.refetch();
        },
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
