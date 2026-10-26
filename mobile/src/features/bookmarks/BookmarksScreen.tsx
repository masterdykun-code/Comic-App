import { useRef, useState } from 'react';
import { Link, useRouter } from 'expo-router';
import { Pressable, Text, View } from 'react-native';
import { Bookmark as BookmarkIcon, BookOpen, Trash2 } from 'lucide-react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ScreenContainer } from '../../components/ScreenContainer';
import { AppHeader } from '../../components/AppHeader';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { colors, radius } from '../../lib/theme';
import { safeError } from '../../lib/errors';
import { Action, ui } from '../stories/ui';
import { usePrivateScope } from '../library/session';
import { useBookmarks } from './queries';
import { bookmarkApi, type Bookmark } from './api';

export default function BookmarksScreen() {
  const scope = usePrivateScope();
  if (!scope.userId)
    return (
      <ScreenContainer>
        <AppHeader title="Dấu trang" />
        <EmptyState
          title="Giữ lại những trang bạn yêu thích"
          message="Đăng nhập để lưu chương và mở lại vị trí đã đánh dấu."
        />
        <Link href={{ pathname: '/login', params: { next: '/bookmarks' } }} style={ui.action}>
          Đăng nhập
        </Link>
      </ScreenContainer>
    );
  return <ActiveBookmarks key={`${scope.userId}:${scope.epoch}`} />;
}
function ActiveBookmarks() {
  const query = useBookmarks(),
    { scope } = query,
    cache = useQueryClient(),
    router = useRouter();
  const [remove, setRemove] = useState<Bookmark | null>(null),
    [error, setError] = useState('');
  const lock = useRef(false);
  const deletion = useMutation({
    mutationKey: [...scope.prefix, 'bookmark-delete'],
    retry: false,
    mutationFn: (id: string) => scope.run((signal) => bookmarkApi.remove(id, signal)),
    onSettled: async () => {
      if (scope.active())
        await cache.invalidateQueries({ queryKey: [...scope.prefix, 'bookmarks'] });
    },
  });
  async function confirm() {
    if (!remove || lock.current || !scope.active()) return;
    lock.current = true;
    setError('');
    try {
      await deletion.mutateAsync(remove.id);
      if (scope.active()) setRemove(null);
    } catch (e) {
      if (scope.active()) {
        setRemove(null);
        setError(safeError(e).message);
      }
    } finally {
      lock.current = false;
    }
  }
  const entries = query.data?.pages.flatMap((p) => p.data) ?? [];
  return (
    <ScreenContainer
      refreshing={query.isRefetching}
      onRefresh={() => {
        void query.refetch();
      }}
    >
      <AppHeader title="Dấu trang" subtitle="MỞ LẠI MỘT ĐOẠN CHUYỆN ĐÁNG NHỚ" />
      <View
        style={{
          borderRadius: radius.lg,
          backgroundColor: colors.primarySoft,
          padding: 18,
          gap: 8,
        }}
      >
        <BookmarkIcon size={24} color={colors.primary} />
        <Text style={ui.heading}>Những chương đã đánh dấu</Text>
        <Text style={ui.body}>
          Mỗi chương giữ một dấu trang. Xóa dấu trang không xóa truyện hoặc tiến độ đọc.
        </Text>
      </View>
      {error ? <ErrorState message={error} /> : null}
      {query.isPending ? (
        <LoadingState label="Đang tải dấu trang…" />
      ) : query.error ? (
        <ErrorState
          message={safeError(query.error).message}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : entries.length === 0 ? (
        <EmptyState
          title="Chưa có dấu trang"
          message="Khi đọc NOVEL hoặc COMIC, nhấn Đánh dấu chương để lưu lại vị trí."
        />
      ) : (
        entries.map((item) => (
          <View
            key={item.id}
            style={{
              backgroundColor: colors.surface,
              borderWidth: 1,
              borderColor: colors.border,
              borderRadius: radius.lg,
              padding: 18,
              gap: 12,
            }}
          >
            <Text
              style={{ color: colors.primary, fontSize: 11, fontWeight: '700', letterSpacing: 1 }}
            >
              {!item.story
                ? 'DẤU TRANG'
                : item.story.type === 'COMIC'
                  ? 'TRUYỆN TRANH'
                  : 'TRUYỆN CHỮ'}
            </Text>
            <Text style={ui.heading}>{item.story?.title ?? 'Nội dung không còn công khai'}</Text>
            <Text style={ui.body}>
              {item.chapter
                ? `Chương ${item.chapter.chapterNumber} · ${item.chapter.title}`
                : 'Chương không còn khả dụng.'}
            </Text>
            {item.available && (
              <Text style={ui.caption}>
                {item.pageNumber !== null
                  ? `Trang ảnh ${item.pageNumber}`
                  : item.textOffset
                    ? 'Đã lưu vị trí đoạn văn'
                    : 'Đầu chương'}
              </Text>
            )}
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Đọc dấu trang ${item.chapter?.title ?? item.id}`}
                accessibilityState={{ disabled: !item.available }}
                disabled={!item.available}
                onPress={() => {
                  if (scope.active())
                    router.push({
                      pathname: '/reader/[id]',
                      params: { id: item.chapterId, storyId: item.storyId, bookmarkId: item.id },
                    });
                }}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  borderRadius: 14,
                  backgroundColor: colors.primary,
                  minHeight: 48,
                  opacity: item.available ? 1 : 0.4,
                }}
              >
                <BookOpen color="white" size={18} />
                <Text style={{ color: 'white', fontWeight: '600' }}>Đọc tiếp tại đây</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Xóa dấu trang ${item.chapter?.title ?? item.id}`}
                onPress={() => {
                  setRemove(item);
                  setError('');
                }}
                style={{
                  minWidth: 48,
                  minHeight: 48,
                  borderRadius: 14,
                  borderWidth: 1,
                  borderColor: colors.border,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Trash2 size={18} color={colors.danger} />
              </Pressable>
            </View>
          </View>
        ))
      )}
      {query.hasNextPage && (
        <Action
          label={query.isFetchingNextPage ? 'Đang tải thêm…' : 'Tải thêm dấu trang'}
          disabled={query.isFetchingNextPage}
          onPress={() => {
            void query.fetchNextPage();
          }}
        />
      )}
      <ConfirmDialog
        visible={!!remove}
        title="Xóa dấu trang này?"
        message="Chỉ xóa dấu trang. Nội dung và vị trí Tiếp tục đọc vẫn được giữ nguyên."
        busy={deletion.isPending}
        onCancel={() => setRemove(null)}
        onConfirm={() => {
          void confirm();
        }}
      />
    </ScreenContainer>
  );
}
