import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack, useLocalSearchParams } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor } from 'expo-router/testing-library';
import { act } from '@testing-library/react-native';
import { RefreshControl, Text } from 'react-native';
import Library from '../src/app/(tabs)/library';
import History from '../src/app/history';
import Login from '../src/app/login';
import { FavoriteButton } from '../src/features/library/FavoriteButton';
import { libraryApi } from '../src/features/library/api';
import { catalogApi } from '../src/features/stories/api';
import { readerApi } from '../src/features/reader/api';
import { authSession } from '../src/services/runtime';
import { ApiError } from '../src/lib/errors';
import { novel, chapter, result } from './catalog-fixtures';
import { favorite, progress, history } from './library-fixtures';
import { emptyProgress, savedProgress } from './reader-fixtures';
import { deferred, user } from './fixtures';
import type { Page } from '../src/features/stories/api';
import type { Favorite } from '../src/features/library/api';

jest.mock('../src/services/runtime', () => ({
  api: jest.requireActual('axios').default.create(),
  authTransport: { register: jest.fn() },
  authSession: {
    store: jest
      .requireActual('zustand/vanilla')
      .createStore(() => ({ status: 'guest', user: null, notice: null })),
    generation: jest.fn(() => 0),
    login: jest.fn(),
    logout: jest.fn(),
  },
}));
jest.mock('../src/features/library/api', () => ({
  ...jest.requireActual('../src/features/library/api'),
  libraryApi: {
    favorites: jest.fn(),
    progress: jest.fn(),
    history: jest.fn(),
    add: jest.fn(),
    remove: jest.fn(),
    clearHistory: jest.fn(),
  },
}));
jest.mock('../src/features/reader/api', () => ({
  ...jest.requireActual('../src/features/reader/api'),
  readerApi: { progress: jest.fn() },
}));
jest.mock('../src/features/stories/api', () => ({
  ...jest.requireActual('../src/features/stories/api'),
  catalogApi: { chapters: jest.fn() },
}));
const api = jest.mocked(libraryApi);
function FavoriteScreen() {
  return <FavoriteButton storyId={novel.id} />;
}
function Destination() {
  const params = useLocalSearchParams();
  return <Text>{`Reader ${params.id} ${params.storyId}`}</Text>;
}
function open(url = '/library') {
  const client = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 30_000 },
      mutations: { retry: false },
    },
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
      library: Library,
      history: History,
      login: Login,
      favorite: FavoriteScreen,
      'story/[id]': Destination,
      'reader/[id]': Destination,
    },
    { initialUrl: url },
  );
  return client;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(authSession.generation).mockReturnValue(0);
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.favorites.mockResolvedValue(result([favorite]));
  api.progress.mockResolvedValue(result([progress]));
  api.history.mockResolvedValue(result([history]));
  api.add.mockResolvedValue(favorite);
  api.remove.mockResolvedValue({ removed: true });
  api.clearHistory.mockResolvedValue({ deletedCount: 1 });
  jest.mocked(readerApi.progress).mockResolvedValue(savedProgress);
  jest.mocked(catalogApi.chapters).mockResolvedValue(result([chapter], 1, 1, 20));
});
test('Guest Library invites login without calling any private endpoint', async () => {
  authSession.store.setState({ status: 'guest', user: null });
  open();
  expect(await screen.findByText('Giữ lại câu chuyện yêu thích')).toBeVisible();
  expect(api.favorites).not.toHaveBeenCalled();
  expect(api.progress).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Đăng nhập để mở giá sách'));
  await waitFor(() => expect(screen).toHavePathname('/login'));
  expect(screen).toHaveSearchParams({ next: '/library' });
});
test('Guest History is protected and retains a safe return path', async () => {
  authSession.store.setState({ status: 'guest', user: null });
  open('/history');
  await waitFor(() => expect(screen).toHavePathname('/login'));
  expect(screen).toHaveSearchParams({ next: '/history' });
  expect(api.history).not.toHaveBeenCalled();
});
test('Favorites show actual metadata, load more and refresh', async () => {
  const second = {
    ...favorite,
    id: '40000000-0000-4000-8000-000000000009',
    storyId: '20000000-0000-4000-8000-000000000009',
    story: {
      ...favorite.story,
      id: '20000000-0000-4000-8000-000000000009',
      title: 'Truyện trang hai',
    },
  };
  api.favorites.mockImplementation(async (page) =>
    page === 1 ? result([favorite], 1, 13) : result([second], 2, 13),
  );
  open();
  expect(await screen.findByText(novel.title)).toBeVisible();
  fireEvent.press(screen.getByText('Tải thêm truyện'));
  expect(await screen.findByText('Truyện trang hai')).toBeVisible();
  const before = api.favorites.mock.calls.length;
  fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
  await waitFor(() => expect(api.favorites.mock.calls.length).toBeGreaterThan(before));
});
test('Favorite removal requires confirmation; cancel does not mutate', async () => {
  open();
  fireEvent.press(await screen.findByText(`Bỏ ${novel.title} khỏi giá sách`));
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Hủy'));
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText(`Bỏ ${novel.title} khỏi giá sách`));
  api.favorites.mockResolvedValue(result([]));
  fireEvent.press(screen.getByText('Xác nhận'));
  expect(await screen.findByText('Giá sách chưa có truyện')).toBeVisible();
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(api.clearHistory).not.toHaveBeenCalled();
});
test('Favorite status scans later pages before deciding absence and never POSTs an existing favorite', async () => {
  const later = deferred<Page<Favorite>>();
  api.favorites.mockImplementation((page) =>
    page === 1 ? Promise.resolve(result([], 1, 101, 100)) : later.promise,
  );
  open('/favorite');
  await waitFor(() => expect(api.favorites).toHaveBeenCalledWith(2, 100, expect.anything()));
  expect(screen.getByRole('button', { name: 'Đang kiểm tra giá sách…' })).toBeDisabled();
  await act(async () => later.resolve(result([favorite], 2, 101, 100)));
  expect(await screen.findByText('Bỏ khỏi giá sách')).toBeVisible();
  expect(api.add).not.toHaveBeenCalled();
});
test('Favorite add posts once and invalidates status after all pages confirm absence', async () => {
  api.favorites.mockResolvedValue(result([], 1, 0, 100));
  const pending = deferred<Favorite>();
  api.add.mockReturnValue(pending.promise);
  open('/favorite');
  const button = await screen.findByText('Lưu vào giá sách');
  fireEvent.press(button);
  fireEvent.press(button);
  await waitFor(() => expect(api.add).toHaveBeenCalledTimes(1));
  api.favorites.mockResolvedValue(result([favorite], 1, 1, 100));
  await act(async () => pending.resolve(favorite));
  expect(await screen.findByText('Bỏ khỏi giá sách')).toBeVisible();
});
test('409 Favorite conflict reloads status without automatically replaying POST', async () => {
  api.favorites.mockResolvedValue(result([], 1, 0, 100));
  api.add.mockRejectedValue(new ApiError(409, 'FAVORITE_EXISTS'));
  open('/favorite');
  const button = await screen.findByText('Lưu vào giá sách');
  api.favorites.mockResolvedValue(result([favorite], 1, 1, 100));
  fireEvent.press(button);
  expect(await screen.findByText('Bỏ khỏi giá sách')).toBeVisible();
  expect(api.add).toHaveBeenCalledTimes(1);
});
test('Guest Favorite opens Login with the Story return path and makes no private request', async () => {
  authSession.store.setState({ status: 'guest', user: null });
  open('/favorite');
  fireEvent.press(screen.getByText('Lưu vào giá sách'));
  await waitFor(() => expect(screen).toHavePathname('/login'));
  expect(screen).toHaveSearchParams({ next: `/story/${novel.id}` });
  expect(api.favorites).not.toHaveBeenCalled();
});
test('Continue Reading lists progress without writes and checks the latest position before navigating', async () => {
  open();
  fireEvent.press(screen.getByLabelText('Giá sách: Đang đọc'));
  expect(await screen.findByText('25% trong chương đã lưu')).toBeVisible();
  expect(readerApi.progress).not.toHaveBeenCalled();
  expect(api.add).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Tiếp tục đọc'));
  await waitFor(() => expect(screen).toHavePathname(`/reader/${chapter.id}`));
  expect(screen).toHaveSearchParams({ id: chapter.id, storyId: novel.id });
  expect(readerApi.progress).toHaveBeenCalledWith(novel.id, expect.anything());
});
test('Continue Reading falls back to first published chapter when the saved chapter is hidden', async () => {
  jest
    .mocked(readerApi.progress)
    .mockResolvedValue({ ...emptyProgress, version: savedProgress.version });
  open();
  fireEvent.press(screen.getByLabelText('Giá sách: Đang đọc'));
  fireEvent.press(await screen.findByText('Tiếp tục đọc'));
  await waitFor(() => expect(screen).toHavePathname(`/reader/${chapter.id}`));
  expect(catalogApi.chapters).toHaveBeenCalledWith(novel.id, 1, expect.anything());
});
test('Continue Reading reports when no public chapter remains', async () => {
  jest.mocked(readerApi.progress).mockResolvedValue(emptyProgress);
  jest.mocked(catalogApi.chapters).mockResolvedValue(result([], 1, 0, 20));
  open();
  fireEvent.press(screen.getByLabelText('Giá sách: Đang đọc'));
  fireEvent.press(await screen.findByText('Tiếp tục đọc'));
  expect(await screen.findByText('Chưa có chương công khai để tiếp tục.')).toBeVisible();
  expect(screen).toHavePathname('/library');
});
test('History displays chapter/time and opens the exact historical chapter', async () => {
  open('/history');
  expect(
    await screen.findByText(`Chương ${chapter.chapterNumber} · ${chapter.title}`),
  ).toBeVisible();
  fireEvent.press(screen.getByText(`Đọc lại chương ${chapter.chapterNumber}`));
  await waitFor(() => expect(screen).toHavePathname(`/reader/${chapter.id}`));
});
test('clear History is confirmation-only and never deletes Favorites or Progress', async () => {
  open('/history');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Xóa lịch sử đọc' })).not.toBeDisabled(),
  );
  fireEvent.press(await screen.findByText('Xóa lịch sử đọc'));
  fireEvent.press(screen.getByText('Hủy'));
  expect(api.clearHistory).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Xóa lịch sử đọc'));
  api.history.mockResolvedValue(result([]));
  fireEvent.press(screen.getByText('Xác nhận'));
  expect(await screen.findByText('Chưa có lịch sử đọc')).toBeVisible();
  expect(api.clearHistory).toHaveBeenCalledTimes(1);
  expect(api.remove).not.toHaveBeenCalled();
});
test('private errors provide retry without exposing server detail', async () => {
  api.favorites.mockRejectedValue(new ApiError(403, 'Bạn không có quyền thực hiện thao tác này.'));
  open();
  expect(await screen.findByText('Bạn không có quyền thực hiện thao tác này.')).toBeVisible();
  api.favorites.mockResolvedValue(result([favorite]));
  fireEvent.press(screen.getByText('Thử lại'));
  expect(await screen.findByText(novel.title)).toBeVisible();
});
test('session expiry hides private data immediately', async () => {
  open();
  await screen.findByText(novel.title);
  act(() => {
    jest.mocked(authSession.generation).mockReturnValue(1);
    authSession.store.setState({ status: 'guest', user: null, notice: 'Phiên đã hết hạn.' });
  });
  expect(await screen.findByText('Giữ lại câu chuyện yêu thích')).toBeVisible();
  expect(screen.queryByText(novel.title)).toBeNull();
});
test('late account-A response is rejected after switching to account B', async () => {
  const late = deferred<Page<Favorite>>();
  api.favorites.mockReturnValueOnce(late.promise);
  open();
  await waitFor(() => expect(api.favorites).toHaveBeenCalled());
  api.favorites.mockResolvedValue(result([]));
  act(() => {
    jest.mocked(authSession.generation).mockReturnValue(1);
    authSession.store.setState({
      status: 'authenticated',
      user: { ...user, id: '10000000-0000-4000-8000-000000000002' },
    });
  });
  await screen.findByText('Giá sách chưa có truyện');
  await act(async () => late.resolve(result([favorite])));
  expect(screen.queryByText(novel.title)).toBeNull();
  expect(screen.getByText('Giá sách chưa có truyện')).toBeVisible();
});
test('empty visible History still permits confirmed deletion of server history filtered from the list', async () => {
  api.history.mockResolvedValue(result([]));
  open('/history');
  await screen.findByText('Chưa có lịch sử đọc');
  fireEvent.press(screen.getByText('Xóa lịch sử đọc'));
  expect(api.clearHistory).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Xác nhận'));
  await waitFor(() => expect(api.clearHistory).toHaveBeenCalledTimes(1));
});
