import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  Text,
  View,
  type ViewToken,
} from 'react-native';
import { ChevronLeft, ChevronRight, Maximize2, Check } from 'lucide-react-native';
import type { ComicPage, Position, SavedProgress } from './api';
import { comicPosition } from './positions';
import type { ReaderTheme } from './theme';
import type { ComicMode } from '../../stores/comic-settings';
import { ComicPageViewer } from './ComicPageViewer';

const ComicImage = memo(function ComicImage({
  page,
  width,
  theme,
  onReady,
  onZoom,
  fitHeight,
}: {
  page: ComicPage;
  width: number;
  theme: ReaderTheme;
  onReady: (pageNumber: number, ready: boolean) => void;
  onZoom: (page: ComicPage) => void;
  fitHeight?: number;
}) {
  const [ratio, setRatio] = useState<number | null>(null);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    onReady(page.pageNumber, false);
    Image.getSize(
      page.imageUrl,
      (w, h) => {
        if (!active) return;
        if (w > 0 && h > 0 && Number.isFinite(w / h) && (width * h) / w <= 100_000) setRatio(w / h);
        else setFailed(true);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [page.imageUrl, page.pageNumber, width, attempt, onReady]);
  const imageWidth = ratio && fitHeight ? Math.min(width, fitHeight * ratio) : width;
  const imageHeight = ratio ? imageWidth / ratio : undefined;
  return (
    <View
      testID={`comic-page-${page.pageNumber}`}
      style={{
        width,
        height: imageHeight,
        minHeight: ratio ? undefined : 180,
        backgroundColor: theme.panel,
        justifyContent: 'center',
        alignItems: 'center',
      }}
    >
      {ratio && !failed && (
        <Image
          source={{ uri: page.imageUrl }}
          accessibilityLabel={`Trang ${page.pageNumber}`}
          resizeMode="contain"
          style={{ width: imageWidth, height: imageHeight }}
          onLoad={() => {
            setLoaded(true);
            onReady(page.pageNumber, true);
          }}
          onError={() => {
            setFailed(true);
            onReady(page.pageNumber, false);
          }}
        />
      )}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Phóng to trang ${page.pageNumber}`}
        onPress={() => onZoom(page)}
        style={{
          position: 'absolute',
          right: 12,
          bottom: 12,
          minWidth: 48,
          minHeight: 48,
          borderRadius: 14,
          borderWidth: 1,
          borderColor: theme.border,
          backgroundColor: theme.panel,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Maximize2 size={22} color={theme.text} />
      </Pressable>
      {failed ? (
        <View style={{ padding: 24, gap: 12 }}>
          <Text style={{ color: theme.text }}>Không tải được trang {page.pageNumber}.</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Thử lại trang ${page.pageNumber}`}
            style={{ minHeight: 48, justifyContent: 'center' }}
            onPress={() => {
              setFailed(false);
              setLoaded(false);
              setRatio(null);
              setAttempt((n) => n + 1);
            }}
          >
            <Text style={{ color: theme.text }}>Thử lại ảnh</Text>
          </Pressable>
        </View>
      ) : (
        !loaded && (
          <View style={ratio ? { position: 'absolute', alignSelf: 'center' } : { padding: 28 }}>
            <ActivityIndicator
              color={theme.muted}
              accessibilityLabel={`Đang tải trang ${page.pageNumber}`}
            />
          </View>
        )
      )}
    </View>
  );
});

