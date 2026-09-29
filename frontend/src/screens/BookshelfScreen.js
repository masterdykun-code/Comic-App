import { View, Text, StyleSheet, ScrollView, Image, TouchableOpacity, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import { getSetting } from '../utils/storage';
import theme from '../theme';
import SafeCover from '../components/SafeCover';

const OFFLINE_KEY = 'offline_chapters_v1';

export default function BookshelfScreen({ navigation }) {
  const [activeTab, setActiveTab] = useState('Đọc');
  const [novels, setNovels] = useState([]);
  const [bookshelf, setBookshelf] = useState([]);
  const [history, setHistory] = useState([]);
  const [offline, setOffline] = useState([]);
  const { isLoggedIn } = useAuth();

  const load = useCallback(async () => {
    client.get('/novels?limit=6').then((r) => {
      const d = r.data?.data ?? r.data;
      setNovels(Array.isArray(d) ? d : []);
    }).catch(() => setNovels([]));
    if (isLoggedIn) {
      client.get('/bookshelf').then((r) => setBookshelf(Array.isArray(r.data) ? r.data : [])).catch(() => setBookshelf([]));
      client.get('/history').then((r) => setHistory(Array.isArray(r.data) ? r.data : [])).catch(() => setHistory([]));
    } else {
      setBookshelf([]); setHistory([]);
    }
    try {
      const raw = await getSetting(OFFLINE_KEY, '[]');
      setOffline(JSON.parse(raw || '[]'));
    } catch { setOffline([]); }
  }, [isLoggedIn]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  const removeShelf = (b) => {
    Alert.alert('Xóa khỏi tủ?', b.title, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa', style: 'destructive', onPress: async () => {
          try { await client.delete(`/bookshelf/${b.id}`); load(); }
          catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
        },
      },
    ]);
  };

  const removeHistory = async (h) => {
    try { await client.delete(`/history/${h.novel_id}`); load(); }
    catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
  };

  const clearHistory = () => {
    if (history.length === 0) return;
    Alert.alert(`Xóa ${history.length} lịch sử đọc?`, 'Không thể hoàn tác.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa hết', style: 'destructive', onPress: async () => {
          try {
            await Promise.all(history.map((h) => client.delete(`/history/${h.novel_id}`).catch(() => {})));
            load();
          } catch (e) { Alert.alert('Lỗi', e.message); }
        },
      },
    ]);
  };

  const renderList = () => {
    if (activeTab === 'Đã xem') {
      if (!isLoggedIn) return <Text style={styles.emptySub}>Đăng nhập để xem lịch sử</Text>;
      if (history.length === 0) return <Text style={styles.emptySub}>Chưa đọc truyện nào</Text>;
      return (
        <>
          <TouchableOpacity onPress={clearHistory} style={{ alignSelf: 'flex-end', marginBottom: 4 }}>
            <Text style={{ color: '#c00', fontSize: 12, fontWeight: '700' }}>Xóa tất cả</Text>
          </TouchableOpacity>
          {history.map((h) => (
            <View key={h.id} style={styles.rowItem}>
              <TouchableOpacity
                style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
                onPress={() => navigation.navigate('Reader', { novelId: h.novel_id, chapterNumber: h.chapter_number || 1 })}
              >
                <SafeCover uri={h.cover_url} title={h.title} style={styles.rowCover} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{h.title}</Text>
                  <Text style={styles.rowSub}>Đã đọc: {h.chapter_title || 'Chương 1'} • {new Date(h.last_read_at).toLocaleDateString()}</Text>
                </View>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => removeHistory(h)}><Text style={{ color: '#999', fontSize: 16 }}>✕</Text></TouchableOpacity>
            </View>
          ))}
        </>
      );
    }
    if (activeTab === 'Đọc') {
      if (!isLoggedIn) return <Text style={styles.emptySub}>Đăng nhập để xem kệ sách</Text>;
      if (bookshelf.length === 0) return <Text style={styles.emptySub}>Kệ sách trống — thêm truyện từ chi tiết</Text>;
      return bookshelf.map((b) => (
        <View key={b.id} style={styles.rowItem}>
          <TouchableOpacity
            style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }}
            onPress={() => navigation.navigate('NovelDetail', { id: b.id })}
          >
            <SafeCover uri={b.cover_url} title={b.title} style={styles.rowCover} />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{b.title}</Text>
              <Text style={styles.rowSub}>{b.category_name} • {b.total_views} views</Text>
            </View>
          </TouchableOpacity>
          <TouchableOpacity onPress={() => removeShelf(b)}><Text style={{ color: '#999', fontSize: 16 }}>✕</Text></TouchableOpacity>
        </View>
      ));
    }
    if (activeTab === 'Offline') {
      if (offline.length === 0) return <Text style={styles.emptySub}>Chưa tải chương nào. Vào Reader bấm "Tải offline".</Text>;
      return offline.map((o, i) => (
        <TouchableOpacity
          key={`${o.novelId}-${o.chapterNumber}-${i}`}
          onPress={() => navigation.navigate('Reader', { novelId: o.novelId, chapterNumber: o.chapterNumber })}
          style={styles.rowItem}
        >
          <View style={styles.offBadge}><Text style={{ fontWeight: '800', color: theme.primaryDark }}>↓</Text></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{o.title || `Truyện ${o.novelId} - C${o.chapterNumber}`}</Text>
            <Text style={styles.rowSub}>Đọc không cần mạng • {Math.round((o.content || '').length / 100) / 10}k ký tự</Text>
          </View>
        </TouchableOpacity>
      ));
    }
    return null;
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View>
          <Text style={styles.logoW}>W<Text style={{ color: theme.primary }}>novel</Text></Text>
          <Text style={styles.slogan}>Đọc truyện mỗi ngày, vui mỗi ngày</Text>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity onPress={() => navigation.navigate('Nổi bật')}><Ionicons name="search" size={22} color={theme.text} style={{ marginRight: 16 }} /></TouchableOpacity>
          <TouchableOpacity style={styles.registerBtn} onPress={() => navigation.navigate(isLoggedIn ? 'Tài khoản' : 'Login')}>
            <Text style={styles.registerText}>{isLoggedIn ? '👤 Tài khoản' : '🎁 Đăng nhập'}</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.banner} onPress={() => navigation.navigate('NovelDetail', { id: 4 })}>
        <Image source={{ uri: 'https://picsum.photos/seed/banner/80/100' }} style={styles.bannerImg} />
        <View style={{ flex: 1, marginHorizontal: 12 }}>
          <Text style={styles.bannerHint}>GỢI Ý HÀNG NGÀY</Text>
          <Text style={styles.bannerTitle}>Quỷ Xá — kinh dị hot nhất tuần</Text>
          <Text style={styles.bannerSub}>Bấm để đọc ngay • 2 chương VIP cuối</Text>
        </View>
        <View style={styles.bonusBtn}><Text style={{ color: '#fff', fontWeight: '700' }}>Đọc</Text></View>
      </TouchableOpacity>

      <ScrollView style={styles.whiteCard} contentContainerStyle={{ paddingBottom: 30 }}>
        <View style={styles.tabs}>
          {['Đọc', 'Đã xem', 'Offline'].map((t) => (
            <TouchableOpacity key={t} onPress={() => setActiveTab(t)} style={[styles.tab, activeTab === t && styles.tabActive]}>
              <Text style={[styles.tabText, activeTab === t && styles.tabTextActive]}>{t}{t === 'Offline' && offline.length ? ` (${offline.length})` : ''}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <View style={{ paddingHorizontal: 16, paddingTop: 8 }}>
          {renderList()}
        </View>

        {(activeTab === 'Đọc' && bookshelf.length === 0) && (
          <View style={styles.emptyWrap}>
            <Text style={{ fontSize: 60 }}>📚</Text>
            <Text style={styles.emptyTitle}>Kệ sách của tôi</Text>
            <Text style={styles.emptySub}>{isLoggedIn ? 'Chưa có truyện — vào Kho sách thêm' : 'Đăng nhập để xem Kệ sách của tôi'}</Text>
            {!isLoggedIn && (
              <TouchableOpacity style={[styles.bonusBtn, { marginTop: 10 }]} onPress={() => navigation.navigate('Login')}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Đăng nhập ngay</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        <Text style={{ fontWeight: '800', fontSize: 16, marginTop: 16, marginHorizontal: 16 }}>Gợi ý cho bạn</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 12 }}>
          {(Array.isArray(novels) ? novels : []).map((item) => (
            <TouchableOpacity key={String(item.id)} onPress={() => navigation.navigate('NovelDetail', { id: item.id })} style={styles.gridItem}>
              <SafeCover uri={item.cover_url} title={item.title} style={styles.gridCover} />
              <Text numberOfLines={2} style={styles.gridTitle}>{item.title}</Text>
              <Text style={styles.gridAuthor}>{item.category_name} • ★ {Number(item.rating || 0).toFixed(1)}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, paddingTop: 48, backgroundColor: theme.headerBg },
  logoW: { color: theme.text, fontSize: 28, fontWeight: '900', fontStyle: 'italic' },
  slogan: { color: theme.sub, fontSize: 11 },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  registerBtn: { backgroundColor: theme.primary, borderRadius: 20, paddingHorizontal: 12, paddingVertical: 7 },
  registerText: { color: '#fff', fontWeight: '700' },
  banner: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#FFE8D6', margin: 12, borderRadius: 16, padding: 12, borderWidth: 1, borderColor: theme.border },
  bannerImg: { width: 60, height: 80, borderRadius: 8 },
  bannerHint: { fontSize: 11, color: theme.primaryDark, fontWeight: '700' },
  bannerTitle: { fontSize: 15, fontWeight: '800', color: theme.text },
  bannerSub: { fontSize: 12, color: '#666' },
  bonusBtn: { backgroundColor: theme.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 10 },
  whiteCard: { flex: 1, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, marginTop: 4 },
  tabs: { flexDirection: 'row', gap: 12, padding: 16 },
  tab: { paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20, backgroundColor: '#F2F2F2' },
  tabActive: { backgroundColor: theme.primary },
  tabText: { color: '#666', fontWeight: '600' },
  tabTextActive: { color: '#fff' },
  emptyWrap: { alignItems: 'center', padding: 24 },
  emptyTitle: { fontWeight: '800', fontSize: 18, marginTop: 12 },
  emptySub: { color: '#999', marginTop: 6, textAlign: 'center' },
  gridItem: { width: '48%', margin: '1%', maxWidth: '50%' },
  gridCover: { width: '100%', height: 160, borderRadius: 10, backgroundColor: '#eee' },
  gridTitle: { fontWeight: '700', marginTop: 6 },
  gridAuthor: { color: '#888', fontSize: 12 },
  rowItem: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  rowCover: { width: 50, height: 70, borderRadius: 8, marginRight: 10, backgroundColor: '#eee' },
  rowTitle: { fontWeight: '700' },
  rowSub: { color: '#888', fontSize: 12, marginTop: 2 },
  offBadge: { width: 50, height: 50, borderRadius: 10, backgroundColor: theme.chip, justifyContent: 'center', alignItems: 'center', marginRight: 10 },
});
