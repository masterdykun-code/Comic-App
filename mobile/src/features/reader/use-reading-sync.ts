import { useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useAuth } from '../../hooks/use-auth';
import { authSession } from '../../services/runtime';
import { readerApi } from './api';
import { ReadingSync, type SyncState } from './sync';
import { useQueryClient } from '@tanstack/react-query';
import { runOwnedRequest } from '../library/session';
export function useReadingSync(storyId: string, chapterId: string, loaded: boolean) {
  const client = useQueryClient();
  const auth = useAuth();
  const userId =
    auth.status === 'authenticated' && auth.user?.status === 'ACTIVE' ? auth.user.id : null;
  const epoch = authSession.generation();
  const [state, setState] = useState<SyncState & { owner: ReadingSync | null }>({
    owner: null,
    ready: false,
    paused: false,
    snapshot: null,
    notice: null,
  });
  const [historyNotice, setHistoryNotice] = useState<string | null>(null);
  const historyAttempts = useRef(new Map<string, number>());
  const sync = useMemo(() => {
    if (!userId) return null;
    const allowed = () => {
      const current = authSession.store.getState();
      return (
        authSession.generation() === epoch &&
        current.status === 'authenticated' &&
        current.user?.id === userId &&
        current.user.status === 'ACTIVE'
      );
    };
    let controller: ReadingSync;
    const transport = {
      progress: (id: string) =>
        runOwnedRequest(allowed, (signal) => readerApi.progress(id, signal)),
      save: (id: string, position: Parameters<typeof readerApi.save>[1], version: string | null) =>
        runOwnedRequest(allowed, (signal) => readerApi.save(id, position, version, signal)),
    };
    controller = new ReadingSync(storyId, transport, allowed, (next) => {
      setState({ ...next, owner: controller });
      void client.invalidateQueries({
        queryKey: ['private', userId, epoch, 'progress'],
        refetchType: 'none',
      });
    });
    return { controller, allowed };
  }, [storyId, userId, epoch, client]);
  useEffect(() => {
    if (!sync || !loaded) return;
    void sync.controller.start();
  }, [sync, loaded]);
  useEffect(() => {
    if (!sync) return;
    sync.controller.activate();
    const subscription = AppState.addEventListener('change', (next) => {
      if (next !== 'active') void sync.controller.flush();
    });
    return () => {
      subscription.remove();
      void sync.controller.close();
    };
    // React Router may reuse this controller for the next chapter after navigation drains it.
  }, [sync, chapterId]);
  useEffect(() => {
    return () => {
      void sync?.controller.flush();
    };
  }, [sync, chapterId]);
  useEffect(() => {
    if (!sync || !loaded || !sync.allowed()) return;
    const key = `${epoch}:${userId}:${storyId}:${chapterId}`;
    const previous = historyAttempts.current.get(key);
    if (previous !== undefined && Date.now() - previous < 30_000) return;
    historyAttempts.current.set(key, Date.now());
    let current = true;
    void runOwnedRequest(sync.allowed, (signal) => readerApi.history(storyId, chapterId, signal))
      .then(() => {
        if (sync.allowed())
          void client.invalidateQueries({
            queryKey: ['private', userId, epoch, 'history'],
            refetchType: 'none',
          });
      })
      .catch(() => {
        if (current && sync.allowed())
          setHistoryNotice('Lịch sử chưa được đồng bộ. Bạn vẫn có thể đọc bình thường.');
      });
    return () => {
      current = false;
      void sync.controller.flush();
    };
  }, [sync, loaded, storyId, chapterId, epoch, userId, client]);
  const visible = state.owner === sync?.controller ? state : null;
  return {
    sync: sync?.controller ?? null,
    saved: visible?.snapshot?.data ?? null,
    ready: !sync || !!visible?.ready || !!visible?.paused,
    notice: visible?.notice ?? (sync ? historyNotice : null),
    authenticated: !!sync,
  };
}
