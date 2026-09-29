import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert, TextInput, Share, RefreshControl, Modal } from 'react-native';
import { useEffect, useMemo, useState } from 'react';
import client from '../api/client';
import { useAuth } from '../context/AuthContext';
import SafeCover from '../components/SafeCover';

function timeAgo(s) {
  if (!s) return '';
  const d = (Date.now() - new Date(s).getTime()) / 1000;
  if (d < 60) return 'vừa xong';
  if (d < 3600) return `${Math.floor(d / 60)} phút trước`;
  if (d < 86400) return `${Math.floor(d / 3600)} giờ trước`;
  return `${Math.floor(d / 86400)} ngày trước`;
}

export default function NovelDetailScreen({ route, navigation }) {
  const { id } = route.params;
  const [novel, setNovel] = useState(null);
  const [chapters, setChapters] = useState([]);
  const [inShelf, setInShelf] = useState(false);
  const [ratings, setRatings] = useState([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [myScore, setMyScore] = useState(5);
  const [myComment, setMyComment] = useState('');
  const [comments, setComments] = useState([]);
  const [newComment, setNewComment] = useState('');
  const [replyTo, setReplyTo] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRead, setLastRead] = useState(null);
  const [showReport, setShowReport] = useState(false);
  const [reportReason, setReportReason] = useState('');
  const { isLoggedIn, user } = useAuth();

  const load = async (silent = false) => {
    if (!silent) setRefreshing(true);
    try {
      const [n, ch, ra, cm] = await Promise.all([
        client.get(`/novels/${id}`),
        client.get(`/novels/${id}/chapters`).catch(() => ({ data: [] })),
        client.get(`/novels/${id}/ratings`).catch(() => ({ data: { ratings: [], avg: 0, count: 0 } })),
        client.get(`/novels/${id}/comments`).catch(() => ({ data: [] })),
      ]);
      setNovel(n.data);
      setChapters(Array.isArray(ch.data) ? ch.data : []);
      setRatings(ra.data?.ratings || []);
      setAvg(Number(ra.data?.avg || 0));
      setCount(ra.data?.count || 0);
      setComments(Array.isArray(cm.data) ? cm.data : []);
      if (isLoggedIn) {
        client.get('/bookshelf').then((r) => setInShelf(r.data.some((b) => b.id === Number(id) || b.id === id))).catch(() => {});
        client.get('/history').then((r) => {
          const h = (Array.isArray(r.data) ? r.data : []).find((x) => String(x.novel_id) === String(id));
          setLastRead(h || null);
        }).catch(() => {});
      } else {
        setLastRead(null);
      }
    } catch {}
    finally { setRefreshing(false); }
  };
  useEffect(() => { load(); }, [id, isLoggedIn]);

  const dist = useMemo(() => {
    const d = [0, 0, 0, 0, 0, 0];
    ratings.forEach((r) => { if (r.score >= 1 && r.score <= 5) d[r.score]++; });
    return d;
  }, [ratings]);

  // Group comment cha/con
  const threads = useMemo(() => {
    const parents = comments.filter((c) => !c.parent_id);
    const byParent = {};
    comments.filter((c) => c.parent_id).forEach((c) => {
      (byParent[c.parent_id] = byParent[c.parent_id] || []).push(c);
    });
    return parents.map((p) => ({ ...p, replies: (byParent[p.id] || []).sort((a, b) => new Date(a.created_at) - new Date(b.created_at)) }));
  }, [comments]);

  const myRating = useMemo(() => ratings.find((r) => user && r.user_id === user.id), [ratings, user]);

  const toggleShelf = async () => {
    if (!isLoggedIn) return navigation.navigate('Login');
    try {
      if (inShelf) { await client.delete(`/bookshelf/${id}`); setInShelf(false); Alert.alert('Đã xóa khỏi tủ sách'); }
      else { await client.post(`/bookshelf/${id}`); setInShelf(true); Alert.alert('Đã thêm vào tủ sách'); }
    } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
  };

  const submitRating = async () => {
    if (!isLoggedIn) return navigation.navigate('Login');
    try {
      await client.post(`/novels/${id}/ratings`, { score: myScore, comment: myComment });
      Alert.alert(myRating ? 'Đã cập nhật đánh giá!' : 'Cảm ơn đánh giá!');
      setMyComment('');
      load(true);
    } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
  };

  const submitComment = async () => {
    if (!isLoggedIn) return navigation.navigate('Login');
    const text = replyTo ? newComment : newComment;
    if (!text.trim()) return;
    try {
      await client.post(`/novels/${id}/comments`, { content: text.trim(), parent_id: replyTo?.id || null });
      setNewComment(''); setReplyTo(null);
      load(true);
    } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
  };

  const deleteComment = (c) => {
    Alert.alert('Xóa bình luận?', `"${c.content.slice(0, 60)}"`, [
      { text: 'Hủy', style: 'cancel' },
      {
        text: 'Xóa', style: 'destructive', onPress: async () => {
          try { await client.delete(`/novels/comments/${c.id}`); load(true); }
          catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
        },
      },
    ]);
  };

  const toggleLike = async (c) => {
    if (!isLoggedIn) return navigation.navigate('Login');
    // optimistic
    const prev = comments.map((x) => ({ ...x }));
    setComments((cs) => cs.map((x) => x.id === c.id ? { ...x, likes_count: (x.likes_count || 0) + 1 } : x));
    try { await client.post(`/novels/comments/${c.id}/like`); load(true); }
    catch { setComments(prev); }
  };

  const doShare = async () => {
    try {
      await Share.share({ message: `${novel.title} - ${novel.author} (WebNovel App): xem trong app, id=${id}` });
    } catch {}
  };

  const doVote = async () => {
    if (!isLoggedIn) return navigation.navigate('Login');
    try {
      await client.post('/wallet/vote', { novel_id: Number(id) });
      Alert.alert('Đã đề cử', 'Cảm ơn phiếu đề cử của bạn (+nhiệm vụ)');
      load(true);
    } catch (e) { Alert.alert('Không vote được', e.response?.data?.message || e.message); }
  };

  const submitReport = async () => {
    if (!isLoggedIn) return navigation.navigate('Login');
    if (reportReason.trim().length < 5) return Alert.alert('Lý do quá ngắn', 'Nêu rõ ít nhất 5 ký tự.');
    try {
      await client.post(`/novels/${id}/reports`, { reason: reportReason.trim() });
      Alert.alert('Đã gửi báo cáo', 'Admin sẽ kiểm duyệt. Cảm ơn bạn.');
      setReportReason(''); setShowReport(false);
    } catch (e) { Alert.alert('Lỗi', e.response?.data?.message || e.message); }
  };

  const continueChap = lastRead?.chapter_number || null;

  if (!novel) return <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}><Text>Loading...</Text></View>;

  return (
    <View style={{ flex: 1 }}>
    <ScrollView
      style={styles.container}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load()} />}
    >
      <SafeCover uri={novel.cover_url} title={novel.title} style={styles.cover} />
      <View style={styles.info}>
        <Text style={styles.title}>{novel.title}</Text>
        <Text style={styles.author}>{novel.author} • {novel.category_name} • {novel.chapter_count ?? chapters.length} chương • {novel.total_views} views</Text>
        <Text style={[styles.author, { marginTop: 2 }]}>{novel.status === 'completed' ? '✓ Hoàn thành' : '⏳ Đang ra'} {novel.owner_username ? `• của @${novel.owner_username}` : ''}</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 6 }}>
          <Text style={{ color: '#FFA500', fontWeight: '800' }}>★ {Number(avg).toFixed(1)} </Text>
          <Text style={{ color: '#888' }}>({count} đánh giá)</Text>
          {myRating && <Text style={{ color: '#00A86B', marginLeft: 8 }}>• Bạn: ★{myRating.score}</Text>}
        </View>
        {/* Phân bố sao */}
        <View style={{ marginTop: 8 }}>
          {[5, 4, 3, 2, 1].map((s) => (
            <View key={s} style={{ flexDirection: 'row', alignItems: 'center', marginTop: 2 }}>
              <Text style={{ width: 18, color: '#888', fontSize: 12 }}>{s}★</Text>
              <View style={styles.barBg}>
                <View style={[styles.barFill, { width: `${count ? Math.round((dist[s] / count) * 100) : 0}%` }]} />
              </View>
              <Text style={{ width: 30, color: '#888', fontSize: 12, textAlign: 'right' }}>{dist[s]}</Text>
            </View>
          ))}
        </View>
        <Text style={styles.desc}>{novel.description}</Text>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
          <TouchableOpacity
            onPress={() => {
              const target = continueChap || 1;
              if (chapters.length === 0 || chapters.some((c) => c.chapter_number === target)) {
                navigation.navigate('Reader', { novelId: id, chapterNumber: target });
              } else if (chapters[0]) {
                navigation.navigate('Reader', { novelId: id, chapterNumber: 1 });
              }
            }}
            style={styles.readBtn}
          >
            <Text style={{ color: '#fff', fontWeight: '800' }}>
              {continueChap ? `Đọc tiếp C${continueChap}` : 'Đọc ngay'}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={toggleShelf} style={[styles.saveBtn, inShelf && { backgroundColor: '#C8FF5A' }]}>
            <Text style={{ fontWeight: '800' }}>{inShelf ? '✓ Trong tủ' : '+ Tủ sách'}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={doShare} style={styles.shareBtn}><Text style={{ fontWeight: '800' }}>↗</Text></TouchableOpacity>
        </View>
        {lastRead?.chapter_title ? (
          <Text style={{ color: '#888', fontSize: 12, marginTop: 6 }}>Lần trước bạn đọc: {lastRead.chapter_title}</Text>
        ) : null}
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
          <TouchableOpacity onPress={() => { if (!isLoggedIn) return navigation.navigate('Login'); setShowReport(true); }} style={styles.reportLink}>
            <Text style={{ fontSize: 12, color: '#999' }}>⚑ Báo cáo vi phạm</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity onPress={doVote} style={styles.voteBtn}>
          <Text style={{ fontWeight: '800' }}>🔥 Đề cử ({novel.power_votes || 0}) • mỗi ngày 1 phiếu/truyện</Text>
        </TouchableOpacity>
      </View>

      {/* Rating */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Đánh giá ({count}) {myRating ? '• bạn đã vote' : ''}</Text>
        <View style={{ flexDirection: 'row', gap: 6, marginVertical: 8 }}>
          {[1, 2, 3, 4, 5].map((s) => (
            <TouchableOpacity key={s} onPress={() => setMyScore(s)} style={[styles.star, myScore >= s && styles.starActive]}>
              <Text style={{ color: myScore >= s ? '#fff' : '#888' }}>★</Text>
            </TouchableOpacity>
          ))}
          <Text style={{ marginLeft: 8, fontWeight: '700' }}>{myScore}/5</Text>
        </View>
        <TextInput style={styles.input} placeholder={myRating ? 'Cập nhật nhận xét...' : 'Nhận xét (optional)'} value={myComment} onChangeText={setMyComment} />
        <TouchableOpacity style={styles.rateBtn} onPress={submitRating}>
          <Text style={{ color: '#fff', fontWeight: '800' }}>{myRating ? 'Cập nhật đánh giá' : 'Gửi đánh giá'}</Text>
        </TouchableOpacity>
        {(ratings || []).slice(0, 5).map((r) => (
          <View key={r.id} style={styles.commentRow}>
            <Text style={{ fontWeight: '700' }}>{r.username} <Text style={{ color: '#FFA500' }}>★{r.score}</Text> <Text style={{ color: '#aaa', fontWeight: '400', fontSize: 11 }}>{timeAgo(r.created_at)}</Text></Text>
            {r.comment ? <Text style={{ color: '#444', marginTop: 2 }}>{r.comment}</Text> : null}
          </View>
        ))}
      </View>

      {/* Comments */}
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Bình luận ({comments.length})</Text>
        {replyTo && (
          <View style={styles.replyBar}>
            <Text style={{ fontSize: 12, color: '#666' }}>Trả lời @{replyTo.username}: "{replyTo.content.slice(0, 40)}"</Text>
            <TouchableOpacity onPress={() => setReplyTo(null)}><Text style={{ fontWeight: '800' }}> ✕</Text></TouchableOpacity>
          </View>
        )}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 8 }}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            placeholder={isLoggedIn ? (replyTo ? `Trả lời @${replyTo.username}...` : 'Viết bình luận...') : 'Đăng nhập để bình luận'}
            value={newComment}
            onChangeText={setNewComment}
            editable={isLoggedIn}
          />
          <TouchableOpacity style={styles.rateBtn} onPress={submitComment}><Text style={{ color: '#fff', fontWeight: '800' }}>Gửi</Text></TouchableOpacity>
        </View>
        {threads.map((c) => (
          <View key={c.id} style={styles.commentRow}>
            <Text style={{ fontWeight: '700' }}>{c.username} <Text style={{ color: '#aaa', fontWeight: '400', fontSize: 11 }}>{timeAgo(c.created_at)}</Text></Text>
            <Text style={{ color: '#444', marginTop: 2 }}>{c.content}</Text>
            <View style={{ flexDirection: 'row', gap: 14, marginTop: 6 }}>
              <TouchableOpacity onPress={() => toggleLike(c)}><Text style={{ color: '#666', fontSize: 12 }}>♥ {c.likes_count || 0}</Text></TouchableOpacity>
              <TouchableOpacity onPress={() => setReplyTo(c)}><Text style={{ color: '#666', fontSize: 12 }}>↩ Trả lời{c.replies?.length ? ` (${c.replies.length})` : ''}</Text></TouchableOpacity>
              {user && c.user_id === user.id && (
                <TouchableOpacity onPress={() => deleteComment(c)}><Text style={{ color: '#c00', fontSize: 12 }}>Xóa</Text></TouchableOpacity>
              )}
            </View>
            {(c.replies || []).map((rp) => (
              <View key={rp.id} style={styles.replyRow}>
                <Text style={{ fontWeight: '700', fontSize: 13 }}>{rp.username} <Text style={{ color: '#aaa', fontWeight: '400', fontSize: 11 }}>{timeAgo(rp.created_at)}</Text></Text>
                <Text style={{ color: '#444', fontSize: 13, marginTop: 2 }}>{rp.content}</Text>
                <View style={{ flexDirection: 'row', gap: 14, marginTop: 4 }}>
                  <TouchableOpacity onPress={() => toggleLike(rp)}><Text style={{ color: '#666', fontSize: 12 }}>♥ {rp.likes_count || 0}</Text></TouchableOpacity>
                  {user && rp.user_id === user.id && (
                    <TouchableOpacity onPress={() => deleteComment(rp)}><Text style={{ color: '#c00', fontSize: 12 }}>Xóa</Text></TouchableOpacity>
                  )}
                </View>
              </View>
            ))}
          </View>
        ))}
        {threads.length === 0 && <Text style={{ color: '#999', marginTop: 8 }}>Chưa có bình luận — hãy là người đầu tiên.</Text>}
      </View>

      <Text style={styles.chapHeader}>Danh sách chương ({chapters.length})</Text>
      {(chapters || []).map((c) => (
        <TouchableOpacity key={c.id} onPress={() => navigation.navigate('Reader', { novelId: id, chapterNumber: c.chapter_number })} style={styles.chapRow}>
          <Text style={{ fontWeight: '600', flex: 1 }} numberOfLines={1}>{c.is_locked ? '🔒 ' : ''}{c.title}</Text>
          <Text style={{ color: '#999' }}>›</Text>
        </TouchableOpacity>
      ))}
      <View style={{ height: 30 }} />
    </ScrollView>
      <Modal visible={showReport} animationType="slide" transparent onRequestClose={() => setShowReport(false)}>
        <View style={styles.modalWrap}>
          <View style={styles.modalBox}>
            <Text style={{ fontWeight: '900', fontSize: 16 }}>Báo cáo "{novel.title}"</Text>
            <Text style={{ color: '#888', fontSize: 12, marginTop: 4 }}>VD: sao chép, nội dung phản cảm, sai thể loại...</Text>
            <TextInput
              style={[styles.input, { height: 90, textAlignVertical: 'top' }]}
              value={reportReason}
              onChangeText={setReportReason}
              placeholder="Lý do báo cáo..."
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 12 }}>
              <TouchableOpacity onPress={() => setShowReport(false)} style={[styles.rateBtn, { flex: 1, backgroundColor: '#eee' }]}>
                <Text style={{ fontWeight: '800' }}>Hủy</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={submitReport} style={[styles.rateBtn, { flex: 1 }]}>
                <Text style={{ color: '#fff', fontWeight: '800' }}>Gửi</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  cover: { width: '100%', height: 320, backgroundColor: '#eee' },
  info: { padding: 16 },
  title: { fontSize: 22, fontWeight: '900' },
  author: { color: '#888', marginTop: 4 },
  desc: { marginTop: 10, lineHeight: 20, color: '#444' },
  readBtn: { flex: 1, backgroundColor: '#FF6A00', padding: 14, borderRadius: 10, alignItems: 'center' },
  saveBtn: { flex: 1, backgroundColor: '#eee', padding: 14, borderRadius: 10, alignItems: 'center' },
  shareBtn: { backgroundColor: '#eee', padding: 14, borderRadius: 10, alignItems: 'center', paddingHorizontal: 18 },
  voteBtn: { backgroundColor: '#FFF3E0', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 10, borderWidth: 1, borderColor: '#FFB74D' },
  section: { padding: 16, borderTopWidth: 8, borderTopColor: '#f5f5f5' },
  sectionTitle: { fontWeight: '900', fontSize: 16 },
  star: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#eee', justifyContent: 'center', alignItems: 'center' },
  starActive: { backgroundColor: '#FFA500' },
  input: { borderWidth: 1, borderColor: '#ddd', borderRadius: 10, padding: 10, marginTop: 8 },
  rateBtn: { backgroundColor: '#FF6A00', padding: 12, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  commentRow: { padding: 10, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  replyRow: { marginTop: 8, marginLeft: 12, paddingLeft: 10, borderLeftWidth: 2, borderLeftColor: '#eee' },
  replyBar: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: '#FFF8E1', padding: 8, borderRadius: 8, marginTop: 8 },
  barBg: { flex: 1, height: 6, backgroundColor: '#eee', borderRadius: 3, marginHorizontal: 6 },
  barFill: { height: 6, backgroundColor: '#FFA500', borderRadius: 3 },
  chapHeader: { fontWeight: '900', fontSize: 16, padding: 16, borderTopWidth: 8, borderTopColor: '#f5f5f5' },
  reportLink: { paddingVertical: 6, paddingRight: 12 },
  modalWrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalBox: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 16 },
  chapRow: { flexDirection: 'row', justifyContent: 'space-between', padding: 14, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', marginHorizontal: 16, alignItems: 'center' },
});
