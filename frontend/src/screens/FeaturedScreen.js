import { View, Text, StyleSheet, ScrollView, TouchableOpacity, TextInput, RefreshControl, Dimensions } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import client from '../api/client';
import { getSetting, setSetting } from '../utils/storage';
import theme from '../theme';
import SafeCover from '../components/SafeCover';

const { width } = Dimensions.get('window');
const HISTORY_KEY = 'search_history_v1';
const RANK_TABS = [
  { key: '', label: 'Tổng' },
  { key: 'daily', label: 'Ngày' },
  { key: 'weekly', label: 'Tuần' },
  { key: 'monthly', label: 'Tháng' },
];

function Skeleton({ w = '100%', h = 110 }) {
  return <View style={[styles.skeleton, { width: w, height: h }]} />;
}

export default function FeaturedScreen({ navigation }) {
  const [banner, setBanner] = useState([]);
  const [bannerIdx, setBannerIdx] = useState(0);
  const [fav, setFav] = useState([]);
  const [fresh, setFresh] = useState([]);
  const [ranking, setRanking] = useState([]);
  const [rankTab, setRankTab] = useState('');
  const [search, setSearch] = useState('');
  const [searchResult, setSearchResult] = useState(null);
  const [searching, setSearching] = useState(false);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const bannerRef = useRef(null);
  const debounce = useRef(null);

  const loadAll = async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [b, f, u, r] = await Promise.all([
        client.get('/novels/featured/banner').catch(() => client.get('/novels?sort=ranking&limit=5')),
        client.get('/novels?limit=8'),
        client.get('/novels?sort=newest&limit=6').catch(() => ({ data: [] })),
        client.get(`/novels?sort=ranking&limit=5${rankTab ? `&period=${rankTab}` : ''}`),
      ]);
      setBanner(Array.isArray(b.data) ? b.data : (b.data?.data || []));
      const fd = f.data?.data ?? f.data;
      setFav(Array.isArray(fd) ? fd : []);
      const ud = u.data?.data ?? u.data;
      setFresh(Array.isArray(ud) ? ud : []);
      const rd = r.data?.data ?? r.data;
      setRanking(Array.isArray(rd) ? rd : []);
    } catch {}
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => {
    (async () => {
      try {
        const h = await getSetting(HISTORY_KEY, '[]');
        setHistory(JSON.parse(h || '[]'));
      } catch { setHistory([]); }
    })();
    loadAll();
  }, []);

  useEffect(() => { loadAll(true); }, [rankTab]);

  // Carousel tự chạy 4s
  useEffect(() => {
    if (banner.length <= 1) return;
    const t = setInterval(() => {
      const next = (bannerIdx + 1) % banner.length;
      setBannerIdx(next);
      bannerRef.current?.scrollTo({ x: next * (width - 32), animated: true });
    }, 4000);
    return () => clearInterval(t);
  }, [banner, bannerIdx]);

  const pushHistory = async (kw) => {
    const k = kw.trim();
    if (!k) return;
    const next = [k, ...history.filter((x) => x !== k)].slice(0, 8);
    setHistory(next);
    await setSetting(HISTORY_KEY, JSON.stringify(next));
  };

  const doSearch = async (kw = search) => {
    if (!kw.trim()) { setSearchResult(null); return; }
    setSearching(true);
    try {
      await pushHistory(kw);
      const res = await client.get(`/novels?search=${encodeURIComponent(kw.trim())}&limit=12`);
      const d = res.data?.data ?? res.data;
      setSearchResult(Array.isArray(d) ? d : []);
    } catch { setSearchResult([]); }
    finally { setSearching(false); }
  };

  const onChangeSearch = (t) => {
    setSearch(t);
    if (debounce.current) clearTimeout(debounce.current);
    if (!t.trim()) { setSearchResult(null); return; }
    debounce.current = setTimeout(() => doSearch(t), 400);
  };

  const clearHistory = async () => { setHistory([]); await setSetting(HISTORY_KEY, '[]'); };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            placeholder="Tìm tên truyện, tác giả..."
            placeholderTextColor="#888"
            value={search}
            onChangeText={onChangeSearch}
            onSubmitEditing={() => doSearch()}
            returnKeyType="search"
          />
          {search ? (
            <TouchableOpacity onPress={() => { setSearch(''); setSearchResult(null); }} style={styles.clearBtn}><Text>✕</Text></TouchableOpacity>
          ) : null}
          <TouchableOpacity onPress={() => doSearch()} style={styles.searchBtn}><Text style={{ color: '#fff', fontWeight: '800' }}>Tìm</Text></TouchableOpacity>
        </View>
        {!searchResult && history.length > 0 && (
          <View style={styles.histRow}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {history.map((h) => (
                <TouchableOpacity key={h} onPress={() => { setSearch(h); doSearch(h); }} style={styles.histChip}>
                  <Text style={styles.histText}>{h}</Text>
                </TouchableOpacity>
              ))}
              <TouchableOpacity onPress={clearHistory}><Text style={styles.histClear}>Xóa</Text></TouchableOpacity>
            </ScrollView>
          </View>
        )}
      </View>

      <ScrollView
        style={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); loadAll(true); }} />}
      >
        {searchResult ? (
          <>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={styles.sectionTitle}>Kết quả "{search}" ({searchResult.length})</Text>
              <TouchableOpacity onPress={() => { setSearch(''); setSearchResult(null); }}><Text style={styles.more}>Xóa ✕</Text></TouchableOpacity>
            </View>
            {searching && <Text style={{ color: '#888' }}>Đang tìm...</Text>}
            <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
              {searchResult.map((item) => (
                <TouchableOpacity key={String(item.id)} onPress={() => navigation.navigate('NovelDetail', { id: item.id })} style={styles.favItem}>
                  <SafeCover uri={item.cover_url} title={item.title} style={styles.favCover} />
                  <Text numberOfLines={2} style={styles.favTitle}>{item.title}</Text>
                  <Text style={styles.favCat}>{item.category_name} • {item.status === 'completed' ? 'Full' : 'Đang ra'}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {searchResult.length === 0 && !searching && (
              <View style={styles.empty}><Text style={{ fontSize: 40 }}>🔍</Text><Text style={styles.emptyT}>Không tìm thấy truyện</Text><Text style={styles.emptyS}>Thử từ khóa khác hoặc vào Kho sách lọc theo thể loại</Text></View>
            )}
          </>
        ) : (
          <>
            <Text style={styles.sectionTitle}>Đề xuất hàng ngày</Text>
            {loading ? <Skeleton h={150} /> : (
              <>
                <ScrollView
                  ref={bannerRef}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  onMomentumScrollEnd={(e) => setBannerIdx(Math.round(e.nativeEvent.contentOffset.x / (width - 32)))}
                >
                  {banner.map((b) => (
                    <TouchableOpacity key={String(b.id)} onPress={() => navigation.navigate('NovelDetail', { id: b.id })} style={styles.bannerCard}>
                      <SafeCover uri={b.cover_url} title={b.title} style={styles.bannerImg} />
                      <View style={styles.bannerInfo}>
                        <Text style={styles.bannerHint}>GỢI Ý • {b.category_name}</Text>
                        <Text style={styles.bannerTitle} numberOfLines={2}>{b.title}</Text>
                        <Text style={styles.bannerSub} numberOfLines={2}>{b.author} • {b.total_views} views • ★ {Number(b.rating || 0).toFixed(1)}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
                <View style={styles.dots}>
                  {banner.map((_, i) => <View key={i} style={[styles.dot, i === bannerIdx && styles.dotActive]} />)}
                </View>
              </>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 8 }]}>Yêu thích</Text>
            {loading ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>{[1, 2, 3, 4].map((i) => <View key={i} style={styles.favItem}><Skeleton h={110} /></View>)}</View>
            ) : (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap' }}>
                {fav.map((item) => (
                  <TouchableOpacity key={String(item.id)} onPress={() => navigation.navigate('NovelDetail', { id: item.id })} style={styles.favItem}>
                    <SafeCover uri={item.cover_url} title={item.title} style={styles.favCover} />
                    <Text numberOfLines={2} style={styles.favTitle}>{item.title}</Text>
                    <Text style={styles.favCat}>{item.category_name}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}

            <Text style={[styles.sectionTitle, { marginTop: 12 }]}>Mới cập nhật</Text>
            {loading ? (
              <Skeleton h={120} />
            ) : (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 10, paddingVertical: 4 }}>
                {fresh.map((item) => (
                  <TouchableOpacity key={String(item.id)} onPress={() => navigation.navigate('NovelDetail', { id: item.id })} style={{ width: 110 }}>
                    <SafeCover uri={item.cover_url} title={item.title} style={{ width: 110, height: 150, borderRadius: 8 }} />
                    <Text numberOfLines={2} style={styles.favTitle}>{item.title}</Text>
                    <Text style={styles.favCat} numberOfLines={1}>{item.category_name}</Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}

            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
              <Text style={styles.sectionTitle}>Bảng xếp hạng</Text>
              <TouchableOpacity onPress={() => navigation.navigate('Kho sách')}><Text style={styles.more}>Kho sách ›</Text></TouchableOpacity>
            </View>
            <View style={styles.rankTabs}>
              {RANK_TABS.map((t) => (
                <TouchableOpacity key={t.key} onPress={() => setRankTab(t.key)} style={[styles.rankTab, rankTab === t.key && styles.rankTabActive]}>
                  <Text style={[styles.rankTabText, rankTab === t.key && styles.rankTabTextActive]}>{t.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            {ranking.map((item, idx) => (
              <TouchableOpacity key={String(item.id)} onPress={() => navigation.navigate('NovelDetail', { id: item.id })} style={styles.rankRow}>
                <Text style={[styles.rankNum, idx < 3 && styles.rankTop]}>{idx + 1}</Text>
                <SafeCover uri={item.cover_url} title={item.title} style={styles.rankCover} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rankTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.rankSub}>{item.category_name} • {item.total_views} views • ★ {Number(item.rating || 0).toFixed(1)}</Text>
                </View>
              </TouchableOpacity>
            ))}
            {ranking.length === 0 && !loading && (
              <View style={styles.empty}><Text style={styles.emptyT}>Chưa có truyện trong {RANK_TABS.find((t) => t.key === rankTab)?.label}</Text><Text style={styles.emptyS}>Đổi tab khác hoặc xem bảng Tổng</Text></View>
            )}
            <View style={{ height: 24 }} />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { paddingTop: 48, padding: 12, alignItems: 'center', backgroundColor: theme.headerBg },
  searchBox: { flexDirection: 'row', width: '100%', backgroundColor: '#F5F5F5', borderRadius: 12, padding: 6, alignItems: 'center', borderWidth: 1, borderColor: theme.border },
  searchInput: { flex: 1, color: theme.text, paddingHorizontal: 10 },
  clearBtn: { paddingHorizontal: 8 },
  searchBtn: { backgroundColor: theme.primary, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  histRow: { width: '100%', marginTop: 8 },
  histChip: { backgroundColor: theme.chip, borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, marginRight: 6, borderWidth: 1, borderColor: theme.border },
  histText: { color: theme.primaryDark, fontSize: 12 },
  histClear: { color: '#888', fontSize: 12, paddingVertical: 5, paddingHorizontal: 6 },
  body: { flex: 1, backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 16, marginTop: 8 },
  sectionTitle: { fontSize: 18, fontWeight: '900', marginBottom: 8 },
  more: { color: '#888', fontWeight: '600' },
  skeleton: { backgroundColor: '#eee', borderRadius: 8, marginBottom: 8 },
  bannerCard: { width: width - 32 - 32, marginRight: 12, flexDirection: 'row', backgroundColor: '#CDE8E5', borderRadius: 16, padding: 12, alignItems: 'center' },
  bannerImg: { width: 70, height: 100, borderRadius: 8, backgroundColor: '#fff' },
  bannerInfo: { flex: 1, marginLeft: 12 },
  bannerHint: { fontSize: 11, color: '#666', fontWeight: '700' },
  bannerTitle: { fontSize: 16, fontWeight: '900', marginTop: 2 },
  bannerSub: { fontSize: 12, color: '#555', marginTop: 4 },
  dots: { flexDirection: 'row', justifyContent: 'center', marginVertical: 8, gap: 6 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#ddd' },
  dotActive: { backgroundColor: '#000', width: 18 },
  favItem: { width: '22%', margin: '1.5%', maxWidth: '25%' },
  favCover: { width: '100%', height: 110, borderRadius: 8, backgroundColor: '#eee' },
  favTitle: { fontWeight: '700', fontSize: 12, marginTop: 4 },
  favCat: { fontSize: 11, color: '#888' },
  rankTabs: { flexDirection: 'row', gap: 8, marginBottom: 8 },
  rankTab: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, backgroundColor: theme.chip },
  rankTabActive: { backgroundColor: theme.primary },
  rankTabText: { color: '#666', fontWeight: '700', fontSize: 12 },
  rankTabTextActive: { color: '#fff' },
  rankRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  rankNum: { width: 28, height: 28, textAlign: 'center', textAlignVertical: 'center', backgroundColor: '#eee', borderRadius: 6, marginRight: 10, fontWeight: '800' },
  rankTop: { backgroundColor: theme.primary, color: '#fff' },
  rankCover: { width: 50, height: 70, borderRadius: 6, marginRight: 10 },
  rankTitle: { fontWeight: '800' },
  rankSub: { color: '#888', fontSize: 12 },
  empty: { alignItems: 'center', padding: 24 },
  emptyT: { fontWeight: '800', fontSize: 15, marginTop: 8 },
  emptyS: { color: '#888', fontSize: 12, marginTop: 4, textAlign: 'center' },
});
