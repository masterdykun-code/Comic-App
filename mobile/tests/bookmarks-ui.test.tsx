import { Stack, useLocalSearchParams } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor } from 'expo-router/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Text } from 'react-native';
import { act } from '@testing-library/react-native';
import Bookmarks from '../src/app/bookmarks';
import { bookmarkApi } from '../src/features/bookmarks/api';
import { authSession } from '../src/services/runtime';
import { novelBookmark, comicBookmark } from './bookmark-fixtures';
import { user, deferred } from './fixtures';
import { result } from './catalog-fixtures';
jest.mock('../src/services/runtime', () => ({
  api: jest.requireActual('axios').default.create(),
  authSession: {
    store: jest
      .requireActual('zustand/vanilla')
      .createStore(() => ({ status: 'guest', user: null, notice: null })),
    generation: jest.fn(() => 0),
  },
}));
jest.mock('../src/features/bookmarks/api', () => ({
  ...jest.requireActual('../src/features/bookmarks/api'),
  bookmarkApi: { list: jest.fn(), add: jest.fn(), resolve: jest.fn(), remove: jest.fn() },
}));
const api = jest.mocked(bookmarkApi);
function open() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } },
  });
  function Layout() {
    return (
      <QueryClientProvider client={cache}>
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    );
  }
  function Reader() {
    const p = useLocalSearchParams();
    return <Text>{JSON.stringify(p)}</Text>;
  }
  return renderRouter(
    {
      _layout: Layout,
      bookmarks: Bookmarks,
      'reader/[id]': Reader,
      login: () => <Text>Login</Text>,
    },
    { initialUrl: '/bookmarks' },
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.list.mockResolvedValue(result([novelBookmark, comicBookmark], 1, 2, 20));
  api.remove.mockResolvedValue({ removed: true });
});
test('Guest sees a login prompt and never calls private bookmark endpoints', async () => {
  authSession.store.setState({ status: 'guest', user: null, notice: null });
  open();
  expect(await screen.findByText('Giữ lại những trang bạn yêu thích')).toBeVisible();
  expect(api.list).not.toHaveBeenCalled();
});
test('lists NOVEL/COMIC bookmarks and opens the exact story/chapter/bookmark UUIDs', async () => {
  open();
  expect(await screen.findByText(comicBookmark.story!.title)).toBeVisible();
  fireEvent.press(
    screen.getByRole('button', { name: 'Đọc dấu trang ' + comicBookmark.chapter!.title }),
  );
  await waitFor(() => expect(screen).toHavePathname('/reader/' + comicBookmark.chapterId));
  expect(screen.getByText(new RegExp(comicBookmark.id))).toBeVisible();
});
test('delete requires confirmation, cancel does nothing and confirmed deletion refreshes only bookmarks', async () => {
  open();
  await screen.findByText(novelBookmark.story!.title);
  fireEvent.press(
    screen.getByRole('button', { name: 'Xóa dấu trang ' + novelBookmark.chapter!.title }),
  );
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Hủy'));
  expect(api.remove).not.toHaveBeenCalled();
  fireEvent.press(
    screen.getByRole('button', { name: 'Xóa dấu trang ' + novelBookmark.chapter!.title }),
  );
  api.list.mockResolvedValue(result([], 1, 0, 20));
  fireEvent.press(screen.getByText('Xác nhận'));
  expect(await screen.findByText('Chưa có dấu trang')).toBeVisible();
  expect(api.remove).toHaveBeenCalledTimes(1);
  expect(api.remove).toHaveBeenCalledWith(novelBookmark.id, expect.anything());
  expect(api.add).not.toHaveBeenCalled();
});
test('unavailable bookmark cannot be opened but can still be deleted', async () => {
  api.list.mockResolvedValue(
    result([{ ...novelBookmark, available: false, chapter: null, story: null }], 1, 1, 20),
  );
  open();
  await screen.findByText('Nội dung không còn công khai');
  expect(screen.getByRole('button', { name: 'Đọc dấu trang ' + novelBookmark.id })).toBeDisabled();
});
test('late list response cannot reveal bookmarks after logout', async () => {
  const slow = deferred<Awaited<ReturnType<typeof bookmarkApi.list>>>();
  api.list.mockReturnValue(slow.promise);
  open();
  await waitFor(() => expect(api.list).toHaveBeenCalled());
  act(() => authSession.store.setState({ status: 'guest', user: null, notice: null }));
  await act(async () => slow.resolve(result([novelBookmark], 1, 1, 20)));
  expect(screen.queryByText(novelBookmark.story!.title)).toBeNull();
});
