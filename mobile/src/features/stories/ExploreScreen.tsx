import { Link, useLocalSearchParams, useRouter } from 'expo-router';
import { useState } from 'react';
import { Text } from 'react-native';
import { AppHeader } from '../../components/AppHeader';
import { ScreenContainer } from '../../components/ScreenContainer';
import { ErrorState, LoadingState } from '../../components/States';
import { safeError } from '../../lib/errors';
import { isUuid, type StorySort, type StoryStatus, type StoryType } from './api';
import { useGenres, useStories } from './queries';
import { Action, Choices, SearchLink, StoryResults, typeOptions, ui } from './ui';

export default function ExploreScreen() {
  const params = useLocalSearchParams<{ type?: string; genreId?: string }>();
  const router = useRouter();
  const type: StoryType | '' =
    params.type === 'NOVEL' || params.type === 'COMIC' ? params.type : '';
  const [status, setStatus] = useState<StoryStatus | ''>('');
  const genreId = isUuid(params.genreId) ? params.genreId : '';
  const [sort, setSort] = useState<StorySort>('newest');
  const genres = useGenres();
  const stories = useStories({
    type: type || undefined,
    status: status || undefined,
    genreId: genreId || undefined,
    sort,
  });
  return (
    <ScreenContainer
      refreshing={stories.isRefetching || genres.isRefetching}
      onRefresh={() => {
        void Promise.all([stories.refetch(), genres.refetch()]);
      }}
    >
      <AppHeader title="Khám phá" subtitle="MỘT GIÁ SÁCH, NHIỀU THẾ GIỚI" />
      <Link href="/rankings" style={ui.action}>
        Bảng xếp hạng truyện →
      </Link>
      <SearchLink />
      <Choices
        label="Loại truyện"
        value={type}
        options={typeOptions}
        onChange={(value) => {
          stories.resetPagination();
          router.setParams({ type: value });
        }}
      />
      <Choices
        label="Trạng thái"
        value={status}
        options={[
          { value: '', label: 'Tất cả' },
          { value: 'ONGOING', label: 'Đang tiến hành' },
          { value: 'COMPLETED', label: 'Hoàn thành' },
        ]}
        onChange={(value) => {
          stories.resetPagination();
          setStatus(value);
        }}
      />
      {genres.isPending ? (
        <LoadingState label="Đang tải thể loại…" />
      ) : genres.error ? (
        <ErrorState
          message={safeError(genres.error).message}
          onRetry={() => {
            void genres.refetch();
          }}
        />
      ) : (
        <Choices
          label="Thể loại"
          value={genreId}
          options={[
            { value: '', label: 'Tất cả' },
            ...(genres.data ?? []).map((genre) => ({ value: genre.id, label: genre.name })),
          ]}
          onChange={(value) => {
            stories.resetPagination();
            router.setParams({ genreId: value });
          }}
        />
      )}
      <Choices
        label="Sắp xếp"
        value={sort}
        options={[
          { value: 'newest', label: 'Mới nhất' },
          { value: 'updated', label: 'Mới cập nhật' },
          { value: 'title', label: 'Tên A–Z' },
        ]}
        onChange={(value) => {
          stories.resetPagination();
          setSort(value);
        }}
      />
      <Text accessibilityRole="header" style={ui.heading}>
        Truyện dành cho bạn
      </Text>
      <StoryResults
        stories={stories.data?.pages.flatMap((page) => page.data) ?? []}
        pending={stories.isPending}
        error={stories.error}
        retry={() => {
          void stories.refetch();
        }}
      />
      {stories.hasNextPage && (
        <Action
          label={stories.isFetchingNextPage ? 'Đang tải thêm…' : 'Tải thêm truyện'}
          disabled={stories.isFetchingNextPage}
          onPress={() => {
            void stories.fetchNextPage();
          }}
        />
      )}
    </ScreenContainer>
  );
}
