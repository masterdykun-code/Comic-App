import { useState } from 'react';
import { Link } from 'expo-router';
import { Text, View } from 'react-native';
import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '../../hooks/use-auth';
import { authSession } from '../../services/runtime';
import { safeError } from '../../lib/errors';
import { EmptyState, ErrorState, LoadingState } from '../../components/States';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Action, ui } from '../stories/ui';
import { feedbackApi, commentInput, type Comment, type Thread } from './api';
import { Author, Field, useFeedbackAction, feedbackStyles as styles } from './shared';
export function Comments({ storyId }: { storyId: string }) {
  const auth = useAuth();
  const active = auth.status === 'authenticated' && auth.user?.status === 'ACTIVE';
  const list = useInfiniteQuery({
    queryKey: ['public', 'feedback', storyId, 'comments'],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => feedbackApi.comments(storyId, pageParam, signal),
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
  });
  return (
    <View style={ui.group}>
      <Text style={ui.heading} accessibilityRole="header">
        Trò chuyện về câu chuyện
      </Text>
      {active ? (
        <CommentForm key={`${auth.user!.id}:${authSession.generation()}`} storyId={storyId} />
      ) : (
        <LoginLink storyId={storyId} />
      )}
      {list.isPending && <LoadingState label="Đang tải bình luận…" />}
      {list.error && (
        <ErrorState
          message={safeError(list.error).message}
          onRetry={() => {
            void list.refetch();
          }}
        />
      )}
      {list.data?.pages[0].pagination.total === 0 && (
        <EmptyState title="Chưa có bình luận" message="Bắt đầu cuộc trò chuyện về truyện này." />
      )}
      {list.data?.pages
        .flatMap((p) => p.data)
        .filter((r, i, rows) => rows.findIndex((x) => x.id === r.id) === i)
        .map((root) => (
          <ThreadCard key={root.id} root={root} />
        ))}
      {list.hasNextPage && (
        <Action
          label="Tải thêm bình luận"
          disabled={list.isFetchingNextPage}
          onPress={() => {
            void list.fetchNextPage();
          }}
        />
      )}
    </View>
  );
}
function LoginLink({ storyId }: { storyId: string }) {
  return (
    <Link
      href={{ pathname: '/login', params: { next: `/feedback/${storyId}` } }}
      style={ui.actionText}
    >
      Đăng nhập để bình luận
    </Link>
  );
}
function ThreadCard({ root }: { root: Thread }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={ui.group}>
      <CommentCard comment={root} />
      <Text style={ui.caption}>{root.repliesPagination.total} phản hồi</Text>
      <View style={styles.reply}>
        {!open ? (
          <>
            {root.replies.map((reply) => (
              <CommentCard key={reply.id} comment={reply} />
            ))}
            {root.repliesPagination.total > root.replies.length && (
              <Action
                label={`Xem ${root.repliesPagination.total} phản hồi`}
                onPress={() => setOpen(true)}
              />
            )}
          </>
        ) : (
          <Replies root={root} />
        )}
      </View>
    </View>
  );
}
function Replies({ root }: { root: Thread }) {
  const list = useInfiniteQuery({
    queryKey: ['public', 'feedback', root.storyId, 'replies', root.id],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      feedbackApi.replies(root.id, root.storyId, pageParam, signal),
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.totalPages ? last.pagination.page + 1 : undefined,
  });
  return (
    <>
      {list.isPending && <LoadingState label="Đang tải phản hồi…" />}
      {list.error && (
        <ErrorState
          message={safeError(list.error).message}
          onRetry={() => {
            void list.refetch();
          }}
        />
      )}
      {list.data?.pages
        .flatMap((p) => p.data)
        .filter((r, i, rows) => rows.findIndex((x) => x.id === r.id) === i)
        .map((r) => (
          <CommentCard key={r.id} comment={r} />
        ))}
      {list.hasNextPage && (
        <Action
          label="Tải thêm phản hồi"
          disabled={list.isFetchingNextPage}
          onPress={() => {
            void list.fetchNextPage();
          }}
        />
      )}
    </>
  );
}
function CommentCard({ comment }: { comment: Comment }) {
  const auth = useAuth();
  const identity = `${auth.user?.id ?? 'guest'}:${authSession.generation()}`;
  return <CommentContent key={identity} comment={comment} />;
}
function CommentContent({ comment }: { comment: Comment }) {
  const auth = useAuth();
  const active = auth.status === 'authenticated' && auth.user?.status === 'ACTIVE';
  const own = active && auth.user?.username === comment.user.username;
  const [edit, setEdit] = useState(false);
  const [reply, setReply] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const action = useFeedbackAction(comment.storyId);
  return (
    <View style={styles.card}>
      <Author user={comment.user} />
      <Text style={ui.body}>{comment.content}</Text>
      <Text style={ui.caption}>{new Date(comment.createdAt).toLocaleString('vi-VN')}</Text>
      {own && (
        <View style={ui.wrap}>
          <Action label="Sửa bình luận" disabled={action.busy} onPress={() => setEdit(!edit)} />
          <Action label="Xóa bình luận" disabled={action.busy} onPress={() => setConfirm(true)} />
        </View>
      )}
      {edit && own && (
        <CommentForm storyId={comment.storyId} current={comment} onDone={() => setEdit(false)} />
      )}
      {comment.parentId === null &&
        (active ? (
          <>
            <Action label={reply ? 'Đóng phản hồi' : 'Trả lời'} onPress={() => setReply(!reply)} />
            {reply && (
              <CommentForm
                storyId={comment.storyId}
                parentId={comment.id}
                onDone={() => setReply(false)}
              />
            )}
          </>
        ) : (
          <LoginLink storyId={comment.storyId} />
        ))}
      {action.error && <ErrorState message={action.error} />}
      <ConfirmDialog
        visible={own && confirm}
        busy={action.busy}
        title="Xóa bình luận của bạn?"
        message="Bình luận có phản hồi sẽ không thể xóa."
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          void action
            .run(
              (signal) => feedbackApi.removeComment(comment.id, signal),
              () => setConfirm(false),
              true,
            )
            .then(() => setConfirm(false));
        }}
      />
    </View>
  );
}
function CommentForm({
  storyId,
  parentId,
  current,
  onDone,
}: {
  storyId: string;
  parentId?: string;
  current?: Comment;
  onDone?: () => void;
}) {
  const [content, setContent] = useState(current?.content ?? '');
  const action = useFeedbackAction(storyId);
  const label = current
    ? 'Nội dung chỉnh sửa'
    : parentId
      ? 'Nội dung phản hồi'
      : 'Nội dung bình luận';
  return (
    <View style={ui.group}>
      <Field
        label={label}
        value={content}
        onChange={setContent}
        maxLength={6000}
        disabled={action.busy}
      />
      <Action
        primary
        label={current ? 'Lưu bình luận' : parentId ? 'Gửi phản hồi' : 'Gửi bình luận'}
        disabled={action.busy}
        onPress={() => {
          const input = commentInput.safeParse({ content, ...(parentId ? { parentId } : {}) });
          if (!input.success) {
            action.setError(
              'Nội dung cần từ 1–3.000 ký tự, không chứa HTML, ký tự điều khiển hoặc chỉ ký tự vô hình.',
            );
            return;
          }
          void action.run(
            (signal) =>
              current
                ? feedbackApi.editComment(current.id, input.data.content, signal)
                : feedbackApi.createComment(storyId, input.data, signal),
            () => {
              setContent('');
              onDone?.();
            },
          );
        }}
      />
      {action.error && <ErrorState message={action.error} />}
    </View>
  );
}
