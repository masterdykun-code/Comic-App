import { useCallback, useRef, useState } from 'react';
import { Link, Redirect, useFocusEffect, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/ScreenContainer';
import { AppHeader } from '../../components/AppHeader';
import { StoryCard } from '../../components/StoryCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { Action, ui } from '../stories/ui';
import { safeError } from '../../lib/errors';
import { libraryApi, type History } from './api';
import { useReadingList } from './queries';
import { usePrivateScope } from './session';
export default function HistoryScreen() {
  const scope = usePrivateScope();
  return scope.userId ? (
    <ActiveHistory key={`${scope.userId}:${scope.epoch}`} />
  ) : (
    <Redirect href={{ pathname: '/login', params: { next: '/history' } }} />
  );
}
function ActiveHistory() {
  const query = useReadingList('history');
  const router = useRouter();
  const client = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const lock = useRef(false);
  const mutation = useMutation({
    mutationKey: [...query.scope.prefix, 'history-clear'],
    mutationFn: () => query.scope.run((signal) => libraryApi.clearHistory(signal)),
    onSettled: async () => {
      if (query.scope.active())
        await client.invalidateQueries({ queryKey: [...query.scope.prefix, 'history'] });
      lock.current = false;
    },
  });
  const refetch = query.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  const entries = (query.data?.pages.flatMap((page) => page.data) ?? []) as History[];
  return (
    <ScreenContainer
      refreshing={query.isRefetching}
      onRefresh={() => {
        void query.refetch();
      }}
    >
      <Link href="/profile" style={ui.actionText}>
        ← Hồ sơ
      </Link>
      <AppHeader title="Lịch sử đọc" />
      <Action
        label="Xóa lịch sử đọc"
        disabled={query.isPending || mutation.isPending}
        onPress={() => setConfirm(true)}
      />
      {query.isPending ? (
        <LoadingState label="Đang tải lịch sử…" />
      ) : query.error ? (
        <ErrorState
          message={safeError(query.error).message}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Chưa có lịch sử đọc"
          message="Những chương bạn đã mở khi đăng nhập sẽ xuất hiện tại đây."
        />
      ) : (
        <>
          {entries.map((entry) => (
            <View key={entry.id} style={ui.group}>
              <StoryCard
                story={entry.story}
                onPress={() =>
                  router.push({ pathname: '/story/[id]', params: { id: entry.storyId } })
                }
              />
              <Text style={ui.body}>
                Chương {entry.chapter.chapterNumber} · {entry.chapter.title}
              </Text>
              <Text style={ui.caption}>{new Date(entry.readAt).toLocaleString('vi-VN')}</Text>
              <Action
                label={`Đọc lại chương ${entry.chapter.chapterNumber}`}
                onPress={() =>
                  router.push({
                    pathname: '/reader/[id]',
                    params: { id: entry.chapterId, storyId: entry.storyId },
                  })
                }
              />
            </View>
          ))}
        </>
      )}
      {mutation.error && <ErrorState message={safeError(mutation.error).message} />}
      {query.hasNextPage && (
        <Action
          label={query.isFetchingNextPage ? 'Đang tải thêm…' : 'Tải thêm lịch sử'}
          disabled={query.isFetchingNextPage}
          onPress={() => {
            void query.fetchNextPage();
          }}
        />
      )}
      <ConfirmDialog
        visible={confirm}
        title="Xóa toàn bộ lịch sử đọc?"
        message="Chỉ lịch sử bị xóa. Giá sách và tiến độ đọc sẽ được giữ lại."
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          if (!lock.current) {
            lock.current = true;
            mutation.mutate();
          }
        }}
      />
    </ScreenContainer>
  );
}
