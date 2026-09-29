import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, RefreshControl, Modal, TextInput } from 'react-native';
import { useCallback, useState } from 'react';
import { useFocusEffect } from '@react-navigation/native';
import { useAuth } from '../context/AuthContext';
import client from '../api/client';
import theme from '../theme';

const RECHARGE_PACKS = [100, 500, 1000];
const WEEK = ['N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7'];

export default function AccountScreen({ navigation }) {
  const { user, logout, isLoggedIn, isAdmin } = useAuth();
  const [wallet, setWallet] = useState(null);
  const [missions, setMissions] = useState([]);
  const [txs, setTxs] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [adminStats, setAdminStats] = useState(null);
  const [adminNovels, setAdminNovels] = useState([]);
  const [adminUsers, setAdminUsers] = useState([]);
  const [adminReports, setAdminReports] = useState([]);

  const load = useCallback(async () => {
    if (!isLoggedIn) return;
    try {
      const [w, m, t] = await Promise.all([
        client.get('/wallet/me'),
        client.get('/wallet/missions'),
        client.get('/wallet/transactions'),
      ]);
      setWallet(w.data);
      setMissions(Array.isArray(m.data) ? m.data : []);
      setTxs(Array.isArray(t.data) ? t.data : []);
    } catch {}
  }, [isLoggedIn]);

  const loadAdmin = useCallback(async () => {
    if (!isAdmin) return;
    try {
      const [s, n, u, rp] = await Promise.all([
        client.get('/admin/stats'),
        client.get('/admin/novels'),
        client.get('/admin/users'),
        client.get('/admin/reports').catch(() => ({ data: [] })),
      ]);
      setAdminStats(s.data);
      setAdminNovels(Array.isArray(n.data) ? n.data : []);
      setAdminUsers(Array.isArray(u.data) ? u.data : []);
      setAdminReports(Array.isArray(rp.data) ? rp.data : []);
    } catch (e) {
      // token cũ chưa có role -> báo login lại
      if (e.response?.status === 403) Alert.alert('Token cũ', 'Đăng xuất rồi đăng nhập lại để nhận quyền admin.');
    }
  }, [isAdmin]);

  useFocusEffect(useCallback(() => { load(); loadAdmin(); }, [load, loadAdmin]));

  const onRefresh = async () => { setRefreshing(true); await load(); await loadAdmin(); setRefreshing(false); };

  const checkin = async () => {
    try {
      const r = await client.post('/wallet/checkin');
      Alert.alert('Điểm danh thành công', `+${r.data.reward} coins (chuỗi ${r.data.streak} ngày)`);
      load();
    } catch (e) { Alert.alert('Không điểm danh được', e.response?.data?.message || e.message); }
  };

  const claim = async (mid) => {
    try {
      const r = await client.post('/wallet/missions/claim', { mission_id: mid });
      Alert.alert('Nhận thưởng', `+${r.data.reward} coins`);
      load();
    } catch (e) { Alert.alert('Chưa nhận được', e.response?.data?.message || e.message); }
  };

  const recharge = (amount) => {
    Alert.alert(`Nạp demo +${amount} coins?`, 'Bản đồ án, không thanh toán thật.', [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Nạp', onPress: async () => {
          try { await client.post('/wallet/recharge', { amount }); Alert.alert('Đã nạp'); load(); }
          catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
        },
      },
    ]);
  };

  const coins = wallet?.coins ?? user?.coins ?? 0;
  const [showEdit, setShowEdit] = useState(false);
  const [newName, setNewName] = useState('');
  const [oldPw, setOldPw] = useState('');
  const [newPw, setNewPw] = useState('');

  const saveProfile = async () => {
    if (!newName.trim()) return Alert.alert('Nhập username mới');
    try {
      await client.put('/auth/me', { username: newName.trim() });
      Alert.alert('Đã lưu profile');
      setShowEdit(false); setNewName('');
      load();
    } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
  };

  const changePw = async () => {
    try {
      await client.put('/auth/password', { old_password: oldPw, new_password: newPw });
      Alert.alert('Đã đổi mật khẩu');
      setOldPw(''); setNewPw('');
    } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.avatar}><Text style={{ fontSize: 30 }}>{isLoggedIn ? '😎' : '🙂'}</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={styles.loginText}>{isLoggedIn ? (wallet?.username || user.username) : 'Đăng nhập'}</Text>
          {isLoggedIn && <Text style={{ color: '#666' }}>{wallet?.email || user.email} • {coins} coins</Text>}
        </View>
        {isLoggedIn && (
          <View style={{ gap: 6 }}>
            <TouchableOpacity style={styles.editBtn} onPress={() => { setNewName(wallet?.username || user.username); setShowEdit(true); }}>
              <Text style={{ fontWeight: '800', fontSize: 12 }}>Sửa</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.logoutBtn} onPress={async () => { await logout(); setWallet(null); Alert.alert('Đã đăng xuất'); }}>
              <Text style={{ fontWeight: '800', color: '#fff', fontSize: 12 }}>Đăng xuất</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
      <ScrollView
        style={styles.body}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {!isLoggedIn ? (
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <TouchableOpacity style={[styles.napBtn, { flex: 1, alignItems: 'center' }]} onPress={() => navigation.navigate('Login')}>
              <Text style={{ fontWeight: '800' }}>Đăng nhập</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.napBtn, { flex: 1, alignItems: 'center', backgroundColor: '#000' }]} onPress={() => navigation.navigate('Register')}>
              <Text style={{ fontWeight: '800', color: '#fff' }}>Đăng ký</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            <View style={styles.card}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: '#9BC53D', fontWeight: '800' }}>● Số dư Coins: {coins}</Text>
                <Text style={{ color: '#888', fontSize: 12 }}>Đề cử hôm nay: {wallet?.votes_today ?? 0}</Text>
              </View>
              <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
                {RECHARGE_PACKS.map((p) => (
                  <TouchableOpacity key={p} onPress={() => recharge(p)} style={styles.packBtn}>
                    <Text style={{ fontWeight: '800' }}>+{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Điểm danh hàng ngày (chuỗi {wallet?.streak || 0} ngày)</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginTop: 10 }}>
                {WEEK.map((d, i) => {
                  const dayNum = i + 1;
                  const done = (wallet?.streak || 0) >= dayNum;
                  const isToday = !wallet?.checked_today && (wallet?.streak || 0) + 1 === dayNum;
                  return (
                    <View key={d} style={[styles.dayBox, done && styles.dayDone, isToday && styles.dayToday]}>
                      <Text style={[styles.dayText, done && { color: '#fff' }]}>{d}</Text>
                      <Text style={[styles.daySub, done && { color: '#fff' }]}>+{10 + Math.min(dayNum - 1, 6) * 2}</Text>
                    </View>
                  );
                })}
              </View>
              <TouchableOpacity
                onPress={checkin}
                disabled={!!wallet?.checked_today}
                style={[styles.checkinBtn, wallet?.checked_today && { opacity: 0.5 }]}
              >
                <Text style={{ fontWeight: '800', color: '#fff' }}>
                  {wallet?.checked_today ? '✓ Đã điểm danh hôm nay' : 'Điểm danh nhận coins'}
                </Text>
              </TouchableOpacity>
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Nhiệm vụ hàng ngày</Text>
              {missions.map((m) => (
                <View key={m.id} style={styles.missionRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700' }}>{m.title}</Text>
                    <Text style={{ color: '#888', fontSize: 12 }}>+{m.reward} coins {m.completed ? '• đã xong' : '• chưa xong'}</Text>
                  </View>
                  <TouchableOpacity
                    onPress={() => claim(m.id)}
                    disabled={!m.completed || m.claimed}
                    style={[styles.claimBtn, (!m.completed || m.claimed) && { opacity: 0.4 }]}
                  >
                    <Text style={{ fontWeight: '800', color: '#fff', fontSize: 12 }}>
                      {m.claimed ? 'Đã nhận' : 'Nhận'}
                    </Text>
                  </TouchableOpacity>
                </View>
              ))}
              {missions.length === 0 && <Text style={{ color: '#999' }}>Kéo xuống để tải nhiệm vụ</Text>}
            </View>

            <View style={styles.card}>
              <Text style={styles.cardTitle}>Lịch sử coins (20 gần nhất)</Text>
              {txs.map((t) => (
                <View key={t.id} style={styles.txRow}>
                  <Text style={{ flex: 1, fontSize: 13 }} numberOfLines={1}>{t.reason || t.type}</Text>
                  <Text style={{ fontWeight: '800', color: t.amount >= 0 ? '#00A86B' : '#c00' }}>
                    {t.amount >= 0 ? `+${t.amount}` : t.amount}
                  </Text>
                </View>
              ))}
              {txs.length === 0 && <Text style={{ color: '#999' }}>Chưa có giao dịch</Text>}
            </View>
          </>
        )}

        <TouchableOpacity style={styles.writerCard} onPress={() => navigation.navigate('Viết')}>
          <Text style={{ fontWeight: '800' }}>✒️ Là một nhà văn (đăng truyện)</Text><Text>›</Text>
        </TouchableOpacity>
        {isAdmin && (
          <View style={[styles.card, { borderColor: '#c00', borderWidth: 1.5 }]}>
            <Text style={[styles.cardTitle, { color: '#c00' }]}>🛡 Quản trị (admin)</Text>
            {adminStats && (
              <Text style={{ color: '#666', fontSize: 12, marginTop: 6 }}>
                {adminStats.users} users • {adminStats.novels} truyện • {adminStats.chapters} chương • {adminStats.comments} bình luận • {adminStats.total_views} views
              </Text>
            )}
            <Text style={[styles.cardTitle, { fontSize: 13, marginTop: 12 }]}>Truyện mới nhất (xóa mọi truyện)</Text>
            {(adminNovels || []).slice(0, 8).map((n) => (
              <View key={n.id} style={styles.txRow}>
                <Text style={{ flex: 1, fontSize: 12 }} numberOfLines={1}>#{n.id} {n.title} {n.owner_name ? `(@${n.owner_name})` : '(seed)'}</Text>
                <TouchableOpacity
                  onPress={() => Alert.alert('Xóa truyện?', n.title, [
                    { text: 'Hủy', style: 'cancel' },
                    {
                      text: 'Xóa', style: 'destructive', onPress: async () => {
                        try { await client.delete(`/admin/novels/${n.id}`); Alert.alert('Đã xóa'); loadAdmin(); }
                        catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
                      },
                    },
                  ])}
                >
                  <Text style={{ color: '#c00', fontSize: 12, fontWeight: '700' }}>Xóa</Text>
                </TouchableOpacity>
              </View>
            ))}
            <Text style={[styles.cardTitle, { fontSize: 13, marginTop: 12 }]}>
              Báo cáo vi phạm ({(adminReports || []).filter((r) => r.status === 'pending').length} chờ)
            </Text>
            {(adminReports || []).slice(0, 8).map((r) => (
              <View key={r.id} style={styles.txRow}>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
                    #{r.novel_id} {r.novel_title} • @{r.username} • {r.status}
                  </Text>
                  <Text style={{ fontSize: 11, color: '#666' }} numberOfLines={2}>{r.reason}</Text>
                </View>
                {r.status === 'pending' && (
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TouchableOpacity
                      onPress={async () => {
                        try { await client.put(`/admin/reports/${r.id}`, { status: 'resolved' }); loadAdmin(); }
                        catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
                      }}
                    >
                      <Text style={{ color: '#00A86B', fontSize: 12, fontWeight: '700' }}>Duyệt</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      onPress={async () => {
                        try { await client.put(`/admin/reports/${r.id}`, { status: 'dismissed' }); loadAdmin(); }
                        catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
                      }}
                    >
                      <Text style={{ color: '#999', fontSize: 12 }}>Bỏ qua</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            ))}
            {(adminReports || []).length === 0 && <Text style={{ color: '#999', fontSize: 12 }}>Chưa có báo cáo nào.</Text>}
            <Text style={[styles.cardTitle, { fontSize: 13, marginTop: 12 }]}>Người dùng (bấm để cấp/hạ admin)</Text>
            {(adminUsers || []).map((u) => (
              <TouchableOpacity
                key={u.id}
                style={styles.txRow}
                onPress={() => Alert.alert(`${u.username} (${u.role})`, 'Đổi quyền?', [
                  { text: 'Hủy', style: 'cancel' },
                  {
                    text: u.role === 'admin' ? 'Hạ thành user' : 'Cấp admin', onPress: async () => {
                      try {
                        await client.put(`/admin/users/${u.id}/role`, { role: u.role === 'admin' ? 'user' : 'admin' });
                        loadAdmin();
                      } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
                    },
                  },
                ])}
              >
                <Text style={{ flex: 1, fontSize: 12 }} numberOfLines={1}>{u.username} • {u.email}</Text>
                <Text style={{ fontWeight: '800', fontSize: 12, color: u.role === 'admin' ? '#c00' : '#666' }}>{u.role}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        {isLoggedIn && (
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Đổi mật khẩu</Text>
            <TextInput style={styles.input} placeholder="Mật khẩu cũ" secureTextEntry value={oldPw} onChangeText={setOldPw} />
            <TextInput style={styles.input} placeholder="Mật khẩu mới (≥6 ký tự)" secureTextEntry value={newPw} onChangeText={setNewPw} />
            <TouchableOpacity onPress={changePw} style={styles.checkinBtn}><Text style={{ fontWeight: '800', color: '#fff' }}>Đổi mật khẩu</Text></TouchableOpacity>
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
      <Modal visible={showEdit} animationType="slide" transparent onRequestClose={() => setShowEdit(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalBox}>
            <Text style={{ fontWeight: '900', fontSize: 16 }}>Sửa profile</Text>
            <TextInput style={styles.input} value={newName} onChangeText={setNewName} placeholder="Username mới" />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={() => setShowEdit(false)} style={[styles.checkinBtn, { flex: 1, backgroundColor: '#eee' }]}>
                <Text style={{ fontWeight: '800' }}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={saveProfile} style={[styles.checkinBtn, { flex: 1 }]}>
                <Text style={{ fontWeight: '800', color: '#fff' }}>Lưu</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.bg },
  header: { flexDirection: 'row', alignItems: 'center', paddingTop: 48, padding: 16, gap: 12, backgroundColor: theme.headerBg },
  avatar: { width: 60, height: 60, borderRadius: 30, backgroundColor: theme.chip, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: theme.border },
  loginText: { color: theme.text, fontSize: 22, fontWeight: '900' },
  editBtn: { backgroundColor: theme.chip, paddingHorizontal: 12, paddingVertical: 6, borderRadius: 10, alignItems: 'center' },
  logoutBtn: { backgroundColor: '#ff6b6b', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, alignItems: 'center' },
  body: { flex: 1, backgroundColor: '#FFF8F1', padding: 16 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 16, marginBottom: 12, borderWidth: 1, borderColor: theme.border },
  cardTitle: { fontWeight: '900', fontSize: 15 },
  napBtn: { backgroundColor: theme.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 },
  packBtn: { flex: 1, backgroundColor: theme.chip, padding: 10, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: theme.border },
  dayBox: { flex: 1, backgroundColor: '#eee', borderRadius: 10, paddingVertical: 8, alignItems: 'center' },
  dayDone: { backgroundColor: theme.accent },
  dayToday: { borderWidth: 2, borderColor: theme.primary },
  dayText: { fontWeight: '800', fontSize: 12 },
  daySub: { fontSize: 10, color: '#666' },
  checkinBtn: { backgroundColor: theme.primary, padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  missionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  claimBtn: { backgroundColor: theme.text, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 8 },
  txRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  writerCard: { backgroundColor: '#FFE8D6', borderRadius: 16, padding: 16, flexDirection: 'row', justifyContent: 'space-between', marginTop: 4, borderWidth: 1, borderColor: theme.border },
  input: { borderWidth: 1, borderColor: theme.border, borderRadius: 10, padding: 10, marginTop: 8, backgroundColor: '#fff' },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
});
