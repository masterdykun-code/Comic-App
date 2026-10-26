import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { BookOpen, Trophy, ChevronRight } from 'lucide-react-native';
import { AppHeader } from '../../components/AppHeader';
import { ScreenContainer } from '../../components/ScreenContainer';
import { colors, radius } from '../../lib/theme';
import { useStories } from './queries';
import { SearchLink, StoryResults, ui } from './ui';

export default function HomeScreen() {
  const newest = useStories({ sort: 'newest', limit: 4 });
  const novels = useStories({ type: 'NOVEL', sort: 'newest', limit: 4 });
  const comics = useStories({ type: 'COMIC', sort: 'newest', limit: 4 });
  const sections = [
    { title: 'Mới trên giá sách', query: newest, type: '' },
    { title: 'Tiểu thuyết', query: novels, type: 'NOVEL' },
    { title: 'Truyện tranh', query: comics, type: 'COMIC' },
  ];
  return (
    <ScreenContainer
      refreshing={sections.some(({ query }) => query.isRefetching)}
      onRefresh={() => {
        void Promise.all(sections.map(({ query }) => query.refetch()));
      }}
    >
      <AppHeader title="Câu chuyện tiếp theo của bạn." />
      <SearchLink />
      <Link href="/rankings" asChild>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Bảng xếp hạng truyện"
          style={styles.rankingLink}
        >
          <Trophy size={19} color={colors.primary} />
          <Text style={{ flex: 1, color: colors.primary, fontWeight: '700' }}>
            Bảng xếp hạng truyện
          </Text>
          <ChevronRight size={17} color={colors.primary} />
        </Pressable>
      </Link>
      <View style={styles.hero}>
        <BookOpen size={32} color="#B6D7C6" />
        <Text style={styles.overline}>MỖI CHƯƠNG, MỘT KHÁM PHÁ</Text>
        <Text style={styles.title}>Chạm vào một{`\n`}thế giới mới.</Text>
        <Text style={styles.copy}>
          Dành một chút thời gian cho những chương chữ và những trang tranh.
        </Text>
        <Link href="/explore" style={styles.link}>
          Bắt đầu khám phá →
        </Link>
      </View>
      {sections.map(({ title, query, type }) => (
        <View key={title} style={ui.group}>
          <Text accessibilityRole="header" style={ui.heading}>
            {title}
          </Text>
          <StoryResults
            stories={query.data?.pages[0]?.data ?? []}
            pending={query.isPending}
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
            emptyTitle="Chưa có truyện được xuất bản"
          />
          <Link href={{ pathname: '/explore', params: { type } }} style={styles.more}>
            Xem thêm · {title}
          </Link>
        </View>
      ))}
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  rankingLink: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.sm,
    padding: 15,
    minHeight: 48,
  },
  hero: { backgroundColor: colors.ink, borderRadius: radius.lg, padding: 26, gap: 16 },
  overline: { color: '#B6D7C6', fontSize: 10, letterSpacing: 1.5, fontWeight: '700' },
  title: { color: 'white', fontSize: 32, fontWeight: '700', lineHeight: 40 },
  copy: { color: '#C2D8CE', fontSize: 15, lineHeight: 24 },
  link: { color: '#DDF0DF', fontSize: 15, fontWeight: '700', paddingVertical: 12, minHeight: 48 },
  more: { color: colors.primary, fontWeight: '600', paddingVertical: 14, minHeight: 48 },
});
