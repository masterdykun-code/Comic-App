import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { ScrollView, Text, View } from 'react-native';
import type { Position, SavedProgress } from './api';
import { novelPosition, textBlocks } from './positions';
import type { ReaderTheme } from './theme';

export const NovelContent = memo(function NovelContent({
  chapterId,
  content,
  title,
  fontSize,
  lineSpacing,
  fontFamily,
  theme,
  saved,
  restoreReady,
  onPosition,
}: {
  chapterId: string;
  content: string;
  title: string;
  fontSize: number;
  lineSpacing: number;
  fontFamily?: string;
  theme: ReaderTheme;
  saved: SavedProgress | null;
  restoreReady: boolean;
  onPosition: (position: Position) => void;
}) {
  const blocks = useMemo(() => textBlocks(content), [content]);
  const scroll = useRef<ScrollView>(null);
  const layouts = useRef(new Map<number, number>());
  const anchor = useRef(0);
  const viewport = useRef(0);
  const viewportWidth = useRef(0);
  const contentHeight = useRef(0);
  const restored = useRef(false);
  const relayout = useRef(false);
  const programmatic = useRef(true);
  const target = useRef(0);
  const layoutKey = `${fontSize}:${lineSpacing}:${fontFamily ?? 'system'}`;
  const previousLayout = useRef(layoutKey);
  const restore = useCallback(() => {
    if (!restoreReady) return;
    if (!restored.current) {
      const offset = saved?.chapterId === chapterId ? (saved.textOffset ?? 0) : 0;
      target.current = Math.max(0, Math.min(offset, content.length));
    }
    if (restored.current && !relayout.current) return;
    const block = [...blocks].reverse().find((b) => b.start <= target.current);
    const y = block && block.start > 0 ? layouts.current.get(block.start) : 0;
    if (y === undefined) return;
    programmatic.current = true;
    if (target.current === content.length) scroll.current?.scrollToEnd({ animated: false });
    else scroll.current?.scrollTo({ y, animated: false });
    anchor.current = target.current === content.length ? content.length : (block?.start ?? 0);
    restored.current = true;
    relayout.current = false;
  }, [blocks, chapterId, content.length, restoreReady, saved]);
  useEffect(() => {
    restore();
  }, [restore]);
  useLayoutEffect(() => {
    if (previousLayout.current !== layoutKey) {
      previousLayout.current = layoutKey;
      layouts.current.clear();
      target.current = anchor.current;
      relayout.current = true;
    }
  }, [layoutKey]);
  // Measurements are native layout coordinates; map to exact block UTF-16 starts.
  return (
    <ScrollView
      ref={scroll}
      testID="novel-scroll"
      style={{ flex: 1, backgroundColor: theme.background }}
      contentContainerStyle={{
        paddingHorizontal: 24,
        paddingTop: 24,
        paddingBottom: 64,
        width: '100%',
        maxWidth: 740,
        alignSelf: 'center',
      }}
      onLayout={(e) => {
        const width = e.nativeEvent.layout.width;
        if (viewportWidth.current && viewportWidth.current !== width) {
          target.current = anchor.current;
          relayout.current = true;
          layouts.current.clear();
        }
        viewportWidth.current = width;
        viewport.current = e.nativeEvent.layout.height;
        restore();
      }}
      onContentSizeChange={(_width, height) => {
        contentHeight.current = height;
        restore();
      }}
      onTouchStart={() => {
        programmatic.current = false;
      }}
      onScrollBeginDrag={() => {
        programmatic.current = false;
      }}
      scrollEventThrottle={100}
      onScroll={(e) => {
        restore();
        if (!restored.current || relayout.current) return;
        const y = Math.max(0, e.nativeEvent.contentOffset.y);
        let offset = 0;
        for (const block of blocks) {
          const top = layouts.current.get(block.start);
          if (top !== undefined && top <= y + 1) offset = block.start;
        }
        if (
          contentHeight.current > viewport.current &&
          y + viewport.current >= contentHeight.current - 2
        )
          offset = content.length;
        // Layout/restoration can emit late scroll events on Android. Only a
        // real touch/drag may start progress writes, regardless of elapsed time.
        if (programmatic.current) return;
        anchor.current = offset;
        onPosition(novelPosition(chapterId, offset, content.length));
      }}
    >
      <Text
        accessibilityRole="header"
        style={{
          color: theme.text,
          fontFamily,
          fontSize: 24,
          lineHeight: 34,
          fontWeight: '700',
          marginBottom: 24,
        }}
      >
        {title}
      </Text>
      {blocks.map((block) => (
        <View
          key={`${block.start}:${layoutKey}`}
          testID={`novel-block-${block.start}`}
          onLayout={(e) => {
            layouts.current.set(block.start, e.nativeEvent.layout.y);
            restore();
          }}
        >
          <Text
            selectable
            style={{
              color: theme.text,
              fontFamily,
              fontSize,
              lineHeight: Math.round(fontSize * lineSpacing),
            }}
          >
            {(block.start + block.text.length === content.length
              ? block.text
              : block.text.replace(/\r?\n$/, '')) || '\u200B'}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
});
