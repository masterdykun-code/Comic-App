import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor, act } from 'expo-router/testing-library';
import { Text } from 'react-native';
import Feedback from '../src/app/feedback/[id]';
import Profile from '../src/app/(tabs)/profile';
import { feedbackApi } from '../src/features/feedback/api';
import { authSession } from '../src/services/runtime';
import { ApiError } from '../src/lib/errors';
import { user, deferred } from './fixtures';
import { novel } from './catalog-fixtures';
import { comment, reply, thread, rating, ratingPage, feedbackPage } from './feedback-fixtures';
jest.mock('../src/services/runtime', () => {
  const store = jest
    .requireActual('zustand/vanilla')
    .createStore(() => ({ status: 'guest', user: null, notice: null }));
  return {
    api: jest.requireActual('axios').default.create(),
    authSession: { store, generation: jest.fn(() => 0), logout: jest.fn() },
  };
});
jest.mock('../src/features/feedback/api', () => ({
  ...jest.requireActual('../src/features/feedback/api'),
  feedbackApi: {
    ratings: jest.fn(),
    comments: jest.fn(),
    replies: jest.fn(),
    saveRating: jest.fn(),
    removeRating: jest.fn(),
    createComment: jest.fn(),
    editComment: jest.fn(),
    removeComment: jest.fn(),
    me: jest.fn(),
    updateProfile: jest.fn(),
  },
}));
const api = jest.mocked(feedbackApi);
function Login() {
  return <Text>Đích đăng nhập</Text>;
}
function open(url = `/feedback/${novel.id}`) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false } },
  });
  function Layout() {
    return (
      <QueryClientProvider client={client}>
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    );
  }
  renderRouter(
    {
      _layout: Layout,
      'feedback/[id]': Feedback,
      profile: Profile,
      login: Login,
      'story/[id]': Login,
    },
    { initialUrl: url },
  );
  return client;
}
function login() {
  authSession.store.setState({ status: 'authenticated', user, notice: null });
}
beforeEach(() => {
  jest.clearAllMocks();
  authSession.store.setState({ status: 'guest', user: null, notice: null });
  api.ratings.mockImplementation(async (_id, _page, _signal, limit) =>
    ratingPage(limit === 100 ? [] : [rating]),
  );
  api.comments.mockResolvedValue(feedbackPage([thread]));
  api.replies.mockResolvedValue(feedbackPage([reply]));
  api.saveRating.mockResolvedValue(rating);
  api.removeRating.mockResolvedValue({ removed: true });
  api.createComment.mockResolvedValue(comment);
  api.editComment.mockResolvedValue(comment);
  api.removeComment.mockResolvedValue({ removed: true });
  api.me.mockResolvedValue({ ...user, status: 'ACTIVE' });
  api.updateProfile.mockResolvedValue({
    ...user,
    status: 'ACTIVE',
    displayName: 'Tên mới',
    updatedAt: '2026-10-18T00:00:00Z',
  });
});
test('guest sees rating average, distribution, comments and inline replies without private reads', async () => {
  open();
  expect(await screen.findByText('4.00 / 5')).toBeVisible();
  expect(screen.getByText('4 sao · 1')).toBeVisible();
  expect(await screen.findByText(reply.content)).toBeVisible();
  expect(screen.queryByText('Gửi đánh giá')).toBeNull();
  expect(screen.queryByText('Sửa bình luận')).toBeNull();
  expect(api.ratings.mock.calls.every((args) => args[3] !== 100)).toBe(true);
  expect(api.me).not.toHaveBeenCalled();
});
test('guest action redirects to Login with exact validated return route', async () => {
  open();
  fireEvent.press(await screen.findByText('Đăng nhập để đánh giá'));
  await waitFor(() => expect(screen).toHavePathname('/login'));
  expect(screen).toHaveSearchParams({ next: `/feedback/${novel.id}` });
  expect(api.saveRating).not.toHaveBeenCalled();
});
test('invalid story UUID never fetches feedback', () => {
  open('/feedback/invalid');
  expect(screen.getByText('Liên kết truyện không hợp lệ.')).toBeVisible();
  expect(api.ratings).not.toHaveBeenCalled();
  expect(api.comments).not.toHaveBeenCalled();
});
test('rating pagination retrieves second page instead of replacing page one', async () => {
  api.ratings.mockImplementation(async (_id, page) =>
    ratingPage(
      [
        {
          ...rating,
          id: page === 2 ? reply.id : rating.id,
          reviewText: page === 2 ? 'Trang hai' : 'Trang một',
        },
      ],
      page,
      21,
    ),
  );
  open();
  fireEvent.press(await screen.findByText('Tải thêm đánh giá'));
  expect(await screen.findByText('Trang hai')).toBeVisible();
  expect(screen.getByText('Trang một')).toBeVisible();
});
test('rating form stays closed until all pages establish absence; later own rating is prefilled', async () => {
  login();
  const pending = deferred<ReturnType<typeof ratingPage>>();
  api.ratings.mockImplementation(async (_id, page, _signal, limit) =>
    limit !== 100 ? ratingPage([]) : page === 1 ? ratingPage([], 1, 101, 100) : pending.promise,
  );
  open();
  await waitFor(() =>
    expect(api.ratings).toHaveBeenCalledWith(novel.id, 2, expect.anything(), 100),
  );
  expect(screen.queryByText('Gửi đánh giá')).toBeNull();
  await act(async () => pending.resolve(ratingPage([rating], 2, 101, 100)));
  expect(await screen.findByText('Cập nhật đánh giá')).toBeVisible();
  expect(screen.getByLabelText('Nhận xét (không bắt buộc)').props.value).toBe(rating.reviewText);
  expect(api.saveRating).not.toHaveBeenCalled();
});
test('failed own-rating lookup never enables a potentially destructive overwrite', async () => {
  login();
  api.ratings.mockImplementation(async (_id, _page, _signal, limit) => {
    if (limit === 100) throw new ApiError(0, 'Mất mạng');
    return ratingPage([]);
  });
  open();
  expect(await screen.findByText(/Chưa xác định được đánh giá/)).toBeVisible();
  expect(screen.queryByText('Gửi đánh giá')).toBeNull();
});
test('new rating validates stars and sends once without identity fields', async () => {
  login();
  const pending = deferred<typeof rating>();
  api.saveRating.mockReturnValue(pending.promise);
  open();
  fireEvent.press(await screen.findByText('Gửi đánh giá'));
  expect(api.saveRating).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('5 sao'));
  fireEvent.changeText(screen.getByLabelText('Nhận xét (không bắt buộc)'), ' Rất hay ');
  fireEvent.press(screen.getByText('Gửi đánh giá'));
  fireEvent.press(screen.getByText('Gửi đánh giá'));
  await waitFor(() => expect(api.saveRating).toHaveBeenCalledTimes(1));
  expect(api.saveRating).toHaveBeenCalledWith(
    novel.id,
    { score: 5, reviewText: 'Rất hay' },
    expect.anything(),
  );
  await act(async () => pending.resolve(rating));
});
test('updates an existing rating and invalidates aggregate/list queries', async () => {
  login();
  api.ratings.mockResolvedValue(ratingPage());
  const client = open();
  const invalidate = jest.spyOn(client, 'invalidateQueries');
  fireEvent.press(await screen.findByText('Cập nhật đánh giá'));
  await waitFor(() =>
    expect(api.saveRating).toHaveBeenCalledWith(
      novel.id,
      { score: 4, reviewText: rating.reviewText },
      expect.anything(),
    ),
  );
  await waitFor(() =>
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['public', 'feedback', novel.id] }),
  );
});
test('rating deletion needs explicit confirmation and cancel makes no request', async () => {
  login();
  api.ratings.mockResolvedValue(ratingPage());
  open();
  fireEvent.press(await screen.findByText('Xóa đánh giá của tôi'));
  fireEvent.press(screen.getByText('Hủy'));
  expect(api.removeRating).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Xóa đánh giá của tôi'));
  fireEvent.press(screen.getByText('Xác nhận'));
  await waitFor(() => expect(api.removeRating).toHaveBeenCalledTimes(1));
});
test('comments paginate while preserving previous root', async () => {
  api.comments.mockImplementation(async (_id, page) =>
    feedbackPage(
      [
        {
          ...thread,
          id: page === 2 ? rating.id : comment.id,
          content: page === 2 ? 'Bình luận trang hai' : comment.content,
          replies: [],
        },
      ],
      page,
      21,
    ),
  );
  open();
  fireEvent.press(await screen.findByText('Tải thêm bình luận'));
  expect(await screen.findByText('Bình luận trang hai')).toBeVisible();
  expect(screen.getByText(comment.content)).toBeVisible();
});
test('loads all replies using separate oldest-first pages without nesting another reply action', async () => {
  api.comments.mockResolvedValue(
    feedbackPage([
      {
        ...thread,
        replies: [],
        repliesPagination: { page: 1, limit: 20, total: 21, totalPages: 2 },
      },
    ]),
  );
  api.replies.mockImplementation(async (_id, _story, page) =>
    feedbackPage(
      [
        {
          ...reply,
          id: page === 2 ? rating.id : reply.id,
          content: page === 2 ? 'Phản hồi trang hai' : reply.content,
        },
      ],
      page,
      21,
    ),
  );
  login();
  open();
  fireEvent.press(await screen.findByText('Xem 21 phản hồi'));
  fireEvent.press(await screen.findByText('Tải thêm phản hồi'));
  expect(await screen.findByText('Phản hồi trang hai')).toBeVisible();
  expect(screen.getAllByText('Trả lời')).toHaveLength(1);
});
test('creates a root comment with plain text/newlines and no parentId', async () => {
  login();
  open();
  fireEvent.changeText(screen.getByLabelText('Nội dung bình luận'), ' Dòng một\nDòng hai ');
  fireEvent.press(screen.getByText('Gửi bình luận'));
  await waitFor(() =>
    expect(api.createComment).toHaveBeenCalledWith(
      novel.id,
      { content: 'Dòng một\nDòng hai' },
      expect.anything(),
    ),
  );
});
test('replies only target a root and include only root parentId', async () => {
  login();
  open();
  fireEvent.press(await screen.findByText('Trả lời'));
  fireEvent.changeText(screen.getByLabelText('Nội dung phản hồi'), 'Cảm ơn bạn');
  fireEvent.press(screen.getByText('Gửi phản hồi'));
  await waitFor(() =>
    expect(api.createComment).toHaveBeenCalledWith(
      novel.id,
      { content: 'Cảm ơn bạn', parentId: comment.id },
      expect.anything(),
    ),
  );
});
test('only matching immutable username gets edit/delete controls; another reader reply has none', async () => {
  login();
  open();
  expect(await screen.findByText('Sửa bình luận')).toBeVisible();
  expect(screen.getAllByText('Sửa bình luận')).toHaveLength(1);
  expect(screen.getAllByText('Xóa bình luận')).toHaveLength(1);
  fireEvent.press(screen.getByText('Sửa bình luận'));
  fireEvent.changeText(screen.getByLabelText('Nội dung chỉnh sửa'), 'Nội dung mới');
  fireEvent.press(screen.getByText('Lưu bình luận'));
  await waitFor(() =>
    expect(api.editComment).toHaveBeenCalledWith(comment.id, 'Nội dung mới', expect.anything()),
  );
});
test('deleting own comment is confirmed; HTTP 409 explains replies, including hidden ones', async () => {
  login();
  api.removeComment.mockRejectedValue(new ApiError(409, 'conflict'));
  open();
  fireEvent.press(await screen.findByText('Xóa bình luận'));
  expect(api.removeComment).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Xác nhận'));
  expect(await screen.findByText(/Bình luận có thể có phản hồi/)).toBeVisible();
  expect(api.removeComment).toHaveBeenCalledTimes(1);
});
test('rate limited comment shows wait message and is not retried automatically', async () => {
  login();
  api.createComment.mockRejectedValue(
    new ApiError(429, 'Bạn thao tác quá nhanh. Vui lòng đợi một lúc.'),
  );
  open();
  fireEvent.changeText(screen.getByLabelText('Nội dung bình luận'), 'Bình luận mới');
  fireEvent.press(screen.getByText('Gửi bình luận'));
  expect(await screen.findByText(/Bạn thao tác quá nhanh/)).toBeVisible();
  expect(api.createComment).toHaveBeenCalledTimes(1);
});
test('invalid HTML comment never submits', () => {
  login();
  open();
  fireEvent.changeText(screen.getByLabelText('Nội dung bình luận'), '<script>x</script>');
  fireEvent.press(screen.getByText('Gửi bình luận'));
  expect(api.createComment).not.toHaveBeenCalled();
});
test('network error gives retry; session expiry removes all write controls', async () => {
  api.comments.mockRejectedValueOnce(new ApiError(0, 'Mất kết nối'));
  login();
  open();
  expect(await screen.findByText('Mất kết nối')).toBeVisible();
  fireEvent.press(screen.getByText('Thử lại'));
  expect(await screen.findByText(comment.content)).toBeVisible();
  await act(async () => authSession.store.setState({ status: 'guest', user: null, notice: null }));
  expect(screen.queryByText('Gửi bình luận')).toBeNull();
  expect(screen.queryByText('Sửa bình luận')).toBeNull();
});
test('profile displays identity/status and preloads allowed fields via owned GET me', async () => {
  login();
  open('/profile');
  expect(screen.getByText(user.email)).toBeVisible();
  expect(screen.getByText('Trạng thái · Đang hoạt động')).toBeVisible();
  fireEvent.press(screen.getByText('Chỉnh sửa hồ sơ'));
  const field = await screen.findByLabelText('Tên hiển thị');
  expect(field.props.value).toBe(user.displayName);
  expect(screen.queryByLabelText('role')).toBeNull();
});
test('profile update sends only allowed fields and updates store plus private cache', async () => {
  login();
  const client = open('/profile');
  fireEvent.press(screen.getByText('Chỉnh sửa hồ sơ'));
  fireEvent.changeText(await screen.findByLabelText('Tên hiển thị'), ' Tên mới ');
  fireEvent.press(screen.getByText('Lưu hồ sơ'));
  await waitFor(() => expect(authSession.store.getState().user?.displayName).toBe('Tên mới'));
  expect(api.updateProfile).toHaveBeenCalledWith(
    { displayName: 'Tên mới', avatarUrl: null },
    expect.anything(),
  );
  expect(client.getQueryData(['private', user.id, 0, 'profile'])).toMatchObject({
    displayName: 'Tên mới',
  });
});
test('profile rejects unsupported avatar protocol before submitting', async () => {
  login();
  open('/profile');
  fireEvent.press(screen.getByText('Chỉnh sửa hồ sơ'));
  fireEvent.changeText(await screen.findByLabelText('URL ảnh đại diện'), 'file:///private');
  fireEvent.press(screen.getByText('Lưu hồ sơ'));
  expect(api.updateProfile).not.toHaveBeenCalled();
  expect(screen.getByText(/Tên hiển thị cần 1–100/)).toBeVisible();
});
test('late profile response cannot overwrite the next account and receives an aborted signal', async () => {
  login();
  const pending = deferred<Awaited<ReturnType<typeof feedbackApi.updateProfile>>>();
  api.updateProfile.mockReturnValue(pending.promise);
  open('/profile');
  fireEvent.press(screen.getByText('Chỉnh sửa hồ sơ'));
  await screen.findByLabelText('Tên hiển thị');
  fireEvent.press(screen.getByText('Lưu hồ sơ'));
  await waitFor(() => expect(api.updateProfile).toHaveBeenCalledTimes(1));
  const next = { ...user, id: reply.id, username: 'other', displayName: 'Tài khoản tiếp theo' };
  await act(async () =>
    authSession.store.setState({ status: 'authenticated', user: next, notice: null }),
  );
  await act(async () =>
    pending.resolve({ ...user, status: 'ACTIVE', displayName: 'KHÔNG HIỂN THỊ' }),
  );
  expect(authSession.store.getState().user).toEqual(next);
  expect(api.updateProfile.mock.calls[0][1]?.aborted).toBe(true);
  expect(screen.queryByText('KHÔNG HIỂN THỊ')).toBeNull();
});
test('switching account resets comment drafts and never submits the previous draft', async () => {
  login();
  open();
  fireEvent.changeText(screen.getByLabelText('Nội dung bình luận'), 'Bản nháp riêng');
  await act(async () =>
    authSession.store.setState({
      status: 'authenticated',
      user: { ...user, id: reply.id, username: 'other' },
      notice: null,
    }),
  );
  expect(screen.getByLabelText('Nội dung bình luận').props.value).toBe('');
  expect(api.createComment).not.toHaveBeenCalled();
});
