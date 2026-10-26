import { useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AppState, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { authSession } from '../services/runtime';
import { useAuth } from '../hooks/use-auth';
import { LoadingState } from '../components/States';
import { colors } from './theme';
export function AppProviders({ children }: { children: ReactNode }) {
  const [query] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 30000 },
          mutations: { retry: false },
        },
      }),
  );
  useEffect(() => {
    void authSession.restore();
    const unsubscribe = authSession.store.subscribe((state) => {
      if (state.status === 'guest' || state.status === 'signing-in') {
        void query.cancelQueries();
        query.clear();
      }
    });
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && authSession.peek()) void authSession.refresh().catch(() => {});
    });
    return () => {
      unsubscribe();
      subscription.remove();
    };
  }, [query]);
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={query}>{children}</QueryClientProvider>
    </SafeAreaProvider>
  );
}
export function SessionBoundary({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'restoring')
    return (
      <View
        style={{
          flex: 1,
          justifyContent: 'center',
          padding: 24,
          backgroundColor: colors.background,
        }}
      >
        <LoadingState label="Đang kiểm tra phiên an toàn…" />
      </View>
    );
  return children;
}
