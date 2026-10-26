import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor } from 'expo-router/testing-library';
import { act } from '@testing-library/react-native';
import { FlatList, Text } from 'react-native';
import Rankings from '../src/app/rankings';
import { rankingsApi } from '../src/features/rankings/api';
import { rankedNovel, rankedComic, rankingResult } from './rankings-fixtures';
import { ApiError } from '../src/lib/errors';
import { deferred } from './fixtures';
jest.mock('../src/services/runtime', () => ({ api: jest.requireActual('axios').default.create() }));
jest.mock('../src/features/rankings/api', () => ({
  ...jest.requireActual('../src/features/rankings/api'),
  rankingsApi: { list: jest.fn() },
}));
const api = jest.mocked(rankingsApi);
beforeEach(() => {
  jest.clearAllMocks();
  api.list.mockResolvedValue(rankingResult([rankedNovel, rankedComic]));
});
function open() {
  const cache = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30000 } },
  });
  function Layout() {
    return (
      <QueryClientProvider client={cache}>
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    );
  }
  renderRouter(
    {
      _layout: Layout,
      rankings: Rankings,
      'story/[id]': () => <Text>Chi tiết được mở</Text>,
      index: () => <Text>Trang chủ</Text>,
    },
    { initialUrl: '/rankings' },
  );
  return cache;
}
test('guest sees ranks, covers, both story types and read metrics', async () => {
  open();
  expect(await screen.findByText(rankedNovel.title)).toBeVisible();
  expect(screen.getByLabelText(`Ảnh bìa ${rankedNovel.title}`)).toBeVisible();
  expect(screen.getByRole('button', { name: `Hạng 2: ${rankedComic.title}` })).toBeVisible();
  expect(screen.getByText('30 lượt đọc ghi nhận')).toBeVisible();
  expect(screen.getByText(/Không tính khách/)).toBeVisible();
  expect(api.list).toHaveBeenCalledWith('reads', '', 1, expect.anything());
});
test('switches all three boards and NOVEL/COMIC filters', async () => {
  api.list.mockImplementation(async (kind, type) =>
    rankingResult(type === 'COMIC' ? [{ ...rankedComic, rank: 1 }] : [rankedNovel], kind),
  );
  open();
  await screen.findByText(rankedNovel.title);
  fireEvent.press(screen.getByLabelText('Bảng xếp hạng: Top đánh giá'));
  expect(await screen.findByText('4,5/5 · 2 đánh giá')).toBeVisible();
  fireEvent.press(screen.getByLabelText('Bảng xếp hạng: Mới cập nhật'));
  expect(await screen.findByText(/Cập nhật.*24\/10/)).toBeVisible();
  fireEvent.press(screen.getByLabelText('Loại truyện: Truyện tranh'));
  await waitFor(() =>
    expect(api.list).toHaveBeenLastCalledWith('updated', 'COMIC', 1, expect.anything()),
  );
  expect(await screen.findByText(rankedComic.title)).toBeVisible();
  expect(screen.queryByText(rankedNovel.title)).toBeNull();
  fireEvent.press(screen.getByLabelText('Loại truyện: Tiểu thuyết'));
  await waitFor(() =>
    expect(api.list).toHaveBeenLastCalledWith('updated', 'NOVEL', 1, expect.anything()),
  );
});
test('tapping a ranked story navigates to its actual UUID', async () => {
  open();
  fireEvent.press(await screen.findByRole('button', { name: `Hạng 1: ${rankedNovel.title}` }));
  await waitFor(() => expect(screen).toHavePathname(`/story/${rankedNovel.id}`));
  expect(screen.getByText('Chi tiết được mở')).toBeVisible();
});
test('has honest empty rating state and request error/retry', async () => {
  api.list.mockResolvedValue(rankingResult([]));
  open();
  expect(await screen.findByText('Chưa có truyện trong bảng này')).toBeVisible();
  api.list.mockResolvedValue(rankingResult([], 'rating'));
  fireEvent.press(screen.getByLabelText('Bảng xếp hạng: Top đánh giá'));
  expect(await screen.findByText('Chưa có truyện được đánh giá')).toBeVisible();
});
test('network error can be retried without hiding filters', async () => {
  api.list.mockRejectedValueOnce(new ApiError(0, 'Không thể kết nối máy chủ.'));
  open();
  expect(await screen.findByText('Không thể kết nối máy chủ.')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByText(rankedNovel.title)).toBeVisible();
});
test('slow previous filter response cannot replace the newly selected board', async () => {
  const wait = deferred<Awaited<ReturnType<typeof rankingsApi.list>>>();
  api.list.mockImplementation(async (kind) =>
    kind === 'reads' ? wait.promise : rankingResult([rankedComic], 'rating'),
  );
  open();
  expect(screen.getByText('Đang tải bảng xếp hạng…')).toBeVisible();
  fireEvent.press(screen.getByLabelText('Bảng xếp hạng: Top đánh giá'));
  expect(await screen.findByText(rankedComic.title)).toBeVisible();
  await act(async () => wait.resolve(rankingResult([rankedNovel])));
  expect(screen.queryByText(rankedNovel.title)).toBeNull();
});
test('load-more preserves absolute ranks and filter changes restart at page one', async () => {
  const second = { ...rankedComic, rank: 21 };
  api.list.mockImplementation(async (kind, _type, page) =>
    rankingResult(page === 2 ? [second] : [rankedNovel], kind, page ?? 1, 21),
  );
  open();
  await screen.findByText(rankedNovel.title);
  fireEvent.press(screen.getByText('Xem thêm thứ hạng'));
  expect(
    await screen.findByRole('button', { name: `Hạng 21: ${rankedComic.title}` }),
  ).toBeVisible();
  fireEvent.press(screen.getByLabelText('Loại truyện: Truyện tranh'));
  await waitFor(() =>
    expect(api.list).toHaveBeenLastCalledWith('reads', 'COMIC', 1, expect.anything()),
  );
  expect(screen.queryByRole('button', { name: `Hạng 21: ${rankedComic.title}` })).toBeNull();
});
test('pull to refresh reloads the active board and back navigation works', async () => {
  open();
  await screen.findByText(rankedNovel.title);
  fireEvent(screen.UNSAFE_getByType(FlatList), 'refresh');
  await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(1));
  fireEvent.press(screen.getByLabelText('Quay lại'));
  await waitFor(() => expect(screen).toHavePathname('/'));
});