export const ComicContent = memo(function ComicContent({
  chapterId,
  pages,
  title,
  saved,
  restoreReady,
  theme,
  onPosition,
  mode = 'vertical',
}: {
  chapterId: string;
  pages: ComicPage[];
  title: string;
  saved: SavedProgress | null;
  restoreReady: boolean;
  theme: ReaderTheme;
  onPosition: (position: Position) => void;
  mode?: ComicMode;
}) {
  // Mount only after progress is resolved. Start the window at the saved page without
  // estimating the heights of pages that have not been measured/downloaded.
  const initial = useRef(
    saved?.chapterId === chapterId
      ? Math.max(
          0,
          pages.findIndex((p) => p.pageNumber === saved.pageNumber),
        )
      : 0,
  );
  const [base, setBase] = useState(initial.current);
  const [width, setWidth] = useState(0);
  const [height, setHeight] = useState(0);
  const [pageHeight, setPageHeight] = useState(0);
  const [zoomPage, setZoomPage] = useState<ComicPage | null>(null);
  const [lastLoaded, setLastLoaded] = useState(false);
  const [current, setCurrent] = useState(pages[initial.current].pageNumber);
  const interacted = useRef(false);
  const zoomOpen = useRef(false);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const atEnd = useRef(false);
  const loadedPages = useRef(new Set<number>());
  const onReady = useCallback(
    (pageNumber: number, ready: boolean) => {
      if (ready) loadedPages.current.add(pageNumber);
      else loadedPages.current.delete(pageNumber);
      if (pageNumber === pages[pages.length - 1].pageNumber) setLastLoaded(ready);
    },
    [pages],
  );
  const onPositionRef = useRef(onPosition);
  onPositionRef.current = onPosition;
  const currentRef = useRef(current);
  currentRef.current = current;
  useLayoutEffect(() => {
    // A mode change is restoration, not a reading interaction. The vertical
    // window starts at the current actual page without guessed image heights.
    interacted.current = false;
    atEnd.current = false;
    setBase(
      Math.max(
        0,
        pages.findIndex((p) => p.pageNumber === currentRef.current),
      ),
    );
  }, [mode, pages]);
  const currentIndex = Math.max(
    0,
    pages.findIndex((p) => p.pageNumber === current),
  );
  function openZoom(page: ComicPage) {
    interacted.current = false;
    atEnd.current = false;
    zoomOpen.current = true;
    setZoomPage(page);
  }
  function turn(direction: number) {
    const index = pages.findIndex((p) => p.pageNumber === currentRef.current) + direction;
    if (index < 0 || index >= pages.length) return;
    const page = pages[index];
    setCurrent(page.pageNumber);
    currentRef.current = page.pageNumber;
    onPositionRef.current(comicPosition(chapterId, page.pageNumber, index, pages.length));
  }
  const data = useMemo(() => pages.slice(base), [pages, base]);
  const viewability = useRef({ itemVisiblePercentThreshold: 1, minimumViewTime: 100 });
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken<ComicPage>[] }) => {
      if (modeRef.current !== 'vertical' || zoomOpen.current) return;
      const first = viewableItems.find((item) => item.isViewable)?.item;
      if (!first) return;
      setCurrent(first.pageNumber);
      currentRef.current = first.pageNumber;
      if (interacted.current)
        onPositionRef.current(
          comicPosition(
            chapterId,
            first.pageNumber,
            pages.findIndex((p) => p.pageNumber === first.pageNumber),
            pages.length,
            atEnd.current &&
              first.pageNumber === pages[pages.length - 1].pageNumber &&
              loadedPages.current.has(first.pageNumber),
          ),
        );
    },
    [chapterId, pages],
  );
  if (!restoreReady) return null;
  return (
    <View
      testID="comic-viewport"
      style={{ flex: 1 }}
      onLayout={(e) => {
        setWidth(Math.floor(e.nativeEvent.layout.width));
        setHeight(Math.floor(e.nativeEvent.layout.height));
      }}
    >
      <Text
        accessibilityLiveRegion="polite"
        style={{ color: theme.muted, padding: 10, textAlign: 'center' }}
      >
        Trang {current} · {pages.length} trang ảnh
      </Text>
      {width > 0 && mode === 'vertical' && (
        <FlatList
          testID="comic-list"
          data={data}
          keyExtractor={(item) => String(item.pageNumber)}
          initialNumToRender={2}
          maxToRenderPerBatch={2}
          windowSize={3}
          removeClippedSubviews={false}
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          ListHeaderComponent={
            <View style={{ padding: 20, gap: 12 }}>
              <Text
                accessibilityRole="header"
                style={{ color: theme.text, fontSize: 22, lineHeight: 32, fontWeight: '700' }}
              >
                {title}
              </Text>
              {base > 0 && (
                <Pressable
                  accessibilityRole="button"
                  style={{ minHeight: 48, justifyContent: 'center' }}
                  onPress={() => setBase((n) => Math.max(0, n - 10))}
                >
                  <Text style={{ color: theme.text }}>Tải các trang trước</Text>
                </Pressable>
              )}
            </View>
          }
          renderItem={({ item }) => (
            <ComicImage
              page={item}
              width={width}
              theme={theme}
              onReady={onReady}
              onZoom={openZoom}
            />
          )}
          viewabilityConfig={viewability.current}
          onViewableItemsChanged={onViewableItemsChanged}
          onTouchStart={() => {
            interacted.current = true;
          }}
          onScrollBeginDrag={() => {
            interacted.current = true;
          }}
          scrollEventThrottle={150}
          onScroll={(e) => {
            if (!interacted.current || zoomOpen.current || modeRef.current !== 'vertical') return;
            const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
            const currentIndex = pages.findIndex((p) => p.pageNumber === currentRef.current);
            const end =
              currentIndex === pages.length - 1 &&
              contentOffset.y + layoutMeasurement.height >= contentSize.height - 2 &&
              loadedPages.current.has(currentRef.current);
            atEnd.current = contentOffset.y + layoutMeasurement.height >= contentSize.height - 2;
            onPositionRef.current(
              comicPosition(chapterId, currentRef.current, currentIndex, pages.length, end),
            );
          }}
        />
      )}
      {width > 0 && mode === 'paged' && (
        <View style={{ flex: 1 }} testID="comic-paged">
          <Text
            numberOfLines={1}
            style={{ color: theme.muted, fontSize: 13, paddingHorizontal: 16, paddingBottom: 8 }}
          >
            {title}
          </Text>
          <View
            testID="comic-page-viewport"
            onLayout={(e) => setPageHeight(Math.floor(e.nativeEvent.layout.height))}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}
          >
            <ComicImage
              key={current}
              page={pages[currentIndex]}
              width={width}
              fitHeight={Math.max(1, pageHeight || height - 200)}
              theme={theme}
              onReady={onReady}
              onZoom={openZoom}
            />
          </View>
          <View style={{ padding: 12, gap: 10, borderTopWidth: 1, borderTopColor: theme.border }}>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Trang trước"
                accessibilityState={{ disabled: currentIndex === 0 }}
                disabled={currentIndex === 0}
                onPress={() => turn(-1)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  gap: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.panel,
                  borderRadius: 14,
                  minHeight: 48,
                  opacity: currentIndex === 0 ? 0.4 : 1,
                }}
              >
                <ChevronLeft color={theme.text} size={20} />
                <Text style={{ color: theme.text }}>Trước</Text>
              </Pressable>
              <Text style={{ color: theme.muted, fontSize: 13 }}>
                {currentIndex + 1} / {pages.length}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Trang sau"
                accessibilityState={{ disabled: currentIndex === pages.length - 1 }}
                disabled={currentIndex === pages.length - 1}
                onPress={() => turn(1)}
                style={{
                  flex: 1,
                  flexDirection: 'row',
                  gap: 6,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderWidth: 1,
                  borderColor: theme.border,
                  backgroundColor: theme.panel,
                  borderRadius: 14,
                  minHeight: 48,
                  opacity: currentIndex === pages.length - 1 ? 0.4 : 1,
                }}
              >
                <Text style={{ color: theme.text }}>Sau</Text>
                <ChevronRight color={theme.text} size={20} />
              </Pressable>
            </View>
            {currentIndex === pages.length - 1 && (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Đã đọc hết chương"
                accessibilityState={{ disabled: !lastLoaded }}
                disabled={!lastLoaded}
                onPress={() =>
                  onPositionRef.current(
                    comicPosition(chapterId, current, currentIndex, pages.length, true),
                  )
                }
                style={{
                  minHeight: 48,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 8,
                  opacity: lastLoaded ? 1 : 0.4,
                }}
              >
                <Check color={theme.text} size={18} />
                <Text style={{ color: theme.text }}>Đã đọc hết chương</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}
      {zoomPage && (
        <ComicPageViewer
          key={zoomPage.pageNumber}
          page={zoomPage}
          theme={theme}
          onClose={() => {
            zoomOpen.current = false;
            interacted.current = false;
            atEnd.current = false;
            setZoomPage(null);
          }}
        />
      )}
    </View>
  );
});
