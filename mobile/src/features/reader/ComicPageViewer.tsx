import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Minus, Plus, RotateCcw, X } from 'lucide-react-native';
import type { ComicPage } from './api';
import type { ReaderTheme } from './theme';

export function ComicPageViewer({
  page,
  theme,
  onClose,
}: {
  page: ComicPage;
  theme: ReaderTheme;
  onClose: () => void;
}) {
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [ratio, setRatio] = useState<number | null>(null);
  const [zoom, setZoom] = useState(1);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const horizontal = useRef<ScrollView>(null),
    vertical = useRef<ScrollView>(null);
  useEffect(() => {
    let active = true;
    Image.getSize(
      page.imageUrl,
      (w, h) => {
        if (!active) return;
        if (w > 0 && h > 0 && Number.isFinite(w / h) && (viewport.width * h) / w <= 100000)
          setRatio(w / h);
        else setFailed(true);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [page.imageUrl, attempt, viewport.width]);
  const maxZoom =
    ratio && viewport.width > 0 ? Math.max(1, Math.min(3, (100000 * ratio) / viewport.width)) : 3;
  const appliedZoom = Math.min(zoom, maxZoom);
  const width = viewport.width * appliedZoom,
    height = ratio ? width / ratio : 0;
  function changeZoom(next: number) {
    setZoom(Math.max(1, Math.min(maxZoom, next)));
  }
  useEffect(() => {
    horizontal.current?.scrollTo({ x: 0, animated: false });
    vertical.current?.scrollTo({ y: 0, animated: false });
  }, [page.pageNumber, page.imageUrl, viewport.width, viewport.height]);
  const ready = !!ratio && loaded && !failed && viewport.width > 0;
  return (
    <Modal animationType="fade" visible onRequestClose={onClose}>
      <SafeAreaView style={{ flex: 1, backgroundColor: theme.background }}>
        <View
          style={{
            padding: 12,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 12,
            borderBottomWidth: 1,
            borderBottomColor: theme.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.text, fontSize: 18, fontWeight: '600' }}>
              Trang {page.pageNumber}
            </Text>
            <Text style={{ color: theme.muted, fontSize: 12 }}>Xem chi tiết ảnh</Text>
          </View>
          <ZoomTool label="Đóng ảnh phóng to" onPress={onClose} Icon={X} theme={theme} />
        </View>
        <View
          testID="comic-zoom-viewport"
          style={{ flex: 1, overflow: 'hidden' }}
          onLayout={(e) => {
            if (
              viewport.width !== Math.floor(e.nativeEvent.layout.width) ||
              viewport.height !== Math.floor(e.nativeEvent.layout.height)
            )
              setZoom(1);
            setViewport({
              width: Math.floor(e.nativeEvent.layout.width),
              height: Math.floor(e.nativeEvent.layout.height),
            });
          }}
        >
          {ratio && !failed && viewport.width > 0 && (
            <ScrollView
              ref={horizontal}
              horizontal
              nestedScrollEnabled
              bounces={false}
              contentContainerStyle={{ minWidth: viewport.width }}
              testID="comic-zoom-horizontal"
            >
              <ScrollView
                ref={vertical}
                nestedScrollEnabled
                bounces={false}
                style={{ width: Math.max(width, viewport.width), height: viewport.height }}
                contentContainerStyle={{
                  minHeight: viewport.height,
                  justifyContent: 'center',
                  alignItems: 'center',
                }}
                testID="comic-zoom-vertical"
              >
                <Image
                  source={{ uri: page.imageUrl }}
                  accessibilityLabel={`Ảnh phóng to trang ${page.pageNumber}`}
                  resizeMode="contain"
                  style={{ width, height }}
                  onLoad={() => setLoaded(true)}
                  onError={() => {
                    setFailed(true);
                    setLoaded(false);
                  }}
                />
              </ScrollView>
            </ScrollView>
          )}
          {failed ? (
            <View style={{ padding: 24, gap: 16 }}>
              <Text style={{ color: theme.text }}>Không tải được ảnh phóng to.</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Thử lại ảnh phóng to"
                style={{ minHeight: 48 }}
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
              <View
                pointerEvents="none"
                style={{
                  position: 'absolute',
                  inset: 0,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <ActivityIndicator color={theme.text} />
              </View>
            )
          )}
        </View>
        <View style={{ padding: 16, borderTopWidth: 1, borderTopColor: theme.border, gap: 12 }}>
          <View
            style={{
              flexDirection: 'row',
              gap: 14,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <ZoomTool
              label="Thu nhỏ ảnh"
              onPress={() => changeZoom(appliedZoom - 0.5)}
              Icon={Minus}
              disabled={!ready || appliedZoom <= 1}
              theme={theme}
            />
            <Text
              accessibilityLiveRegion="polite"
              style={{ color: theme.text, minWidth: 54, textAlign: 'center', fontSize: 16 }}
            >
              {Math.round(appliedZoom * 100)}%
            </Text>
            <ZoomTool
              label="Phóng to ảnh"
              onPress={() => changeZoom(appliedZoom + 0.5)}
              Icon={Plus}
              disabled={!ready || appliedZoom >= maxZoom}
              theme={theme}
            />
            <ZoomTool
              label="Đặt lại kích thước ảnh"
              onPress={() => {
                changeZoom(1);
                horizontal.current?.scrollTo({ x: 0, animated: false });
                vertical.current?.scrollTo({ y: 0, animated: false });
              }}
              Icon={RotateCcw}
              disabled={!ready}
              theme={theme}
            />
          </View>
          <Text style={{ color: theme.muted, textAlign: 'center', fontSize: 12, lineHeight: 18 }}>
            Dùng + / − để phóng to. Kéo ngang hoặc dọc để xem phần ảnh còn lại.
          </Text>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

function ZoomTool({
  label,
  onPress,
  Icon,
  disabled = false,
  theme,
}: {
  label: string;
  onPress: () => void;
  Icon: typeof Plus;
  disabled?: boolean;
  theme: ReaderTheme;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={{
        minWidth: 48,
        minHeight: 48,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: 14,
        borderWidth: 1,
        borderColor: theme.border,
        opacity: disabled ? 0.35 : 1,
      }}
    >
      <Icon size={22} color={theme.text} />
    </Pressable>
  );
}
