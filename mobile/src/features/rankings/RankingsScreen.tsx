import { useState } from 'react';
import { useRouter } from 'expo-router';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Clock3, Eye, Star, Trophy, ChevronLeft } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { StoryCover } from '../../components/StoryCover';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { colors, radius } from '../../lib/theme';
import { safeError } from '../../lib/errors';
import { Choices, Action, ui, typeOptions } from '../stories/ui';
import type { RankedStory, RankingKind, RankingType } from './api';
import { useRankings } from './queries';
const options = [
  { value: 'reads', label: 'Top lượt đọc' },
  { value: 'rating', label: 'Top đánh giá' },
  { value: 'updated', label: 'Mới cập nhật' },
] as const;
const explanations = {
  reads:
    'Lượt mở chương đã ghi nhận từ lịch sử của người đăng nhập. Không tính khách; số liệu giảm khi lịch sử bị xóa.',
  rating:
    'Xếp theo điểm trung bình; cùng điểm ưu tiên truyện có nhiều đánh giá hơn. Chỉ tính truyện đã có đánh giá.',
  updated: 'Những truyện có thông tin hoặc chương vừa được cập nhật trong hệ thống.',
};
const number = (n: number) => n.toLocaleString('vi-VN');
export default function RankingsScreen() {
  const router = useRouter(),
    [kind, setKind] = useState<RankingKind>('reads'),
    [type, setType] = useState<RankingType>('');
  const result = useRankings(kind, type),
    allRows = result.data?.pages.flatMap((p) => p.data) ?? [],
    total = result.data?.pages[0]?.pagination.total;
  const seen = new Set<string>();
  const rows = allRows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
  const fatal = !!result.error && !result.data;
  return (
    <SafeAreaView edges={['top', 'left', 'right', 'bottom']} style={styles.safe}>
      <FlatList
        data={rows}
        keyExtractor={(row) => row.id}
        contentContainerStyle={styles.list}
        refreshing={result.isRefetching && !result.isFetchingNextPage}
        onRefresh={() => void result.refetch()}
        ListHeaderComponent={
          <View style={styles.header}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Quay lại"
              onPress={() => (router.canGoBack() ? router.back() : router.replace('/'))}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                minHeight: 44,
                alignSelf: 'flex-start',
              }}
            >
              <ChevronLeft size={18} color={colors.primary} />
              <Text style={styles.author}>Quay lại</Text>
            </Pressable>
            <AppHeader title="Bảng xếp hạng" subtitle="CÂU CHUYỆN NÀO ĐANG ĐƯỢC YÊU THÍCH?" />
            <View style={styles.hero}>
              <View style={styles.heroIcon}>
                <Trophy size={29} color="#d8b46a" />
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text style={styles.heroTitle}>Truyện nổi bật</Text>
                <Text style={styles.heroText}>NOVEL & COMIC · Chỉ truyện đã xuất bản</Text>
              </View>
            </View>
            <Choices
              label="Bảng xếp hạng"
              value={kind}
              options={options}
              onChange={(next) => {
                result.resetPagination();
                setKind(next);
              }}
            />
            <Choices
              label="Loại truyện"
              value={type}
              options={typeOptions}
              onChange={(next) => {
                result.resetPagination();
                setType(next);
              }}
            />
            <Text style={styles.explanation}>{explanations[kind]}</Text>
            <View style={styles.heading}>
              <Text accessibilityRole="header" style={ui.heading}>
                {options.find((o) => o.value === kind)!.label}
              </Text>
              {total !== undefined && !fatal && (
                <Text style={ui.caption}>{number(total)} truyện</Text>
              )}
            </View>
          </View>
        }
        ListEmptyComponent={
          result.isPending ? (
            <LoadingState label="Đang tải bảng xếp hạng…" />
          ) : fatal ? (
            <ErrorState
              message={safeError(result.error).message}
              onRetry={() => void result.refetch()}
            />
          ) : (
            <EmptyState
              title={
                kind === 'rating' ? 'Chưa có truyện được đánh giá' : 'Chưa có truyện trong bảng này'
              }
              message="Thử chọn loại truyện khác hoặc quay lại khi có thêm nội dung được xuất bản."
            />
          )
        }
        renderItem={({ item }) => (
          <RankingRow
            story={item}
            kind={kind}
            onPress={() => router.push({ pathname: '/story/[id]', params: { id: item.id } })}
          />
        )}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        ListFooterComponent={
          <View style={styles.footer}>
            {!!result.error && !!result.data && (
              <ErrorState
                message={safeError(result.error).message}
                onRetry={() =>
                  void (result.isFetchNextPageError ? result.fetchNextPage() : result.refetch())
                }
              />
            )}
            {result.hasNextPage && !result.error && (
              <Action
                label={result.isFetchingNextPage ? 'Đang tải thêm…' : 'Xem thêm thứ hạng'}
                disabled={result.isFetchingNextPage}
                onPress={() => void result.fetchNextPage()}
              />
            )}
            {!!rows.length && !result.hasNextPage && (
              <Text style={[ui.caption, { textAlign: 'center' }]}>
                Bạn đã xem hết bảng xếp hạng này.
              </Text>
            )}
          </View>
        }
      />
    </SafeAreaView>
  );
}
function RankingRow({
  story,
  kind,
  onPress,
}: {
  story: RankedStory;
  kind: RankingKind;
  onPress: () => void;
}) {
  const Icon = kind === 'reads' ? Eye : kind === 'rating' ? Star : Clock3;
  const metric =
    kind === 'reads'
      ? `${number(story.readCount)} lượt đọc ghi nhận`
      : kind === 'rating'
        ? `${story.averageScore?.toLocaleString('vi-VN', { maximumFractionDigits: 2 })}/5 · ${number(story.ratingCount)} đánh giá`
        : `Cập nhật ${new Date(story.updatedAt).toLocaleString('vi-VN', { dateStyle: 'short', timeStyle: 'short' })}`;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Hạng ${story.rank}: ${story.title}`}
      onPress={onPress}
      style={[styles.card, story.rank === 1 && styles.first]}
    >
      <View style={[styles.rank, story.rank <= 3 && styles.medal]}>
        <Text style={[styles.rankText, story.rank <= 3 && styles.medalText]}>{story.rank}</Text>
      </View>
      <StoryCover url={story.coverUrl} title={story.title} width={60} />
      <View style={styles.info}>
        <Text style={styles.badge}>{story.type === 'NOVEL' ? 'TIỂU THUYẾT' : 'TRUYỆN TRANH'}</Text>
        <Text style={styles.title} numberOfLines={2}>
          {story.title}
        </Text>
        <Text numberOfLines={1} style={styles.author}>
          {story.authorName}
        </Text>
        <View style={styles.metric}>
          <Icon size={14} color={colors.primary} />
          <Text style={styles.metricText}>{metric}</Text>
        </View>
      </View>
    </Pressable>
  );
}
const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.background },
  list: { padding: 16, paddingBottom: 32, width: '100%', maxWidth: 640, alignSelf: 'center' },
  header: { gap: 18, paddingBottom: 16 },
  hero: {
    padding: 20,
    borderRadius: radius.lg,
    backgroundColor: '#213e37',
    flexDirection: 'row',
    gap: 16,
    alignItems: 'center',
  },
  heroIcon: {
    width: 52,
    height: 52,
    backgroundColor: '#345046',
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroTitle: { color: '#fff4d8', fontSize: 20, fontWeight: '700', lineHeight: 27 },
  heroText: { color: '#d1e0d6', fontSize: 12, lineHeight: 19 },
  explanation: { color: colors.muted, fontSize: 12, lineHeight: 19 },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  card: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 11,
  },
  first: { borderColor: '#d8c492', backgroundColor: '#fffdf7' },
  rank: {
    width: 30,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    borderRadius: 10,
    backgroundColor: colors.primarySoft,
  },
  rankText: { fontSize: 14, fontWeight: '800', color: colors.primary },
  medal: { backgroundColor: '#f4ead1' },
  medalText: { color: '#966a20' },
  info: { flex: 1, minWidth: 0, gap: 6 },
  badge: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6, color: colors.primary },
  title: { fontSize: 16, lineHeight: 22, fontWeight: '700', color: colors.ink },
  author: { fontSize: 12, color: colors.muted },
  metric: { flexDirection: 'row', gap: 5, alignItems: 'center' },
  metricText: { flex: 1, fontSize: 11, lineHeight: 17, color: colors.primary, fontWeight: '600' },
  footer: { paddingTop: 18, gap: 12 },
});
