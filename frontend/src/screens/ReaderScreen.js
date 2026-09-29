import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Modal, FlatList, ActivityIndicator, Alert } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { getSetting, setSetting, READER_KEYS } from '../utils/storage';

const OFFLINE_KEY = 'offline_chapters_v1';

const THEMES = {
  light: { bg: '#fffdf7', text: '#333', sub: '#888', header: '#ffffff', border: '#eee', label: 'Sáng' },
  green: { bg: '#e8f5e9', text: '#2e3b2e', sub: '#6b8f71', header: '#f1f8e9', border: '#c8e6c9', label: 'Xanh mắt' },
  sepia: { bg: '#f5e6d3', text: '#4e342e', sub: '#8d6e63', header: '#efdfc7', border: '#d7ccc8', label: 'Giấy cũ' },
  dark:  { bg: '#1a1a1a', text: '#e0e0e0', sub: '#aaa', header: '#2a2a2a', border: '#444', label: 'Tối' },
};

export default function ReaderScreen({ route, navigation }) {
  const { novelId, chapterNumber } = route.params;
  const [chapter, setChapter] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fontSize, setFontSize] = useState(16);
  const [themeKey, setThemeKey] = useState('light');
  const [lineSpread, setLineSpread] = useState(12); // thêm vào cỡ chữ = lineHeight
  const [showSettings, setShowSettings] = useState(false);
  const [showToc, setShowToc] = useState(false);
  const [showChrome, setShowChrome] = useState(true);
  const [progress, setProgress] = useState(0);
  const [unlocked, setUnlocked] = useState(false);
  const [unlocking, setUnlocking] = useState(false);
  const scrollRef = useRef(null);
  const touchX = useRef(0);

  const theme = THEMES[themeKey] || THEMES.light;
  const isDark = themeKey === 'dark';

  // Load setting đã lưu
  useEffect(() => {
    (async () => {
      const fs = await getSetting(READER_KEYS.FONT_SIZE, '16');
      const th = await getSetting(READER_KEYS.THEME, 'light');
      const lh = await getSetting(READER_KEYS.LINE_HEIGHT, '12');
      const n = parseInt(fs, 10);
      if (n >= 12 && n <= 24) setFontSize(n);
      if (THEMES[th]) setThemeKey(th);
      const l = parseInt(lh, 10);
      if ([6, 12, 18].includes(l)) setLineSpread(l);
    })();
  }, []);

  const persistFont = (v) => { setFontSize(v); setSetting(READER_KEYS.FONT_SIZE, v); };
  const persistTheme = (k) => { setThemeKey(k); setSetting(READER_KEYS.THEME, k); };
  const persistSpread = (v) => { setLineSpread(v); setSetting(READER_KEYS.LINE_HEIGHT, v); };

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [chapRes, listRes] = await Promise.all([
        client.get(`/novels/${novelId}/chapters/${chapterNumber}`),
        client.get(`/novels/${novelId}/chapters`).catch(() => ({ data: [] })),
      ]);
      setChapter(chapRes.data);
      setChapters(Array.isArray(listRes.data) ? listRes.data : []);
      setProgress(0);
      setUnlocked(false);
      scrollRef.current?.scrollTo({ y: 0, animated: false });
      // Lưu lịch sử, chưa login thì backend 401 -> bỏ qua im lặng
      client.post('/history', { novel_id: Number(novelId), chapter_id: chapRes.data.id }).catch(() => {});
      // Nếu chương khóa, hỏi backend đã unlock chưa (cần login)
      if (chapRes.data.is_locked) {
        client.get(`/wallet/unlocks/${chapRes.data.id}`).then((r) => setUnlocked(!!r.data.unlocked)).catch(() => {});
      }
    } catch (e) {
      setError(e.response?.status === 404 ? 'Không tìm thấy chương này.' : (e.response?.data?.message || e.message || 'Lỗi tải chương'));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, [novelId, chapterNumber]);

  const goTo = (num) => {
    if (num < 1) return;
    if (chapters.length > 0 && num > chapters.length) {
      Alert.alert('Hết rồi', 'Đây là chương mới nhất.');
      return;
    }
    setShowToc(false);
    navigation.replace('Reader', { novelId, chapterNumber: num });
  };

  const onScroll = (e) => {
    const { contentSize, layoutMeasurement, contentOffset } = e.nativeEvent;
    const max = contentSize.height - layoutMeasurement.height;
    if (max > 0) setProgress(Math.min(1, Math.max(0, contentOffset.y / max)));
  };

  const toggleNight = () => persistTheme(isDark ? 'light' : 'dark');

  if (loading) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <ActivityIndicator size="large" />
        <Text style={{ marginTop: 8, color: theme.sub }}>Đang tải chương {chapterNumber}...</Text>
      </View>
    );
  }

  if (error || !chapter) {
    return (
      <View style={[styles.center, { backgroundColor: theme.bg }]}>
        <Text style={{ color: theme.text, marginBottom: 12 }}>{error || 'Lỗi không xác định'}</Text>
        <TouchableOpacity onPress={load} style={styles.retryBtn}><Text style={{ color: '#fff', fontWeight: '800' }}>Thử lại</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ marginTop: 12 }}><Text style={{ color: theme.sub }}>‹ Quay lại</Text></TouchableOpacity>
      </View>
    );
  }

  const locked = !!chapter.is_locked && !unlocked;
  const totalChap = chapters.length || Math.max(chapterNumber, 1);
  const paragraphs = String(chapter.content || '').split(/\n+/).filter(Boolean);

  return (
    <View
      style={[styles.container, { backgroundColor: theme.bg }]}
      // Vuốt ngang để đổi chương (nhẹ, không đè scroll dọc)
      onTouchStart={(e) => { touchX.current = e.nativeEvent.touches[0].pageX; }}
      onTouchEnd={(e) => {
        const dx = e.nativeEvent.changedTouches[0].pageX - touchX.current;
        if (Math.abs(dx) > 90) {
          if (dx < 0) goTo(chapterNumber + 1);
          else goTo(chapterNumber - 1);
        }
      }}
    >
      {showChrome && (
        <View style={[styles.header, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
          <TouchableOpacity onPress={() => navigation.goBack()}><Text style={[styles.back, { color: theme.text }]}>‹ Quay lại</Text></TouchableOpacity>
          <Text style={[styles.headerTitle, { color: theme.text }]} numberOfLines={1}>{chapter.title}</Text>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TouchableOpacity onPress={toggleNight} style={styles.iconBtn}>
              <Text>{isDark ? '☀️' : '🌙'}</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowToc(true)} style={styles.iconBtn}>
              <Text>☰</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => setShowSettings(!showSettings)} style={styles.iconBtn}>
              <Text>⚙️</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Thanh tiến trình đọc */}
      <View style={{ height: 3, backgroundColor: theme.border }}>
        <View style={{ height: 3, width: `${Math.round(progress * 100)}%`, backgroundColor: '#FFA500' }} />
      </View>

      {showSettings && (
        <View style={[styles.settingsPanel, { backgroundColor: theme.header, borderBottomColor: theme.border }]}>
          <View style={styles.setRow}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Cỡ chữ {fontSize}</Text>
            <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
              <TouchableOpacity onPress={() => persistFont(Math.max(12, fontSize - 1))} style={styles.settingBtnSmall}><Text style={{ fontWeight: '800' }}>A-</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => persistFont(Math.min(24, fontSize + 1))} style={styles.settingBtnSmall}><Text style={{ fontWeight: '800' }}>A+</Text></TouchableOpacity>
            </View>
          </View>
          <View style={styles.setRow}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Giãn dòng</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {[6, 12, 18].map((v) => (
                <TouchableOpacity key={v} onPress={() => persistSpread(v)} style={[styles.chip, lineSpread === v && styles.chipActive]}>
                  <Text style={{ color: lineSpread === v ? '#fff' : theme.text, fontWeight: '700', fontSize: 12 }}>
                    {v === 6 ? 'Khít' : v === 12 ? 'Vừa' : 'Rộng'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
          <View style={styles.setRow}>
            <Text style={[styles.settingLabel, { color: theme.text }]}>Nền ({THEMES[themeKey].label})</Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {Object.entries(THEMES).map(([k, t]) => (
                <TouchableOpacity key={k} onPress={() => persistTheme(k)} style={[styles.bgDot, { backgroundColor: t.bg }, themeKey === k && styles.bgActive]} />
              ))}
            </View>
          </View>
          <TouchableOpacity onPress={() => setShowChrome(!showChrome)} style={{ marginTop: 10, alignSelf: 'center' }}>
            <Text style={{ color: theme.sub, fontSize: 12 }}>{showChrome ? 'Ẩn thanh trên/dưới (toàn màn hình)' : 'Hiện thanh trên/dưới'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            onPress={async () => {
              try {
                const raw = await getSetting(OFFLINE_KEY, '[]');
                const list = JSON.parse(raw || '[]');
                const item = { novelId: Number(novelId), chapterNumber, title: chapter.title, content: chapter.content };
                const filtered = list.filter((x) => !(x.novelId === item.novelId && x.chapterNumber === item.chapterNumber));
                await setSetting(OFFLINE_KEY, JSON.stringify([item, ...filtered].slice(0, 20)));
                Alert.alert('Đã tải offline', 'Xem lại ở Giá sách > Offline');
              } catch { Alert.alert('Lỗi', 'Không lưu offline được'); }
            }}
            style={{ marginTop: 8, alignSelf: 'center', backgroundColor: '#eee', paddingHorizontal: 14, paddingVertical: 7, borderRadius: 16 }}
          >
            <Text style={{ fontSize: 12, fontWeight: '700' }}>↓ Tải chương này đọc offline</Text>
          </TouchableOpacity>
          <Text style={{ color: theme.sub, fontSize: 11, marginTop: 6, textAlign: 'center' }}>Setting tự lưu, thoát app mở lại vẫn giữ</Text>
        </View>
      )}

      {locked ? (
        <View style={[styles.center, { backgroundColor: theme.bg }]}>
          <Text style={{ fontSize: 40 }}>🔒</Text>
          <Text style={[styles.lockTitle, { color: theme.text }]}>Chương bị khóa</Text>
          <Text style={{ color: theme.sub, marginTop: 6 }}>
            {chapter.price_coins > 0 ? `Cần ${chapter.price_coins} coins để mở` : 'Chương VIP'}
          </Text>
          <TouchableOpacity
            style={[styles.retryBtn, unlocking && { opacity: 0.6 }]}
            disabled={unlocking}
            onPress={async () => {
              setUnlocking(true);
              try {
                const r = await client.post('/wallet/unlock', { chapter_id: chapter.id });
                Alert.alert('Thành công', r.data.message || 'Đã mở khóa');
                setUnlocked(true);
              } catch (e) {
                if (e.response?.status === 401) {
                  Alert.alert('Cần đăng nhập', 'Đăng nhập để mở khóa chương', [
                    { text: 'Hủy', style: 'cancel' },
                    { text: 'Đăng nhập', onPress: () => navigation.navigate('Login') },
                  ]);
                } else {
                  Alert.alert('Không mở được', e.response?.data?.message || e.message);
                }
              } finally { setUnlocking(false); }
            }}
          >
            <Text style={{ color: '#fff', fontWeight: '800' }}>{unlocking ? 'Đang mở...' : `Mở khóa (${chapter.price_coins || 0} coins)`}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => goTo(chapterNumber - 1)} style={{ marginTop: 12 }}>
            <Text style={{ color: theme.sub }}>‹ Về chương trước</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.content}
          onScroll={onScroll}
          scrollEventThrottle={16}
        >
          <Text style={[styles.title, { fontSize: fontSize + 6, color: theme.text }]}>{chapter.title}</Text>
          <Text style={{ color: theme.sub, textAlign: 'center', marginBottom: 12 }}>
            Chương {chapter.chapter_number}/{totalChap} • {chapter.views} lượt đọc • {Math.round(progress * 100)}%
          </Text>
          {paragraphs.map((p, i) => (
            <Text key={i} style={[styles.body, { fontSize, lineHeight: fontSize + lineSpread, color: theme.text }]}>{p}</Text>
          ))}
          <View style={{ height: 40 }} />
        </ScrollView>
      )}

      {/* Nút nổi khi ẩn chrome */}
      {!showChrome && (
        <TouchableOpacity onPress={() => setShowChrome(true)} style={styles.fab}>
          <Text style={{ fontWeight: '800' }}>⋮</Text>
        </TouchableOpacity>
      )}

      {showChrome && !locked && (
        <View style={[styles.footer, { backgroundColor: theme.header, borderTopColor: theme.border }]}>
          <TouchableOpacity
            disabled={chapterNumber <= 1}
            onPress={() => goTo(chapterNumber - 1)}
            style={[styles.navBtn, chapterNumber <= 1 && { opacity: 0.4 }]}
          >
            <Text style={{ color: chapterNumber <= 1 ? '#ccc' : theme.text }}>← Trước</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setShowToc(true)}>
            <Text style={{ color: theme.sub, fontWeight: '700' }}>{chapterNumber}/{totalChap} • Mục lục</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => goTo(chapterNumber + 1)} style={styles.navBtn}>
            <Text style={{ color: theme.text }}>Tiếp →</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Drawer mục lục */}
      <Modal visible={showToc} animationType="slide" transparent onRequestClose={() => setShowToc(false)}>
        <View style={styles.modalWrap}>
          <View style={[styles.modalBox, { backgroundColor: theme.header }]}>
            <View style={styles.modalHead}>
              <Text style={[styles.modalTitle, { color: theme.text }]}>Mục lục ({chapters.length} chương)</Text>
              <TouchableOpacity onPress={() => setShowToc(false)}><Text style={{ fontSize: 18, color: theme.text }}>✕</Text></TouchableOpacity>
            </View>
            <FlatList
              data={chapters}
              keyExtractor={(c) => String(c.id)}
              renderItem={({ item }) => {
                const active = item.chapter_number === chapterNumber;
                return (
                  <TouchableOpacity
                    onPress={() => goTo(item.chapter_number)}
                    style={[styles.tocRow, active && { backgroundColor: '#FFF3E0' }]}
                  >
                    <Text style={{ fontWeight: active ? '800' : '500', flex: 1, color: active ? '#E65100' : theme.text }} numberOfLines={1}>
                      {item.is_locked ? '🔒 ' : ''}C{item.chapter_number}: {item.title}
                    </Text>
                    {active && <Text style={{ color: '#E65100', fontWeight: '800' }}>●</Text>}
                  </TouchableOpacity>
                );
              }}
              ListEmptyComponent={<Text style={{ color: theme.sub, textAlign: 'center', marginTop: 20 }}>Chưa tải được mục lục</Text>}
            />
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingTop: 48, paddingHorizontal: 12, paddingBottom: 12, borderBottomWidth: 1 },
  back: { fontWeight: '700' },
  headerTitle: { flex: 1, textAlign: 'center', fontWeight: '700', marginHorizontal: 8 },
  iconBtn: { padding: 8, backgroundColor: '#f0f0f0', borderRadius: 8 },
  settingsPanel: { padding: 12, borderBottomWidth: 1 },
  setRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  settingLabel: { fontWeight: '700' },
  settingBtnSmall: { paddingHorizontal: 14, paddingVertical: 6, backgroundColor: '#eee', borderRadius: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#eee', borderRadius: 16 },
  chipActive: { backgroundColor: '#000' },
  content: { padding: 20 },
  title: { fontWeight: '900', marginBottom: 8, textAlign: 'center' },
  body: { marginBottom: 12, textAlign: 'justify' },
  footer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderTopWidth: 1 },
  navBtn: { paddingHorizontal: 16, paddingVertical: 8, backgroundColor: '#f0f0f0', borderRadius: 8 },
  bgDot: { width: 28, height: 28, borderRadius: 14, borderColor: '#ccc', borderWidth: 1 },
  bgActive: { borderWidth: 3, borderColor: '#FFA500' },
  retryBtn: { backgroundColor: '#000', paddingHorizontal: 20, paddingVertical: 12, borderRadius: 10 },
  fab: { position: 'absolute', right: 16, bottom: 90, width: 44, height: 44, borderRadius: 22, backgroundColor: '#eee', justifyContent: 'center', alignItems: 'center', elevation: 3 },
  lockTitle: { fontSize: 18, fontWeight: '900', marginTop: 8 },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { maxHeight: '80%', borderTopLeftRadius: 16, borderTopRightRadius: 16, paddingBottom: 20 },
  modalHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16 },
  modalTitle: { fontWeight: '900', fontSize: 16 },
  tocRow: { flexDirection: 'row', alignItems: 'center', padding: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', marginHorizontal: 12, borderRadius: 8 },
});
