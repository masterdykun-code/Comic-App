import { useCallback, useRef, useState } from 'react';
import { Link, useFocusEffect, useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { AppHeader } from '../../components/AppHeader';
import { ScreenContainer } from '../../components/ScreenContainer';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { StoryCard } from '../../components/StoryCard';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { safeError } from '../../lib/errors';
import { readerApi } from '../reader/api';
import { catalogApi } from '../stories/api';
import { Action, Choices, ui } from '../stories/ui';
import { usePrivateScope } from './session';
import { useFavoriteChange, useReadingList } from './queries';
import type { Favorite, Progress } from './api';

export default function LibraryScreen() {
  const scope = usePrivateScope();
  return scope.userId ? (
    <ActiveLibrary key={`${scope.userId}:${scope.epoch}`} />
  ) : (
    <ScreenContainer>
      <AppHeader title="Giá sách" />
      <EmptyState
        title="Giữ lại câu chuyện yêu thích"
        message="Đăng nhập để mở giá sách và tiếp tục từ vị trí đã lưu."
      />
      <Link href={{ pathname: '/login', params: { next: '/library' } }} style={ui.action}>
        Đăng nhập để mở giá sách
      </Link>
    </ScreenContainer>
  );
}
function ActiveLibrary() {
  const [kind, setKind] = useState<'favorites' | 'progress'>('favorites');
  return <LibraryList key={kind} kind={kind} onKind={setKind} />;
}
function LibraryList({
  kind,
  onKind,
}: {
  kind: 'favorites' | 'progress';
  onKind: (kind: 'favorites' | 'progress') => void;
}) {
  const query = useReadingList(kind);
  const router = useRouter();
  const mutation = useFavoriteChange();
  const [remove, setRemove] = useState<Favorite | null>(null);
  const refetch = query.refetch;
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );
  const entries = query.data?.pages.flatMap((page) => page.data) ?? [];
  return (
    <ScreenContainer
      refreshing={query.isRefetching}
      onRefresh={() => {
        void query.refetch();
      }}
    >
      <AppHeader title="Giá sách" subtitle="NHỮNG CÂU CHUYỆN BẠN MUỐN GIỮ LẠI" />
      <Choices
        label="Giá sách"
        value={kind}
        options={[
          { value: 'favorites', label: 'Yêu thích' },
          { value: 'progress', label: 'Đang đọc' },
        ]}
        onChange={onKind}
      />
      <Link href="/history" style={ui.actionText}>
        Xem lịch sử đọc →
      </Link>
      <Link href="/bookmarks" style={ui.actionText}>
        Dấu trang đã lưu →
      </Link>
      {query.isPending ? (
        <LoadingState label="Đang tải giá sách…" />
      ) : query.error ? (
        <ErrorState
          message={safeError(query.error).message}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title={kind === 'favorites' ? 'Giá sách chưa có truyện' : 'Chưa có tiến độ đọc'}
          message={
            kind === 'favorites'
              ? 'Mở một truyện và chọn Lưu vào giá sách để thêm vào đây.'
              : 'Mở một chương để bắt đầu hành trình đọc.'
          }
        />
      ) : (
        entries.map((entry) => (
          <View key={entry.id} style={ui.group}>
            <StoryCard
              story={entry.story}
              onPress={() =>
                router.push({ pathname: '/story/[id]', params: { id: entry.storyId } })
              }
            />
            {kind === 'favorites' ? (
              <Action
                label={`Bỏ ${entry.story.title} khỏi giá sách`}
                disabled={mutation.isPending}
                onPress={() => setRemove(entry as Favorite)}
              />
            ) : (
              <>
                <Text style={ui.body}>
                  Chương {(entry as Progress).chapter.chapterNumber} ·{' '}
                  {(entry as Progress).chapter.title}
                </Text>
                <Text style={ui.caption}>
                  {(entry as Progress).progressPercent}% trong chương đã lưu
                </Text>
                <ContinueButton storyId={entry.storyId} />
              </>
            )}
          </View>
        ))
      )}
      {mutation.error && <ErrorState message={safeError(mutation.error).message} />}
      {query.hasNextPage && (
        <Action
          label={query.isFetchingNextPage ? 'Đang tải thêm…' : 'Tải thêm truyện'}
          disabled={query.isFetchingNextPage}
          onPress={() => {
            void query.fetchNextPage();
          }}
        />
      )}
      <ConfirmDialog
        visible={!!remove}
        title="Bỏ truyện khỏi giá sách?"
        message="Tiến độ và lịch sử đọc vẫn được giữ lại."
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          if (remove) mutation.change(remove.storyId, true);
          setRemove(null);
        }}
      />
    </ScreenContainer>
  );
}
function ContinueButton({ storyId }: { storyId: string }) {
  const scope = usePrivateScope();
  const router = useRouter();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lock = useRef(false);
  async function resume() {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const saved = await scope.run((signal) => readerApi.progress(storyId, signal));
      let chapterId = saved.data?.chapterId;
      if (!chapterId)
        chapterId = (await scope.run((signal) => catalogApi.chapters(storyId, 1, signal))).data[0]
          ?.id;
      if (!chapterId) {
        setError('Chưa có chương công khai để tiếp tục.');
        return;
      }
      if (scope.active())
        router.push({ pathname: '/reader/[id]', params: { id: chapterId, storyId } });
    } catch (failure) {
      if (scope.active()) {
        setError(safeError(failure).message);
        if (safeError(failure).status === 404)
          void client.invalidateQueries({ queryKey: [...scope.prefix, 'progress'] });
      }
    } finally {
      lock.current = false;
      setBusy(false);
    }
  }
  return (
    <View style={ui.group}>
      <Action
        label={busy ? 'Đang mở vị trí đọc…' : 'Tiếp tục đọc'}
        disabled={busy}
        primary
        onPress={() => {
          void resume();
        }}
      />
      {error && <ErrorState message={error} />}
    </View>
  );
}
