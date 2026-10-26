import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/use-auth';
import { authSession } from '../../services/runtime';
import { safeError } from '../../lib/errors';
import { ErrorState, LoadingState, EmptyState } from '../../components/States';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Action, ui } from '../stories/ui';
import { usePrivateScope } from '../library/session';
import { feedbackApi, ratingInput, type Rating, type Summary } from './api';
import { Author, Field, Stars, useFeedbackAction, feedbackStyles as styles } from './shared';
export function RatingSummary({ summary }: { summary: Summary }) {
  return (
    <View style={ui.group}>
      <Text style={ui.heading}>
        {summary.averageScore === null ? 'Chưa có điểm' : `${summary.averageScore.toFixed(2)} / 5`}
      </Text>
      <Text style={ui.body}>{summary.totalRatings} đánh giá</Text>
      {[5, 4, 3, 2, 1].map((n) => (
        <Text key={n} style={ui.caption}>
          {n} sao · {summary.distribution[n as 1 | 2 | 3 | 4 | 5]}
        </Text>
      ))}
    </View>
  );
}
export function Ratings({ storyId }: { storyId: string }) {
  const auth = useAuth();
  const list = useInfiniteQuery({
    queryKey: ['public', 'feedback', storyId, 'ratings'],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => feedbackApi.ratings(storyId, pageParam, signal),
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
  });
  return (
    <View style={ui.group}>
      <Text style={ui.heading} accessibilityRole="header">
        Đánh giá từ bạn đọc
      </Text>
      {list.data && <RatingSummary summary={list.data.pages[0].summary} />}
      {auth.status === 'authenticated' && auth.user?.status === 'ACTIVE' ? (
        <OwnedRating
          key={`${auth.user.id}:${authSession.generation()}`}
          storyId={storyId}
          username={auth.user.username}
        />
      ) : (
        <Link
          href={{ pathname: '/login', params: { next: `/feedback/${storyId}` } }}
          style={ui.actionText}
        >
          Đăng nhập để đánh giá
        </Link>
      )}
      {list.isPending && <LoadingState label="Đang tải đánh giá…" />}
      {list.error && (
        <ErrorState
          message={safeError(list.error).message}
          onRetry={() => {
            void list.refetch();
          }}
        />
      )}
      {list.data?.pages[0].pagination.total === 0 && (
        <EmptyState title="Chưa có đánh giá" message="Chia sẻ cảm nhận của bạn về câu chuyện." />
      )}
      {list.data?.pages
        .flatMap((p) => p.data)
        .filter((r, i, rows) => rows.findIndex((x) => x.id === r.id) === i)
        .map((r) => (
          <View key={r.id} style={styles.card}>
            <Author user={r.user} />
            <Text style={ui.body}>{r.score} / 5 sao</Text>
            {r.reviewText && <Text style={ui.body}>{r.reviewText}</Text>}
            <Text style={ui.caption}>{new Date(r.createdAt).toLocaleString('vi-VN')}</Text>
          </View>
        ))}
      {list.hasNextPage && (
        <Action
          label="Tải thêm đánh giá"
          disabled={list.isFetchingNextPage}
          onPress={() => {
            void list.fetchNextPage();
          }}
        />
      )}
    </View>
  );
}
function OwnedRating({ storyId, username }: { storyId: string; username: string }) {
  const scope = usePrivateScope();
  const own = useQuery({
    queryKey: [...scope.prefix, 'rating', storyId],
    enabled: !!scope.userId,
    queryFn: ({ signal }) =>
      scope.run(async (ownedSignal) => {
        // No private rating endpoint exists. Exhaust public pagination before claiming absence.
        for (let page = 1; ; page++) {
          const result = await feedbackApi.ratings(storyId, page, ownedSignal, 100);
          const found = result.data.find((r) => r.user.username === username);
          if (found) return found;
          if (page >= result.pagination.totalPages) return null;
        }
      }, signal),
    staleTime: 0,
  });
  if (own.isPending) return <LoadingState label="Đang xác định đánh giá của bạn…" />;
  if (own.error)
    return (
      <ErrorState
        message={`Chưa xác định được đánh giá của bạn. ${safeError(own.error).message}`}
        onRetry={() => {
          void own.refetch();
        }}
      />
    );
  return (
    <RatingEditor
      key={own.data?.updatedAt ?? 'new'}
      storyId={storyId}
      current={own.data ?? null}
      refreshing={own.isFetching}
    />
  );
}
function RatingEditor({
  storyId,
  current,
  refreshing,
}: {
  storyId: string;
  current: Rating | null;
  refreshing: boolean;
}) {
  const [score, setScore] = useState(current?.score ?? 0);
  const [review, setReview] = useState(current?.reviewText ?? '');
  const [confirm, setConfirm] = useState(false);
  const action = useFeedbackAction(storyId);
  const save = () => {
    if (refreshing) return;
    const input = ratingInput.safeParse({ score, reviewText: review.trim() ? review : null });
    if (!input.success) {
      action.setError(
        'Chọn 1–5 sao. Nhận xét tối đa 2.000 ký tự, không chứa HTML hoặc ký tự điều khiển.',
      );
      return;
    }
    void action.run((signal) => feedbackApi.saveRating(storyId, input.data, signal));
  };
  return (
    <View style={styles.card}>
      <Text style={ui.heading}>{current ? 'Đánh giá của bạn' : 'Viết đánh giá'}</Text>
      <Stars value={score} onChange={setScore} disabled={action.busy || refreshing} />
      <Field
        label="Nhận xét (không bắt buộc)"
        value={review}
        onChange={setReview}
        maxLength={4000}
        disabled={action.busy || refreshing}
      />
      <Action
        label={current ? 'Cập nhật đánh giá' : 'Gửi đánh giá'}
        onPress={save}
        disabled={action.busy || refreshing}
        primary
      />
      {current && (
        <Action
          label="Xóa đánh giá của tôi"
          onPress={() => setConfirm(true)}
          disabled={action.busy || refreshing}
        />
      )}
      {action.error && <ErrorState message={action.error} />}
      <ConfirmDialog
        visible={confirm}
        busy={action.busy || refreshing}
        title="Xóa đánh giá của bạn?"
        message="Điểm và nhận xét của bạn sẽ được gỡ khỏi truyện."
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          void action.run(
            (signal) => feedbackApi.removeRating(storyId, signal),
            () => setConfirm(false),
          );
        }}
      />
    </View>
  );
}
