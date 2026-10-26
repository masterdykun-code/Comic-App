import { useCallback, useEffect, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import {
  BackHandler,
  FlatList,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ErrorState, LoadingState } from '../../components/States';
import { safeError, ApiError } from '../../lib/errors';
import { catalogApi, isUuid } from '../stories/api';
import { nextPage } from '../stories/queries';
import { readerApi, type Position, type ReaderChapter, type SavedProgress } from './api';
import { NovelContent } from './NovelContent';
import { ComicContent } from './ComicContent';
import { readerThemes, type ReaderTheme, type ThemeName } from './theme';
import { useReadingSync } from './use-reading-sync';
import { comicPosition, novelPosition } from './positions';
import { authSession } from '../../services/runtime';
import { useStore } from 'zustand';
import { readerSettings } from '../../stores/reader-settings';
import { readerFontFamily } from './fonts';
import { NovelSettingsPanel } from './NovelSettingsPanel';
import { StatusBar, setStatusBarStyle } from 'expo-status-bar';
import { comicSettings, type ComicMode } from '../../stores/comic-settings';
import { ComicModePicker } from './ComicModePicker';
import { usePrivateScope } from '../library/session';
import { useBookmarkSave } from '../bookmarks/queries';
import { bookmarkApi } from '../bookmarks/api';
import { bookmarkPosition } from '../bookmarks/position';

import { UnlockChapter } from '../coins/UnlockChapter';
function Button({
  label,
  onPress,
  theme,
  disabled = false,
  selected = false,
}: {
  label: string;
  onPress: () => void;
  theme: ReaderTheme;
  disabled?: boolean;
  selected?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled, selected }}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.button,
        {
          borderColor: selected ? theme.text : theme.border,
          backgroundColor: theme.panel,
          opacity: disabled ? 0.45 : 1,
        },
      ]}
    >
      <Text style={{ color: theme.text, fontSize: 14, lineHeight: 20, textAlign: 'center' }}>
        {label}
      </Text>
    </Pressable>
  );
}
function ReaderBody({
  chapter,
  theme,
  fontSize,
  lineSpacing,
  fontFamily,
  comicMode,
  saved,
  onPosition,
}: {
  chapter: ReaderChapter;
  theme: ReaderTheme;
  fontSize: number;
  lineSpacing: number;
  fontFamily?: string;
  comicMode: ComicMode;
  saved: SavedProgress | null;
  onPosition: (position: Position) => void;
}) {
  // Restoration is a mount-time choice. Save acknowledgements and conflicts must not
  // move the reader or rerender long text/image lists after every write.
  const [initialSaved] = useState(saved);
  useEffect(() => {
    if (initialSaved?.chapterId === chapter.id) return;
    onPosition(
      chapter.type === 'NOVEL'
        ? novelPosition(chapter.id, 0, chapter.content.length)
        : comicPosition(chapter.id, chapter.pages[0].pageNumber, 0, chapter.pages.length),
    );
  }, [chapter, initialSaved, onPosition]);
  return chapter.type === 'NOVEL' ? (
    <NovelContent
      chapterId={chapter.id}
      content={chapter.content}
      title={chapter.title}
      fontSize={fontSize}
      lineSpacing={lineSpacing}
      fontFamily={fontFamily}
      theme={theme}
      saved={initialSaved}
      restoreReady
      onPosition={onPosition}
    />
  ) : (
    <ComicContent
      mode={comicMode}
      chapterId={chapter.id}
      pages={chapter.pages}
      title={chapter.title}
      theme={theme}
      saved={initialSaved}
      restoreReady
      onPosition={onPosition}
    />
  );
}
export default function ReaderRoute() {
  const params = useLocalSearchParams<{ id: string; storyId?: string; bookmarkId?: string }>();
  if (
    !isUuid(params.id) ||
    !isUuid(params.storyId) ||
    (params.bookmarkId !== undefined && !isUuid(params.bookmarkId))
  )
    return (
      <SafeAreaView style={{ flex: 1, padding: 24 }}>
        <ErrorState message="Liên kết đọc không hợp lệ. Cần UUID truyện và chương." />
      </SafeAreaView>
    );
  return (
    <ReaderScreen storyId={params.storyId} chapterId={params.id} bookmarkId={params.bookmarkId} />
  );
}
function ReaderScreen({
  storyId,
  chapterId,
  bookmarkId,
}: {
  storyId: string;
  chapterId: string;
  bookmarkId?: string;
}) {
  const router = useRouter();
  const scope = usePrivateScope();
  const saveBookmark = useBookmarkSave();
  const bookmarkLock = useRef(false);
  const [bookmarkNotice, setBookmarkNotice] = useState('');
  const restoreKey = `${chapterId}:${bookmarkId ?? 'progress'}:${scope.userId ?? 'guest'}:${scope.epoch}`;
  const lastPosition = useRef<{ key: string; position: Position } | null>(null);
  const [comicTheme, setTheme] = useState<ThemeName>('light');
  const { preferences, hydrated, notice: settingsNotice } = useStore(readerSettings.store);
  const { fontSize, lineSpacing } = preferences;
  const comicPreferences = useStore(comicSettings.store);
  useEffect(() => {
    void readerSettings.hydrate();
    void comicSettings.hydrate();
  }, []);
  const [tools, setTools] = useState(true);
  const [settings, setSettings] = useState(false);
  const [directory, setDirectory] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const navigationLock = useRef(false);
  const chapter = useQuery({
    queryKey: [...scope.prefix, 'reader', storyId, chapterId],
    queryFn: ({ signal }) => readerApi.chapter(chapterId, storyId, signal),
  });
  const bookmark = useQuery({
    queryKey: [...scope.prefix, 'bookmarks', 'resolve', bookmarkId, storyId, chapterId],
    enabled: !!bookmarkId && !!scope.userId,
    retry: false,
    refetchOnMount: 'always',
    queryFn: ({ signal }) =>
      scope.run(async (owned) => {
        const row = await bookmarkApi.resolve(bookmarkId!, owned);
        if (row.storyId !== storyId || row.chapterId !== chapterId)
          throw new ApiError(404, 'Dấu trang không thuộc chương này.');
        return row;
      }, signal),
  });
  const bookmarkReady = !bookmarkId || (!!scope.userId && !!bookmark.data && !bookmark.error);
  const isNovel = chapter.data?.type === 'NOVEL';
  const themeName = isNovel ? preferences.theme : comicTheme;
  const theme = readerThemes[themeName];
  useFocusEffect(
    useCallback(() => {
      setStatusBarStyle(themeName === 'dark' ? 'light' : 'dark');
      return () => setStatusBarStyle('dark');
    }, [themeName]),
  );
  const list = useInfiniteQuery({
    queryKey: ['public', 'chapters', storyId],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => catalogApi.chapters(storyId, pageParam, signal),
    getNextPageParam: nextPage,
    enabled: !!chapter.data && !chapter.error,
  });
  const chapters = list.data?.pages.flatMap((page) => page.data) ?? [];
  const index = chapters.findIndex((row) => row.id === chapterId);
  const syncState = useReadingSync(
    storyId,
    chapterId,
    !!chapter.data && !chapter.error && bookmarkReady,
  );
  const { sync } = syncState;
  const restoreSaved =
    bookmarkId && bookmark.data && chapter.data && bookmarkReady
      ? bookmarkPosition(bookmark.data, chapter.data)
      : syncState.saved;
  const position = useCallback(
    (next: Position) => {
      lastPosition.current = { key: restoreKey, position: next };
      sync?.offer(next);
    },
    [sync, restoreKey],
  );
  const more = list.fetchNextPage;
  useEffect(() => {
    if (
      chapter.data &&
      !list.error &&
      list.hasNextPage &&
      !list.isFetchingNextPage &&
      (index < 0 || index === chapters.length - 1)
    )
      void more();
  }, [
    chapter.data,
    list.error,
    list.hasNextPage,
    list.isFetchingNextPage,
    index,
    chapters.length,
    more,
  ]);
  const leave = useCallback(
    async (navigate: () => void) => {
      if (navigationLock.current) return;
      navigationLock.current = true;
      setLeaving(true);
      const generation = authSession.generation();
      try {
        // A new route must not read the version before the previous queue commits.
        await sync?.close();
        if (authSession.generation() === generation) navigate();
      } finally {
        navigationLock.current = false;
        setLeaving(false);
      }
    },
    [sync],
  );
  const openChapter = (id: string) => {
    if (id === chapterId) {
      setDirectory(false);
      return;
    }
    void leave(() => {
      setDirectory(false);
      router.replace({ pathname: '/reader/[id]', params: { id, storyId } });
    });
  };
  const back = useCallback(() => {
    void leave(() => {
      if (router.canGoBack()) router.back();
      else router.replace({ pathname: '/story/[id]', params: { id: storyId } });
    });
  }, [leave, router, storyId]);
  async function markChapter() {
    if (!scope.userId) {
      void leave(() =>
        router.replace({
          pathname: '/login',
          params: { next: `/reader/${chapterId}?storyId=${storyId}` },
        }),
      );
      return;
    }
    if (!chapter.data || !syncState.ready || !bookmarkReady || bookmarkLock.current) return;
    bookmarkLock.current = true;
    setBookmarkNotice('');
    try {
      const saved = restoreSaved?.chapterId === chapterId ? restoreSaved : null;
      const current =
        lastPosition.current?.key === restoreKey ? lastPosition.current.position : saved;
      const input =
        chapter.data.type === 'NOVEL'
          ? { textOffset: current?.textOffset ?? 0, pageNumber: null }
          : {
              textOffset: null,
              pageNumber: current?.pageNumber ?? chapter.data.pages[0].pageNumber,
            };
      const result = await saveBookmark.mutateAsync({ storyId, chapterId, ...input });
      if (scope.active())
        setBookmarkNotice(
          result.created
            ? 'Đã lưu dấu trang. Xem lại tại Giá sách → Dấu trang đã lưu.'
            : 'Chương này đã có dấu trang; vị trí cũ được giữ nguyên.',
        );
    } catch (e) {
      if (scope.active()) setBookmarkNotice(safeError(e).message);
    } finally {
      bookmarkLock.current = false;
    }
  }
  useFocusEffect(
    useCallback(() => {
      const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
        back();
        return true;
      });
      return () => subscription.remove();
    }, [back]),
  );
  return (
    <SafeAreaView
      pointerEvents={leaving ? 'none' : 'auto'}
      style={{ flex: 1, backgroundColor: theme.background }}
    >
      <StatusBar style={themeName === 'dark' ? 'light' : 'dark'} />
      <View style={[styles.top, { borderBottomColor: theme.border }]}>
        {tools && <Button label="Quay lại" disabled={leaving} onPress={back} theme={theme} />}
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: theme.muted, fontSize: 12 }}>
            {chapter.data ? `Chương ${chapter.data.chapterNumber}` : 'WebNovel Reader'}
          </Text>
        </View>
        <Button
          label={tools ? 'Ẩn công cụ' : 'Hiện công cụ'}
          onPress={() => setTools((value) => !value)}
          theme={theme}
        />
      </View>
      {syncState.notice && (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.muted, padding: 12, fontSize: 13, lineHeight: 20 }}
        >
          {syncState.notice}
        </Text>
      )}
      {!!bookmarkNotice && (
        <Text
          accessibilityRole="alert"
          style={{ color: theme.text, padding: 12, backgroundColor: theme.panel }}
        >
          {bookmarkNotice}
        </Text>
      )}
      {bookmark.data?.positionAdjusted && (
        <Text style={{ color: theme.muted, padding: 12 }}>
          Nội dung chương đã thay đổi. Dấu trang được mở tại vị trí còn khả dụng.
        </Text>
      )}
      {leaving && (
        <Text accessibilityLiveRegion="polite" style={{ color: theme.muted, padding: 12 }}>
          Đang hoàn tất lưu vị trí…
        </Text>
      )}
      {chapter.isPending ? (
        <LoadingState label="Đang tải chương…" />
      ) : chapter.error && safeError(chapter.error).code === 'CHAPTER_LOCKED' ? (
        <UnlockChapter
          key={restoreKey}
          storyId={storyId}
          chapterId={chapterId}
          onOpened={() => void chapter.refetch()}
        />
      ) : chapter.error ? (
        <ErrorState
          message={safeError(chapter.error).message}
          onRetry={() => {
            void chapter.refetch();
          }}
        />
      ) : bookmarkId && (!scope.userId || bookmark.error) ? (
        <ErrorState
          message={
            !scope.userId ? 'Đăng nhập để mở dấu trang của bạn.' : safeError(bookmark.error).message
          }
          onRetry={
            scope.userId
              ? () => {
                  void bookmark.refetch();
                }
              : undefined
          }
        />
      ) : chapter.data ? (
        <>
          {!bookmarkReady ||
          !syncState.ready ||
          (isNovel ? !hydrated : !comicPreferences.hydrated) ? (
            <LoadingState label="Đang tải vị trí đọc…" />
          ) : (
            <ReaderBody
              key={`${restoreKey}:${chapter.data.updatedAt}`}
              chapter={chapter.data}
              fontSize={fontSize}
              lineSpacing={lineSpacing}
              fontFamily={readerFontFamily(preferences.font)}
              comicMode={comicPreferences.mode}
              theme={theme}
              saved={restoreSaved}
              onPosition={position}
            />
          )}
        </>
      ) : null}
      {tools && (
        <View style={[styles.bottom, { borderTopColor: theme.border }]}>
          <View style={styles.row}>
            <Button
              label="Chương trước"
              disabled={leaving || index <= 0 || !!list.error}
              onPress={() => openChapter(chapters[index - 1].id)}
              theme={theme}
            />
            <Button label="Danh sách chương" onPress={() => setDirectory(true)} theme={theme} />
            <Button
              label="Chương sau"
              disabled={leaving || index < 0 || index + 1 >= chapters.length || !!list.error}
              onPress={() => openChapter(chapters[index + 1].id)}
              theme={theme}
            />
          </View>
          <Button
            label="Tùy chỉnh đọc"
            disabled={isNovel ? !hydrated : !comicPreferences.hydrated}
            onPress={() => setSettings(true)}
            theme={theme}
          />
          <Button
            label={
              scope.userId
                ? saveBookmark.isPending
                  ? 'Đang lưu dấu trang…'
                  : 'Đánh dấu chương'
                : 'Đăng nhập để đánh dấu'
            }
            disabled={
              leaving ||
              !chapter.data ||
              !bookmarkReady ||
              (scope.userId ? !syncState.ready || saveBookmark.isPending : false)
            }
            onPress={() => {
              void markChapter();
            }}
            theme={theme}
          />
        </View>
      )}
      <Modal visible={directory} animationType="slide" onRequestClose={() => setDirectory(false)}>
        <SafeAreaView style={{ flex: 1, backgroundColor: theme.background, padding: 20, gap: 16 }}>
          <Text
            accessibilityRole="header"
            style={{ color: theme.text, fontSize: 24, fontWeight: '700' }}
          >
            Các chương đã xuất bản
          </Text>
          <Button label="Đóng danh sách chương" onPress={() => setDirectory(false)} theme={theme} />
          {list.isPending ? (
            <LoadingState label="Đang tải chương…" />
          ) : (
            <FlatList
              data={chapters}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ gap: 10 }}
              renderItem={({ item }) => (
                <Button
                  label={`Chương ${item.chapterNumber} · ${item.title}${item.isVip ? ` · VIP ${item.coinPrice ?? 10} Coin` : ''}${item.id === chapterId ? ' · Đang đọc' : ''}`}
                  selected={item.id === chapterId}
                  onPress={() => openChapter(item.id)}
                  theme={theme}
                />
              )}
              ListEmptyComponent={
                <Text style={{ color: theme.muted }}>Chưa có chương được xuất bản.</Text>
              }
              ListFooterComponent={
                <View style={{ gap: 12, marginTop: 16 }}>
                  {list.error && (
                    <ErrorState
                      message={safeError(list.error).message}
                      onRetry={() => {
                        void list.refetch();
                      }}
                    />
                  )}
                  {list.hasNextPage && (
                    <Button
                      label={list.isFetchingNextPage ? 'Đang tải thêm…' : 'Tải thêm chương'}
                      disabled={list.isFetchingNextPage}
                      onPress={() => {
                        void list.fetchNextPage();
                      }}
                      theme={theme}
                    />
                  )}
                </View>
              }
            />
          )}
        </SafeAreaView>
      </Modal>
      <Modal
        visible={settings}
        animationType="slide"
        onRequestClose={() => setSettings(false)}
        transparent
      >
        <View style={styles.overlay}>
          <SafeAreaView style={{ backgroundColor: theme.panel, maxHeight: '90%' }}>
            <ScrollView contentContainerStyle={{ padding: 24, gap: 20 }}>
              <Text accessibilityRole="header" style={{ color: theme.text, fontSize: 22 }}>
                Trải nghiệm đọc
              </Text>
              {isNovel && (
                <NovelSettingsPanel
                  value={preferences}
                  onChange={readerSettings.update}
                  onReset={readerSettings.reset}
                  notice={settingsNotice}
                />
              )}
              {!isNovel && (
                <ComicModePicker
                  mode={comicPreferences.mode}
                  onChange={comicSettings.setMode}
                  theme={theme}
                  notice={comicPreferences.notice}
                />
              )}
              {!isNovel && (
                <View style={styles.row}>
                  {(
                    [
                      { value: 'light', label: 'Nền sáng' },
                      { value: 'sepia', label: 'Nền sepia' },
                      { value: 'dark', label: 'Nền tối' },
                    ] as const
                  ).map(({ value, label }) => (
                    <Button
                      key={value}
                      label={label}
                      selected={themeName === value}
                      onPress={() => setTheme(value)}
                      theme={theme}
                    />
                  ))}
                </View>
              )}
              <Button label="Đóng tùy chỉnh" onPress={() => setSettings(false)} theme={theme} />
            </ScrollView>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}
const styles = StyleSheet.create({
  button: {
    minHeight: 48,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    justifyContent: 'center',
    flexShrink: 1,
  },
  top: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 12, borderBottomWidth: 1 },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  bottom: { padding: 12, gap: 8, borderTopWidth: 1 },
  overlay: { flex: 1, backgroundColor: '#00000055', justifyContent: 'flex-end' },
});
