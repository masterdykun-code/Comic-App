import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor } from 'expo-router/testing-library';
import { act } from '@testing-library/react-native';
import { RefreshControl } from 'react-native';
import Home from '../src/app/(tabs)/index';
import Explore from '../src/app/(tabs)/explore';
import Search from '../src/app/search';
import Detail from '../src/app/story/[id]';
import Reader from '../src/app/reader/[id]';
import { catalogApi } from '../src/features/stories/api';
import { ApiError } from '../src/lib/errors';
import { chapter, comic, genre, novel, result } from './catalog-fixtures';
import { readerApi } from '../src/features/reader/api';
import { novelChapter } from './reader-fixtures';

jest.mock('../src/services/runtime', () => ({
  api: jest.requireActual('axios').default.create(),
  authSession: {
    store: jest
      .requireActual('zustand/vanilla')
      .createStore(() => ({ status: 'guest', user: null, notice: null })),
    generation: jest.fn(() => 0),
  },
}));
jest.mock('../src/features/reader/api', () => ({
  ...jest.requireActual('../src/features/reader/api'),
  readerApi: { chapter: jest.fn(), progress: jest.fn(), save: jest.fn(), history: jest.fn() },
}));
jest.mock('../src/features/stories/api', () => ({
  ...jest.requireActual('../src/features/stories/api'),
  catalogApi: { stories: jest.fn(), story: jest.fn(), chapters: jest.fn(), genres: jest.fn() },
}));
const api = jest.mocked(catalogApi);
function open(url = '/') {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0, staleTime: 30_000 } },
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
      index: Home,
      explore: Explore,
      search: Search,
      'story/[id]': Detail,
      'reader/[id]': Reader,
    },
    { initialUrl: url },
  );
  return client;
}
beforeEach(() => {
  jest.clearAllMocks();
  jest.mocked(readerApi.chapter).mockResolvedValue(novelChapter);
  api.stories.mockResolvedValue(result([]));
  api.genres.mockResolvedValue([genre]);
  api.story.mockResolvedValue(novel);
  api.chapters.mockResolvedValue(result([chapter], 1, 1, 20));
});
afterEach(() => jest.useRealTimers());
test('Home loads real-shaped data into new, NOVEL and COMIC sections for a Guest', async () => {
  api.stories.mockImplementation(async (filters) =>
    result(filters?.type === 'COMIC' ? [comic] : [novel]),
  );
  open();
  expect((await screen.findAllByText(novel.title)).length).toBe(2);
  expect(screen.getByText(comic.title)).toBeVisible();
  expect(api.stories).toHaveBeenCalledWith(
    { type: 'NOVEL', sort: 'newest', limit: 4 },
    1,
    expect.anything(),
  );
  expect(api.stories).toHaveBeenCalledWith(
    { type: 'COMIC', sort: 'newest', limit: 4 },
    1,
    expect.anything(),
  );
});
test('Home has friendly empty states without fake stories', async () => {
  open();
  expect((await screen.findAllByText('Chưa có truyện được xuất bản')).length).toBe(3);
});
test('Home loading state precedes the response', async () => {
  api.stories.mockReturnValue(new Promise(() => {}));
  open();
  expect((await screen.findAllByLabelText('Đang tải truyện…')).length).toBe(3);
});
test('Home network errors are safe and can be retried', async () => {
  api.stories.mockRejectedValue(new ApiError(0, 'Không thể kết nối máy chủ.'));
  open();
  expect((await screen.findAllByText('Không thể kết nối máy chủ.')).length).toBe(3);
  api.stories.mockResolvedValue(result([novel]));
  fireEvent.press(screen.getAllByText('Thử lại')[0]);
  expect(await screen.findByText(novel.title)).toBeVisible();
});
test('Home search action opens the public Search route', async () => {
  open();
  fireEvent.press(await screen.findByLabelText('Tìm kiếm truyện'));
  await waitFor(() => expect(screen).toHavePathname('/search'));
});
test('Explore combines genre, type, status and supported sort on the public stories endpoint', async () => {
  open('/explore');
  fireEvent.press(await screen.findByLabelText('Thể loại: Kỳ ảo'));
  fireEvent.press(screen.getByLabelText('Loại truyện: Truyện tranh'));
  fireEvent.press(screen.getByLabelText('Trạng thái: Hoàn thành'));
  fireEvent.press(screen.getByLabelText('Sắp xếp: Tên A–Z'));
  await waitFor(() =>
    expect(api.stories).toHaveBeenLastCalledWith(
      { type: 'COMIC', status: 'COMPLETED', genreId: genre.id, sort: 'title' },
      1,
      expect.anything(),
    ),
  );
});
test('Explore loads the next page and resets pagination when filters change', async () => {
  api.stories.mockImplementation(async (filters, page) =>
    filters?.type ? result([]) : page === 1 ? result([novel], 1, 13) : result([comic], 2, 13),
  );
  open('/explore');
  fireEvent.press(await screen.findByText('Tải thêm truyện'));
  expect(await screen.findByText(comic.title)).toBeVisible();
  expect(screen.getByText(novel.title)).toBeVisible();
  fireEvent.press(screen.getByLabelText('Loại truyện: Truyện tranh'));
  expect(await screen.findByText('Chưa có truyện phù hợp')).toBeVisible();
  expect(api.stories).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: 'COMIC' }),
    1,
    expect.anything(),
  );
  expect(screen.queryByText(novel.title)).toBeNull();
  fireEvent.press(screen.getByLabelText('Loại truyện: Tất cả'));
  expect(await screen.findByText(novel.title)).toBeVisible();
  expect(screen.queryByText(comic.title)).toBeNull();
  expect(api.stories).toHaveBeenLastCalledWith(
    expect.objectContaining({ type: undefined }),
    1,
    expect.anything(),
  );
});
test('Explore receives valid genre and type links', async () => {
  open(`/explore?genreId=${genre.id}&type=NOVEL`);
  await waitFor(() =>
    expect(api.stories).toHaveBeenLastCalledWith(
      expect.objectContaining({ genreId: genre.id, type: 'NOVEL' }),
      1,
      expect.anything(),
    ),
  );
});
test('Search trims edges, retains Vietnamese and debounces typing for 400ms', async () => {
  jest.useFakeTimers();
  open('/search');
  fireEvent.changeText(screen.getByLabelText('Tìm truyện theo tên'), 'V');
  act(() => jest.advanceTimersByTime(200));
  fireEvent.changeText(screen.getByLabelText('Tìm truyện theo tên'), '  Vườn mùa hạ  ');
  act(() => jest.advanceTimersByTime(399));
  expect(api.stories).not.toHaveBeenCalled();
  act(() => jest.advanceTimersByTime(1));
  await waitFor(() => expect(api.stories).toHaveBeenCalledTimes(1));
  expect(api.stories).toHaveBeenCalledWith({ search: 'Vườn mùa hạ' }, 1, expect.anything());
  expect(await screen.findByText('Không tìm thấy truyện')).toBeVisible();
});
test('Search ignores blank input and clears old results', async () => {
  jest.useFakeTimers();
  open('/search');
  fireEvent.changeText(screen.getByLabelText('Tìm truyện theo tên'), '   ');
  act(() => jest.advanceTimersByTime(500));
  expect(api.stories).not.toHaveBeenCalled();
  expect(screen.getByText('Bạn muốn đọc gì hôm nay?')).toBeVisible();
});
test('Search loads more results, navigates to Story Detail and resets for a new term', async () => {
  jest.useFakeTimers();
  api.stories.mockImplementation(async (_filters, page) =>
    page === 1 ? result([novel], 1, 13) : result([comic], 2, 13),
  );
  open('/search');
  fireEvent.changeText(screen.getByLabelText('Tìm truyện theo tên'), 'xanh');
  act(() => jest.advanceTimersByTime(400));
  fireEvent.press(await screen.findByText('Tải thêm kết quả'));
  expect(await screen.findByText(comic.title)).toBeVisible();
  fireEvent.changeText(screen.getByLabelText('Tìm truyện theo tên'), 'tranh');
  act(() => jest.advanceTimersByTime(400));
  await waitFor(() =>
    expect(api.stories).toHaveBeenLastCalledWith({ search: 'tranh' }, 1, expect.anything()),
  );
  expect(screen.queryByText(comic.title)).toBeNull();
  fireEvent.press(await screen.findByLabelText(`Xem ${novel.title}`));
  await waitFor(() => expect(screen).toHavePathname(`/story/${novel.id}`));
});
test('Story Detail shows actual metadata, published count and chapters', async () => {
  open(`/story/${novel.id}`);
  expect(await screen.findByText(novel.title)).toBeVisible();
  expect(screen.getByText(novel.description)).toBeVisible();
  expect(await screen.findByText('1 chương đã xuất bản')).toBeVisible();
  expect(screen.getByText('Chương 3 · Khởi đầu')).toBeVisible();
  expect(screen.getByLabelText('Chưa có ảnh bìa')).toBeVisible();
});
test('Guest starts reading the first published chapter using both UUIDs, even when chapterNumber starts at 3', async () => {
  open(`/story/${novel.id}`);
  await screen.findByText('1 chương đã xuất bản');
  fireEvent.press(screen.getByText('Bắt đầu đọc'));
  await waitFor(() => expect(screen).toHavePathname(`/reader/${chapter.id}`));
  expect(screen).toHaveSearchParams({ id: chapter.id, storyId: novel.id });
  expect(await screen.findByText(novelChapter.title)).toBeVisible();
});
test('Story without published chapters disables reading', async () => {
  api.chapters.mockResolvedValue(result([], 1, 0, 20));
  open(`/story/${novel.id}`);
  expect(await screen.findByText('Chưa có chương được xuất bản')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Bắt đầu đọc' })).toBeDisabled();
});
test('chapter failure does not invent a count or enable reading', async () => {
  api.chapters.mockRejectedValue(new ApiError(500, 'Máy chủ chưa xử lý được yêu cầu.'));
  open(`/story/${novel.id}`);
  expect(await screen.findByText('Máy chủ chưa xử lý được yêu cầu.')).toBeVisible();
  expect(screen.queryByText('0 chương đã xuất bản')).toBeNull();
  expect(screen.getByRole('button', { name: 'Bắt đầu đọc' })).toBeDisabled();
});
test('missing or private story shows 404 and does not fetch chapters', async () => {
  api.story.mockRejectedValue(new ApiError(404, 'Không tìm thấy nội dung.'));
  open(`/story/${novel.id}`);
  expect(await screen.findByText('Không tìm thấy nội dung.')).toBeVisible();
  expect(api.chapters).not.toHaveBeenCalled();
});
test('invalid Story UUID never sends a request', async () => {
  open('/story/invalid');
  expect(await screen.findByText('Liên kết không hợp lệ. ID cần có định dạng UUID.')).toBeVisible();
  expect(api.story).not.toHaveBeenCalled();
  expect(api.chapters).not.toHaveBeenCalled();
});
test('Home pull-to-refresh reloads all three sections', async () => {
  open();
  await screen.findAllByText('Chưa có truyện được xuất bản');
  api.stories.mockClear();
  fireEvent(screen.UNSAFE_getByType(RefreshControl), 'refresh');
  await waitFor(() => expect(api.stories).toHaveBeenCalledTimes(3));
});
test('genre network failure is retryable without blocking stories', async () => {
  api.genres.mockRejectedValue(new ApiError(0, 'Lỗi tải thể loại.'));
  open('/explore');
  expect(await screen.findByText('Lỗi tải thể loại.')).toBeVisible();
  expect(await screen.findByText('Chưa có truyện phù hợp')).toBeVisible();
  api.genres.mockResolvedValue([genre]);
  fireEvent.press(screen.getByText('Thử lại'));
  expect(await screen.findByLabelText('Thể loại: Kỳ ảo')).toBeVisible();
});
test('Story chapter pagination appends published metadata and navigates selected chapter', async () => {
  const later = {
    ...chapter,
    id: '30000000-0000-4000-8000-000000000002',
    chapterNumber: 7,
    title: 'Ngày mai',
  };
  api.chapters.mockImplementation(async (_id, page) =>
    page === 1 ? result([chapter], 1, 21, 20) : result([later], 2, 21, 20),
  );
  open(`/story/${novel.id}`);
  fireEvent.press(await screen.findByText('Tải thêm chương'));
  expect(await screen.findByText('Chương 7 · Ngày mai')).toBeVisible();
  expect(screen.getByText('Chương 3 · Khởi đầu')).toBeVisible();
  fireEvent.press(screen.getByText('Chương 7 · Ngày mai'));
  await waitFor(() => expect(screen).toHavePathname(`/reader/${later.id}`));
  expect(screen).toHaveSearchParams({ id: later.id, storyId: novel.id });
});
test('slow older search response never replaces newer search results', async () => {
  jest.useFakeTimers();
  let resolveOld!: (value: ReturnType<typeof result<typeof novel>>) => void;
  api.stories.mockImplementation((filters) =>
    filters?.search === 'cũ'
      ? new Promise((resolve) => {
          resolveOld = resolve;
        })
      : Promise.resolve(result([comic])),
  );
  open('/search');
  fireEvent.changeText(screen.getByLabelText('Tìm truyện theo tên'), 'cũ');
  act(() => jest.advanceTimersByTime(400));
  await waitFor(() => expect(api.stories).toHaveBeenCalledTimes(1));
  fireEvent.changeText(screen.getByLabelText('Tìm truyện theo tên'), 'mới');
  act(() => jest.advanceTimersByTime(400));
  expect(await screen.findByText(comic.title)).toBeVisible();
  await act(async () => {
    resolveOld(result([novel]));
  });
  expect(screen.queryByText(novel.title)).toBeNull();
  expect(screen.getByText(comic.title)).toBeVisible();
});
test('clearing Search cancels visible results and never requests an empty search', async () => {
  jest.useFakeTimers();
  api.stories.mockResolvedValue(result([novel]));
  open('/search');
  fireEvent.changeText(screen.getByLabelText('Tìm truyện theo tên'), 'xanh');
  act(() => jest.advanceTimersByTime(400));
  await screen.findByText(novel.title);
  fireEvent.press(screen.getByText('Xóa tìm kiếm'));
  act(() => jest.advanceTimersByTime(500));
  expect(screen.queryByText(novel.title)).toBeNull();
  expect(api.stories).toHaveBeenCalledTimes(1);
});
