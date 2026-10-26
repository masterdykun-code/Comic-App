import { useEffect, useState } from 'react';
import { Link } from 'expo-router';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { ScreenContainer } from '../../components/ScreenContainer';
import { EmptyState } from '../../components/States';
import { colors, radius, typography } from '../../lib/theme';
import { useStories } from './queries';
import { Action, StoryResults, ui } from './ui';

export default function SearchScreen() {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const normalized = input.trim();
  useEffect(() => {
    const timeout = setTimeout(() => setSearch(normalized), 400);
    return () => clearTimeout(timeout);
  }, [normalized]);
  const settling = normalized !== search;
  const stories = useStories({ search }, search.length > 0 && !settling);
  return (
    <ScreenContainer
      refreshing={stories.isRefetching}
      onRefresh={
        search && !settling
          ? () => {
              void stories.refetch();
            }
          : undefined
      }
    >
      <Link href="/explore" style={ui.actionText}>
        ← Khám phá
      </Link>
      <AppHeader title="Tìm câu chuyện của bạn" subtitle="TÌM THEO TÊN TRUYỆN" />
      <View style={ui.group}>
        <TextInput
          accessibilityLabel="Tìm truyện theo tên"
          placeholder="Nhập tên truyện…"
          value={input}
          onChangeText={setInput}
          maxLength={200}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          style={styles.input}
        />
        {input.length > 0 && (
          <Action
            label="Xóa tìm kiếm"
            onPress={() => {
              setInput('');
              setSearch('');
            }}
          />
        )}
      </View>
      {!normalized ? (
        <EmptyState
          title="Bạn muốn đọc gì hôm nay?"
          message="Nhập tên truyện để tìm trong thư viện đã xuất bản."
        />
      ) : settling ? (
        <Text accessibilityLiveRegion="polite" style={ui.body}>
          Đang chờ tìm kiếm…
        </Text>
      ) : (
        <>
          <Text style={ui.caption}>Kết quả cho “{search}”</Text>
          <StoryResults
            stories={stories.data?.pages.flatMap((page) => page.data) ?? []}
            pending={stories.isPending}
            error={stories.error}
            retry={() => {
              void stories.refetch();
            }}
            emptyTitle="Không tìm thấy truyện"
          />
          {stories.hasNextPage && (
            <Action
              label={stories.isFetchingNextPage ? 'Đang tải thêm…' : 'Tải thêm kết quả'}
              disabled={stories.isFetchingNextPage}
              onPress={() => {
                void stories.fetchNextPage();
              }}
            />
          )}
        </>
      )}
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  input: {
    ...typography.body,
    minHeight: 56,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.ink,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: 16,
  },
});
