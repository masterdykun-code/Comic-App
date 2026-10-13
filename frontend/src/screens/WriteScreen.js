import { View, Text, StyleSheet, TextInput, TouchableOpacity, Image, ScrollView, Alert, RefreshControl, Modal, FlatList } from 'react-native';
import { useEffect, useState, useCallback } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import SafeCover from '../components/SafeCover';

const STATUS = [
  { k: 'ongoing', label: 'Đang ra' },
  { k: 'completed', label: 'Hoàn thành' },
  { k: 'paused', label: 'Tạm dừng' },
  { k: 'draft', label: 'Nháp' },
];

export default function WriteScreen({ navigation }) {
  const { isLoggedIn } = useAuth();
  const [tab, setTab] = useState('my');
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [description, setDescription] = useState('');
  const [category_id, setCategoryId] = useState('1');
  const [status, setStatus] = useState('ongoing');
  const [categories, setCategories] = useState([]);
  const [cover, setCover] = useState(null);
  const [loading, setLoading] = useState(false);
  const [myNovels, setMyNovels] = useState([]);
  const [stats, setStats] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  // chapter
  const [selectedNovel, setSelectedNovel] = useState(null);
  const [chapList, setChapList] = useState([]);
  const [chapTitle, setChapTitle] = useState('');
  const [chapContent, setChapContent] = useState('');
  const [chapLocked, setChapLocked] = useState(false);
  const [chapPrice, setChapPrice] = useState('0');
  const [editingChap, setEditingChap] = useState(null);
  const [chapLoading, setChapLoading] = useState(false);
  // edit novel modal
  const [editNovel, setEditNovel] = useState(null);
  const [editForm, setEditForm] = useState({});

  useEffect(() => {
    client.get('/categories').then((r) => {
      const list = Array.isArray(r.data) ? r.data : [];
      setCategories(list);
      if (list.length > 0 && !list.some((c) => String(c.id) === String(category_id))) {
        setCategoryId(String(list[0].id));
      }
    }).catch(() => setCategories([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadMy = useCallback(async (silent = false) => {
    if (!isLoggedIn) return;
    if (!silent) setRefreshing(true);
    try {
      const [m, s] = await Promise.all([
        client.get('/novels/mine/list'),
        client.get('/novels/mine/stats').catch(() => ({ data: null })),
      ]);
      setMyNovels(Array.isArray(m.data) ? m.data : []);
      setStats(s.data);
    } catch {}
    finally { setRefreshing(false); }
  }, [isLoggedIn]);
  useEffect(() => { loadMy(true); }, [loadMy]);
  useFocusEffect(useCallback(() => { loadMy(true); }, [loadMy]));

  const loadChapters = async (novelId) => {
    try {
      const r = await client.get(`/novels/${novelId}/chapters`);
      setChapList(Array.isArray(r.data) ? r.data : []);
    } catch { setChapList([]); }
  };
  useEffect(() => { if (selectedNovel) loadChapters(selectedNovel); }, [selectedNovel]);

  const pickImage = async () => {
    try {
      const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) return Alert.alert('Cần quyền ảnh', 'Cho phép truy cập ảnh để chọn bìa truyện.');
      const res = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      if (!res.canceled) setCover(res.assets[0]);
    } catch (e) { Alert.alert('Lỗi', 'Không mở được thư viện ảnh'); }
  };

  const submitNovel = async () => {
    if (!title || !author) return Alert.alert('Thiếu tiêu đề/tác giả');
    setLoading(true);
    try {
      const form = new FormData();
      form.append('title', title);
      form.append('author', author);
      form.append('description', description);
      form.append('category_id', category_id);
      form.append('status', status);
      if (cover) form.append('cover', { uri: cover.uri, name: 'cover.jpg', type: 'image/jpeg' });
      // Không set Content-Type thủ công để axios tự sinh boundary
      const res = await client.post('/novels', form);
      Alert.alert('Thành công', `Đã tạo truyện ID ${res.data.id}`);
      setTitle(''); setAuthor(''); setDescription(''); setCover(null); setStatus('ongoing');
      loadMy(true); setTab('my');
    } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
    setLoading(false);
  };

  const openEditNovel = (n) => {
    setEditNovel(n);
    setEditForm({ title: n.title, author: n.author, description: n.description || '', status: n.status || 'ongoing', category_id: n.category_id ? String(n.category_id) : '' });
  };

  const saveEditNovel = async () => {
    try {
      await client.put(`/novels/${editNovel.id}`, editForm);
      Alert.alert('Đã lưu');
      setEditNovel(null);
      loadMy(true);
    } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
  };

  const delNovel = (n) => {
    Alert.alert('Xóa truyện?', `"${n.title}" + toàn bộ chương sẽ mất.`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa', style: 'destructive', onPress: async () => {
          try { await client.delete(`/novels/${n.id}`); Alert.alert('Đã xóa'); loadMy(true); }
          catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
        },
      },
    ]);
  };

  const submitChapter = async () => {
    if (!selectedNovel) return Alert.alert('Chưa chọn truyện', 'Bấm nút “+ Chương” ở truyện trong tab Của tôi.');
    if (!chapTitle.trim() || !chapContent.trim()) return Alert.alert('Thiếu tiêu đề/nội dung chương');
    if (chapLoading) return;
    if (chapContent.trim().length < 100) return Alert.alert('Nội dung quá ngắn', 'Viết ít nhất 100 ký tự để đăng chương.');
    setLoading(true);
    try {
      const payload = {
        title: chapTitle, content: chapContent,
        is_locked: chapLocked, price_coins: parseInt(chapPrice) || 0,
      };
      if (editingChap) {
        await client.put(`/novels/${selectedNovel}/chapters/${editingChap.chapter_number}`, payload);
        Alert.alert('Đã cập nhật chương');
      } else {
        await client.post(`/novels/${selectedNovel}/chapters`, payload);
        Alert.alert('Đã thêm chương');
      }
      setChapTitle(''); setChapContent(''); setChapLocked(false); setChapPrice('0'); setEditingChap(null);
      loadChapters(selectedNovel); loadMy(true);
    } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
    setLoading(false);
  };

  const editChap = (c) => {
    setEditingChap(c);
    setChapTitle(c.title);
    setChapPrice(String(c.price_coins || 0));
    setChapLocked(!!c.is_locked);
    // load full content — khóa nút Lưu cho tới khi tải xong để không ghi đè rỗng
    setChapContent('');
    setChapLoading(true);
    client.get(`/novels/${selectedNovel}/chapters/${c.chapter_number}`)
      .then((r) => setChapContent(r.data.content || ''))
      .catch(() => Alert.alert('Lỗi', 'Không tải được nội dung chương'))
      .finally(() => setChapLoading(false));
  };

  const delChap = (c) => {
    Alert.alert('Xóa chương?', c.title, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa', style: 'destructive', onPress: async () => {
          try { await client.delete(`/novels/${selectedNovel}/chapters/${c.chapter_number}`); loadChapters(selectedNovel); }
          catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
        },
      },
    ]);
  };

  if (!isLoggedIn) {
    return <View style={styles.c}><Text style={styles.t}>Viết truyện</Text><Text style={styles.sub}>Đăng nhập để đăng truyện & quản lý</Text><TouchableOpacity style={styles.submitBtn} onPress={() => navigation.navigate('Login')}><Text style={{ color: '#fff', fontWeight: '900' }}>Đăng nhập</Text></TouchableOpacity></View>;
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: '#fff' }}
      contentContainerStyle={{ padding: 16, paddingBottom: 30 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => loadMy()} />}
    >
      <Text style={styles.t}>Nhà văn</Text>
      {stats && (
        <View style={styles.statsRow}>
          {[
            ['Truyện', stats.total_novels],
            ['Chương', stats.total_chapters],
            ['Views', stats.total_views],
            ['Votes', stats.total_votes],
            ['Ratings', stats.total_ratings],
          ].map(([l, v]) => (
            <View key={l} style={styles.statBox}><Text style={styles.statNum}>{v}</Text><Text style={styles.statLabel}>{l}</Text></View>
          ))}
        </View>
      )}
      <View style={styles.tabs}>
        {[
          { k: 'my', label: `Của tôi (${myNovels.length})` },
          { k: 'create', label: 'Tạo truyện' },
          { k: 'chapter', label: 'Chương' },
        ].map((t) => (
          <TouchableOpacity key={t.k} onPress={() => setTab(t.k)} style={[styles.tab, tab === t.k && styles.tabActive]}>
            <Text style={[styles.tabText, tab === t.k && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      {tab === 'my' && (
        <View>
          {myNovels.length === 0
            ? <Text style={{ color: '#888', marginTop: 12 }}>Chưa có truyện nào. Tạo ở tab "Tạo truyện".</Text>
            : myNovels.map((n) => (
              <View key={String(n.id)} style={styles.myCard}>
                <SafeCover uri={n.cover_url} title={n.title} style={{ width: 60, height: 80, borderRadius: 8 }} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={{ fontWeight: '800' }}>{n.title}</Text>
                  <Text style={{ color: '#888', fontSize: 12 }}>
                    #{n.id} • {n.category_name} • {(STATUS.find((s) => s.k === n.status) || {}).label || n.status} • {n.chapter_count ?? '?'} chương • {n.total_views} lượt đọc • 🔥{n.power_votes || 0} đề cử
                  </Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
                    <TouchableOpacity onPress={() => { setSelectedNovel(String(n.id)); setTab('chapter'); }} style={styles.smallBtn}><Text style={{ fontSize: 12, fontWeight: '700' }}>+ Chương</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => navigation.navigate('NovelDetail', { id: n.id })} style={[styles.smallBtn, { backgroundColor: '#eee' }]}><Text style={{ fontSize: 12 }}>Xem</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => openEditNovel(n)} style={[styles.smallBtn, { backgroundColor: '#E3F2FD' }]}><Text style={{ fontSize: 12 }}>Sửa</Text></TouchableOpacity>
                    <TouchableOpacity onPress={() => delNovel(n)} style={[styles.smallBtn, { backgroundColor: '#FFEBEE' }]}><Text style={{ fontSize: 12, color: '#c00' }}>Xóa</Text></TouchableOpacity>
                  </View>
                </View>
              </View>
            ))}
        </View>
      )}

      {tab === 'create' && (
        <View>
          <Text style={styles.label}>Tiêu đề *</Text>
          <TextInput style={styles.input} value={title} onChangeText={setTitle} placeholder="VD: Quỷ Xá 2" />
          <Text style={styles.label}>Tác giả *</Text>
          <TextInput style={styles.input} value={author} onChangeText={setAuthor} placeholder="Tên tác giả" />
          <Text style={styles.label}>Mô tả</Text>
          <TextInput style={[styles.input, { height: 80, textAlignVertical: 'top' }]} value={description} onChangeText={setDescription} placeholder="Mô tả truyện" multiline />
          <Text style={styles.label}>Thể loại</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {categories.map((c) => (
              <TouchableOpacity key={c.id} onPress={() => setCategoryId(String(c.id))} style={[styles.catChip, String(category_id) === String(c.id) && styles.catActive]}>
                <Text style={[styles.catText, String(category_id) === String(c.id) && { color: '#fff' }]}>{c.name}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <Text style={styles.label}>Trạng thái</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {STATUS.map((s) => (
              <TouchableOpacity key={s.k} onPress={() => setStatus(s.k)} style={[styles.catChip, status === s.k && styles.catActive]}>
                <Text style={[styles.catText, status === s.k && { color: '#fff' }]}>{s.label}</Text>
              </TouchableOpacity>
            ))}
          </View>
          <TouchableOpacity style={styles.pickBtn} onPress={pickImage}><Text style={{ fontWeight: '700' }}>{cover ? 'Đã chọn ảnh ✓' : 'Chọn ảnh bìa'}</Text></TouchableOpacity>
          {cover && <Image source={{ uri: cover.uri }} style={{ width: '100%', height: 200, borderRadius: 10, marginTop: 10, backgroundColor: '#eee' }} />}
          <TouchableOpacity style={[styles.submitBtn, loading && { opacity: 0.6 }]} onPress={submitNovel} disabled={loading}><Text style={{ color: '#fff', fontWeight: '900' }}>{loading ? 'Đang đăng...' : 'Đăng truyện'}</Text></TouchableOpacity>
        </View>
      )}

      {tab === 'chapter' && (
        <View>
          <Text style={styles.label}>Truyện *</Text>
          {myNovels.length === 0 ? (
            <Text style={{ color: '#888' }}>Chưa có truyện nào — tạo ở tab “Tạo truyện” trước.</Text>
          ) : (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {myNovels.map((n) => (
                <TouchableOpacity
                  key={String(n.id)}
                  onPress={() => { setSelectedNovel(String(n.id)); setEditingChap(null); setChapTitle(''); setChapContent(''); }}
                  style={[styles.catChip, String(selectedNovel) === String(n.id) && styles.catActive]}
                >
                  <Text style={[styles.catText, String(selectedNovel) === String(n.id) && { color: '#fff' }]} numberOfLines={1}>
                    {n.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
          {selectedNovel ? (
            <>
              <Text style={[styles.label, { marginTop: 12 }]}>Danh sách chương ({chapList.length}){!editingChap && chapList.length >= 0 ? ` — chương mới sẽ là C${(chapList.reduce((m, c) => Math.max(m, Number(c.chapter_number) || 0), 0)) + 1}` : ''} — bấm để sửa/xóa</Text>
              {chapList.map((c) => (
                <View key={c.id} style={styles.chapRow}>
                  <Text style={{ flex: 1, fontSize: 13 }} numberOfLines={1}>{c.is_locked ? '🔒 ' : ''}C{c.chapter_number}: {c.title}</Text>
                  <TouchableOpacity onPress={() => editChap(c)}><Text style={{ color: '#1976D2', fontSize: 12, fontWeight: '700' }}>Sửa</Text></TouchableOpacity>
                  <TouchableOpacity onPress={() => delChap(c)} style={{ marginLeft: 10 }}><Text style={{ color: '#c00', fontSize: 12 }}>Xóa</Text></TouchableOpacity>
                </View>
              ))}
            </>
          ) : null}
          <Text style={styles.label}>{editingChap ? `Sửa chương ${editingChap.chapter_number}` : 'Tiêu đề chương mới *'}</Text>
          <TextInput style={styles.input} value={chapTitle} onChangeText={setChapTitle} placeholder="VD: Chương 6: Gặp gỡ" />
          <Text style={styles.label}>Nội dung * ({chapContent.trim().split(/\s+/).filter(Boolean).length} từ)</Text>
          <TextInput style={[styles.input, { height: 160, textAlignVertical: 'top' }]} value={chapContent} onChangeText={setChapContent} placeholder="Nội dung chương (tối thiểu 100 ký tự)..." multiline />
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <TouchableOpacity onPress={() => setChapLocked(!chapLocked)} style={[styles.catChip, chapLocked && styles.catActive]}>
              <Text style={[styles.catText, chapLocked && { color: '#fff' }]}>{chapLocked ? '🔒 Khóa (VIP)' : 'Miễn phí'}</Text>
            </TouchableOpacity>
            {chapLocked && (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Text style={{ fontWeight: '700' }}>Giá:</Text>
                <TextInput style={[styles.input, { width: 80 }]} value={chapPrice} onChangeText={setChapPrice} keyboardType="numeric" />
                <Text>coins</Text>
                <TouchableOpacity
                  onPress={() => {
                    const words = chapContent.trim().split(/\s+/).filter(Boolean).length;
                    setChapPrice(String(Math.max(5, Math.ceil(words / 1000) * 5)));
                  }}
                >
                  <Text style={{ color: '#1976D2', fontWeight: '700', fontSize: 12 }}>Gợi ý giá</Text>
                </TouchableOpacity>
              </View>
            )}
          </View>
          <Text style={{ color: '#888', fontSize: 11, marginTop: 6 }}>Mẹo kiểu WebNovel: để 10–20 chương đầu miễn phí, chương VIP tính ~5 coins/1000 từ.</Text>
          {chapLoading && <Text style={{ color: '#1976D2', marginTop: 6 }}>Đang tải nội dung chương...</Text>}
          <TouchableOpacity style={[styles.submitBtn, (loading || chapLoading) && { opacity: 0.6 }]} onPress={submitChapter} disabled={loading || chapLoading}>
            <Text style={{ color: '#fff', fontWeight: '900' }}>{editingChap ? 'Lưu chương' : 'Thêm chương'}</Text>
          </TouchableOpacity>
          {editingChap && (
            <TouchableOpacity onPress={() => { setEditingChap(null); setChapTitle(''); setChapContent(''); }} style={{ marginTop: 10, alignItems: 'center' }}>
              <Text style={{ color: '#888' }}>Hủy sửa</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      <Modal visible={!!editNovel} animationType="slide" transparent onRequestClose={() => setEditNovel(null)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalBox}>
            <Text style={{ fontWeight: '900', fontSize: 16 }}>Sửa truyện #{editNovel?.id}</Text>
            <Text style={styles.label}>Tiêu đề</Text>
            <TextInput style={styles.input} value={editForm.title || ''} onChangeText={(t) => setEditForm({ ...editForm, title: t })} />
            <Text style={styles.label}>Tác giả</Text>
            <TextInput style={styles.input} value={editForm.author || ''} onChangeText={(t) => setEditForm({ ...editForm, author: t })} />
            <Text style={styles.label}>Mô tả</Text>
            <TextInput style={[styles.input, { height: 80 }]} value={editForm.description || ''} onChangeText={(t) => setEditForm({ ...editForm, description: t })} multiline />
            <Text style={styles.label}>Thể loại</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {categories.map((c) => (
                <TouchableOpacity key={c.id} onPress={() => setEditForm({ ...editForm, category_id: String(c.id) })} style={[styles.catChip, String(editForm.category_id) === String(c.id) && styles.catActive]}>
                  <Text style={[styles.catText, String(editForm.category_id) === String(c.id) && { color: '#fff' }]}>{c.name}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <Text style={styles.label}>Trạng thái</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
              {STATUS.map((s) => (
                <TouchableOpacity key={s.k} onPress={() => setEditForm({ ...editForm, status: s.k })} style={[styles.catChip, editForm.status === s.k && styles.catActive]}>
                  <Text style={[styles.catText, editForm.status === s.k && { color: '#fff' }]}>{s.label}</Text>
                </TouchableOpacity>
              ))}
            </View>
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
              <TouchableOpacity onPress={() => setEditNovel(null)} style={[styles.submitBtn, { flex: 1, backgroundColor: '#eee' }]}><Text style={{ fontWeight: '800' }}>Hủy</Text></TouchableOpacity>
              <TouchableOpacity onPress={saveEditNovel} style={[styles.submitBtn, { flex: 1 }]}><Text style={{ color: '#fff', fontWeight: '900' }}>Lưu</Text></TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}
const styles = StyleSheet.create({
  c: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: '#fff' },
  t: { fontSize: 20, fontWeight: '900', textAlign: 'center' },
  sub: { color: '#888', textAlign: 'center', marginTop: 6, fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 6, marginTop: 12 },
  statBox: { flex: 1, backgroundColor: '#f5f5f5', borderRadius: 10, padding: 8, alignItems: 'center' },
  statNum: { fontWeight: '900', fontSize: 15 },
  statLabel: { color: '#888', fontSize: 10 },
  tabs: { flexDirection: 'row', gap: 8, marginVertical: 14 },
  tab: { flex: 1, paddingVertical: 10, borderRadius: 20, backgroundColor: '#f0f0f0', alignItems: 'center' },
  tabActive: { backgroundColor: '#000' },
  tabText: { fontWeight: '700', color: '#666', fontSize: 12 },
  tabTextActive: { color: '#fff' },
  label: { fontWeight: '700', marginTop: 12, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 12 },
  catChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 16, backgroundColor: '#eee' },
  catActive: { backgroundColor: '#000' },
  catText: { fontWeight: '700', fontSize: 12, color: '#555' },
  pickBtn: { backgroundColor: '#e0f7fa', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: '#b2ebf2' },
  submitBtn: { backgroundColor: '#FF6A00', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 16 },
  myCard: { flexDirection: 'row', padding: 10, borderWidth: 1, borderColor: '#eee', borderRadius: 10, marginTop: 10 },
  smallBtn: { backgroundColor: '#C8FF5A', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 8 },
  chapRow: { flexDirection: 'row', alignItems: 'center', padding: 10, borderBottomWidth: 1, borderBottomColor: '#eee' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16, maxHeight: '90%' },
});
