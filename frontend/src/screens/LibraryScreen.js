import { View, Text, StyleSheet, TouchableOpacity, ScrollView, RefreshControl, TextInput } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import client from '../api/client';
import theme from '../theme';
import SafeCover from '../components/SafeCover';

// Phase 3: filter trái nối API thật (sort + status), category lấy từ backend
const SORT_FILTERS = [
  { key: 'ranking', label: 'Phổ biến' },
  { key: 'newest', label: 'Mới nhất' },
  { key: 'rating', label: 'Đánh giá cao' },
  { key: 'views', label: 'Lượt đọc' },
  { key: 'oldest', label: 'Cũ nhất' },
];
const STATUS_FILTERS = [
  { key: '', label: 'Mọi trạng thái' },
  { key: 'ongoing', label: 'Đang ra' },
  { key: 'completed', label: 'Hoàn thành' },
];

export default function LibraryScreen({ navigation }) {
  const [cats, setCats] = useState([{ name: 'Tất cả' }]);
  const [novels, setNovels] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, totalPages: 1, total: 0 });
  const [sort, setSort] = useState('ranking');
  const [status, setStatus] = useState('');
  const [cat, setCat] = useState('Tất cả');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [keyword, setKeyword] = useState('');
  const searchTimer = useRef(null);

  useEffect(() => {
    client.get('/categories').then((r) => {
      const list = Array.isArray(r.data) ? r.data : [];
      setCats([{ name: 'Tất cả' }, ...list]);
    }).catch(() => {});
  }, []);

  const load = async (p = 1, silent = false) => {
    if (!silent) setLoading(true);
    const params = new URLSearchParams({ sort, page: p, limit: 6 });
    if (cat && cat !== 'Tất cả') params.append('category', cat);
    if (status) params.append('status', status);
    if (keyword.trim()) params.append('search', keyword.trim());
    try {
      const res = await client.get(`/novels?${params.toString()}`);
      const d = res.data?.data ?? res.data;
      const pag = res.data?.pagination || { page: p, totalPages: 1, total: (d || []).length };
      setNovels(Array.isArray(d) ? d : []);
      setPagination(pag);
      setPage(p);
    } catch { setNovels([]); }
    finally { setLoading(false); setRefreshing(false); }
  };

  useEffect(() => { load(1); }, [cat, sort, status]);

  const onKeyword = (t) => {
    setKeyword(t);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => load(1, true), 400);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Kho sách ({pagination.total} truyện)</Text>
        <View style={styles.searchBox}>
          <TextInput
            style={styles.searchInput}
            placeholder="Tìm trong kho sách..."
            placeholderTextColor="#999"
            value={keyword}
            onChangeText={onKeyword}
            returnKeyType="search"
            onSubmitEditing={() => load(1)}
          />
          {keyword ? (
            <TouchableOpacity onPress={() => { setKeyword(''); setTimeout(() => load(1, true), 0); }}><Text style={{ paddingHorizontal: 6 }}>✕</Text></TouchableOpacity>
          ) : null}
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 8 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
          {cats.map((c) => (
            <TouchableOpacity key={c.name} onPress={() => setCat(c.name)} style={[styles.catChip, cat === c.name && styles.catActive]}>
              <Text style={[styles.catText, cat === c.name && styles.catTextActive]}>{c.name}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 6 }} contentContainerStyle={{ gap: 6, paddingHorizontal: 4 }}>
          {STATUS_FILTERS.map((s) => (
            <TouchableOpacity key={s.key} onPress={() => setStatus(s.key)} style={[styles.statusChip, status === s.key && styles.statusActive]}>
              <Text style={[styles.statusText, status === s.key && { color: '#fff' }]}>{s.label}</Text>
            </TouchableOpacity>
          ))}
        </ScrollView>
      </View>
      <View style={styles.body}>
        <View style={styles.leftBar}>
          <ScrollView>
            {SORT_FILTERS.map((f) => (
              <TouchableOpacity key={f.key} onPress={() => setSort(f.key)} style={[styles.filterItem, sort === f.key && styles.filterActive]}>
                <Text style={[styles.filterText, sort === f.key && styles.filterTextActive]}>{f.label}</Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>
        <View style={styles.rightList}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', padding: 12, alignItems: 'center' }}>
            <Text style={{ fontWeight: '900', fontSize: 14 }} numberOfLines={1}>
              {SORT_FILTERS.find((f) => f.key === sort)?.label}{cat !== 'Tất cả' ? ` • ${cat}` : ''}{status ? ` • ${status === 'completed' ? 'Full' : 'Đang ra'}` : ''}
            </Text>
            <Text style={{ color: '#999', fontSize: 12 }}>{pagination.page}/{pagination.totalPages}</Text>
          </View>
          <ScrollView
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(page, true); }} />}
          >
            {loading ? (
              [1, 2, 3, 4].map((i) => (
                <View key={i} style={styles.row}><View style={styles.skelRank} /><View style={styles.skelCover} /><View style={{ flex: 1 }}><View style={styles.skelLine} /><View style={[styles.skelLine, { width: '60%' }]} /></View></View>
              ))
            ) : novels.length === 0 ? (
              <View style={styles.empty}>
                <Text style={{ fontSize: 44 }}>📚</Text>
                <Text style={{ fontWeight: '800', marginTop: 8 }}>Không có truyện phù hợp</Text>
                <Text style={{ color: '#888', fontSize: 12, marginTop: 4 }}>Đổi thể loại / trạng thái khác</Text>
              </View>
            ) : novels.map((item, index) => (
              <TouchableOpacity key={String(item.id)} onPress={() => navigation.navigate('NovelDetail', { id: item.id })} style={styles.row}>
                <Text style={[styles.rank, index < 3 && page === 1 && styles.rankTop]}>{(page - 1) * 6 + index + 1}</Text>
                <SafeCover uri={item.cover_url} title={item.title} style={styles.cover} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.title} numberOfLines={1}>{item.title} {item.status === 'completed' ? '✓' : ''}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{item.author} • {item.category_name}</Text>
                  <Text style={styles.sub} numberOfLines={1}>{item.total_views} views • ★ {Number(item.rating || 0).toFixed(1)}</Text>
                </View>
              </TouchableOpacity>
            ))}
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12 }}>
              <TouchableOpacity disabled={page <= 1} onPress={() => load(page - 1)} style={[styles.pageBtn, page <= 1 && { opacity: 0.4 }]}><Text>‹ Trước</Text></TouchableOpacity>
              <Text style={{ color: '#888', fontSize: 12 }}>Trang {pagination.page}/{pagination.totalPages}</Text>
              <TouchableOpacity disabled={page >= pagination.totalPages} onPress={() => load(page + 1)} style={[styles.pageBtn, page >= pagination.totalPages && { opacity: 0.4 }]}><Text>Tiếp ›</Text></TouchableOpacity>
            </View>
          </ScrollView>
        </View>
      </View>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { paddingTop: 42, padding: 10, alignItems: 'center', backgroundColor: theme.headerBg },
  headerTitle: { color: theme.primaryDark, fontWeight: '800', fontSize: 13, borderBottomWidth: 2, borderBottomColor: theme.primary, paddingBottom: 6, textAlign: 'center' },
  catChip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, backgroundColor: '#F5F5F5', borderWidth: 1, borderColor: theme.border },
  catActive: { backgroundColor: theme.primary, borderColor: theme.primary },
  catText: { color: '#666', fontSize: 11, fontWeight: '700' },
  catTextActive: { color: '#fff' },
  statusChip: { paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: 'transparent', borderWidth: 1, borderColor: theme.border },
  statusActive: { backgroundColor: theme.text, borderColor: theme.text },
  statusText: { color: '#888', fontSize: 11, fontWeight: '700' },
  searchBox: { flexDirection: 'row', alignItems: 'center', width: '100%', backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 10, marginTop: 8, borderWidth: 1, borderColor: theme.border },
  searchInput: { flex: 1, paddingVertical: 8, color: theme.text },
  body: { flex: 1, flexDirection: 'row', backgroundColor: '#fff', borderTopLeftRadius: 20, borderTopRightRadius: 20, overflow: 'hidden' },
  leftBar: { width: 110, backgroundColor: theme.chip, paddingVertical: 12 },
  filterItem: { paddingVertical: 12, alignItems: 'center', borderRadius: 10, margin: 4 },
  filterActive: { backgroundColor: theme.primary },
  filterText: { color: '#888', fontWeight: '700', fontSize: 12 },
  filterTextActive: { color: '#fff' },
  rightList: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  rank: { width: 28, height: 28, textAlign: 'center', textAlignVertical: 'center', backgroundColor: '#eee', borderRadius: 6, marginRight: 8, fontWeight: '800' },
  rankTop: { backgroundColor: theme.primary, color: '#fff' },
  cover: { width: 56, height: 76, borderRadius: 6, marginRight: 10, backgroundColor: '#eee' },
  title: { fontWeight: '800' },
  sub: { color: '#888', fontSize: 12, marginTop: 2 },
  pageBtn: { paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#eee', borderRadius: 8 },
  skelRank: { width: 28, height: 28, borderRadius: 6, backgroundColor: '#eee', marginRight: 8 },
  skelCover: { width: 56, height: 76, borderRadius: 6, backgroundColor: '#eee', marginRight: 10 },
  skelLine: { height: 12, backgroundColor: '#eee', borderRadius: 6, marginTop: 6 },
  empty: { alignItems: 'center', padding: 30 },
});
