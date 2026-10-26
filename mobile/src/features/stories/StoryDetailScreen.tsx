import { useRef } from 'react';
import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { ScreenContainer } from '../../components/ScreenContainer';
import { StoryCover } from '../../components/StoryCover';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { safeError } from '../../lib/errors';
import { colors } from '../../lib/theme';
import { isUuid } from './api';
import { useChapters, useStory } from './queries';
import { Action, ui } from './ui';
import { FavoriteButton } from '../library/FavoriteButton';

export default function StoryDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const scrollRef = useRef<ScrollView>(null);
  const chaptersY = useRef(0);
  const story = useStory(id);
  const chapters = useChapters(id, !!story.data && !story.error);
  const firstPage = chapters.data?.pages[0];
  const first = firstPage?.data[0];
  const read = (chapterId: string) =>
    router.push({ pathname: '/reader/[id]', params: { id: chapterId, storyId: id } });
  const content = story.data;
  return (
    <ScreenContainer
      scrollRef={scrollRef}
      refreshing={story.isRefetching || chapters.isRefetching}
      onRefresh={
        isUuid(id)
          ? () => {
              void story.refetch();
              if (content) void chapters.refetch();
            }
          : undefined
      }
    >
      <Link href="/explore" style={ui.actionText}>
        ← Khám phá
      </Link>
      {!isUuid(id) ? (
        <ErrorState message="Liên kết không hợp lệ. ID cần có định dạng UUID." />
      ) : story.isPending ? (
        <LoadingState label="Đang tải thông tin truyện…" />
      ) : story.error ? (
        <ErrorState
          message={safeError(story.error).message}
          onRetry={() => {
            void story.refetch();
          }}
        />
      ) : content ? (
        <>
          <View style={styles.cover}>
            <StoryCover url={content.coverUrl} title={content.title} width={132} />
          </View>
          <AppHeader
            title={content.title}
            subtitle={content.type === 'NOVEL' ? 'TIỂU THUYẾT' : 'TRUYỆN TRANH'}
          />
          <View style={ui.group}>
            <Text style={ui.body}>Tác giả · {content.authorName}</Text>
            <Text style={ui.body}>
              {content.status === 'ONGOING' ? 'Đang tiến hành' : 'Hoàn thành'}
            </Text>
            {!chapters.error && firstPage && (
              <Text style={ui.caption}>{firstPage.pagination.total} chương đã xuất bản</Text>
            )}
            <View style={ui.wrap}>
              {content.genres.map((genre) => (
                <Link
                  key={genre.id}
                  href={{ pathname: '/explore', params: { genreId: genre.id } }}
                  style={styles.genre}
                >
                  {genre.name}
                </Link>
              ))}
            </View>
          </View>
          <Action
            label="Bắt đầu đọc"
            primary
            disabled={!first || chapters.isPending || !!chapters.error}
            onPress={() => {
              if (first) read(first.id);
            }}
          />
          <Action
            label="Danh sách chương"
            onPress={() => scrollRef.current?.scrollTo({ y: chaptersY.current, animated: true })}
          />
          <FavoriteButton storyId={id} />
          <Link href={{ pathname: '/feedback/[id]', params: { id } }} style={ui.actionText}>
            Đánh giá và bình luận
          </Link>
          <View style={ui.group}>
            <Text accessibilityRole="header" style={ui.heading}>
              Về câu chuyện
            </Text>
            <Text style={ui.body}>{content.description || 'Chưa có mô tả.'}</Text>
          </View>
          <View
            style={ui.group}
            onLayout={(event) => {
              chaptersY.current = event.nativeEvent.layout.y;
            }}
          >
            <Text accessibilityRole="header" style={ui.heading}>
              Các chương đã xuất bản
            </Text>
            {chapters.isPending ? (
              <LoadingState label="Đang tải danh sách chương…" />
            ) : chapters.error ? (
              <ErrorState
                message={safeError(chapters.error).message}
                onRetry={() => {
                  void chapters.refetch();
                }}
              />
            ) : firstPage?.pagination.total === 0 ? (
              <EmptyState
                title="Chưa có chương được xuất bản"
                message="Hãy quay lại sau để bắt đầu câu chuyện này."
              />
            ) : (
              chapters.data?.pages
                .flatMap((page) => page.data)
                .map((chapter) => (
                  <Action
                    key={chapter.id}
                    label={`Chương ${chapter.chapterNumber} · ${chapter.title}${chapter.isVip ? ` · VIP ${chapter.coinPrice ?? 10} Coin` : ''}`}
                    onPress={() => read(chapter.id)}
                  />
                ))
            )}
            {chapters.hasNextPage && (
              <Action
                label={chapters.isFetchingNextPage ? 'Đang tải thêm…' : 'Tải thêm chương'}
                disabled={chapters.isFetchingNextPage}
                onPress={() => {
                  void chapters.fetchNextPage();
                }}
              />
            )}
          </View>
        </>
      ) : null}
    </ScreenContainer>
  );
}
const styles = StyleSheet.create({
  cover: { alignItems: 'center', paddingTop: 8 },
  genre: {
    color: colors.primary,
    backgroundColor: colors.primarySoft,
    padding: 12,
    borderRadius: 12,
    minHeight: 44,
    fontSize: 14,
  },
});
