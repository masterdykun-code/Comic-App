import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor } from 'expo-router/testing-library';
import { act, render } from '@testing-library/react-native';
import { BackHandler, FlatList, Image, ScrollView, View } from 'react-native';
import { coinsApi } from '../src/features/coins/api';
import Reader from '../src/app/reader/[id]';
import { readerApi, type ProgressSnapshot } from '../src/features/reader/api';
import { catalogApi } from '../src/features/stories/api';
import { NovelContent } from '../src/features/reader/NovelContent';
import { ComicContent } from '../src/features/reader/ComicContent';
import { readerThemes } from '../src/features/reader/theme';
import { authSession } from '../src/services/runtime';
import { ApiError } from '../src/lib/errors';
import { chapter, novel, result } from './catalog-fixtures';
import {
  comicChapter,
  emptyProgress,
  novelChapter,
  position,
  savedProgress,
} from './reader-fixtures';
import { user, deferred } from './fixtures';
import { readerSettings, DEFAULT_NOVEL_SETTINGS } from '../src/stores/reader-settings';
import { readerFontFamily } from '../src/features/reader/fonts';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { comicSettings } from '../src/stores/comic-settings';
import { bookmarkApi } from '../src/features/bookmarks/api';
import { novelBookmark, comicBookmark, resolvedNovel } from './bookmark-fixtures';

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
  catalogApi: { chapters: jest.fn() },
}));
jest.mock('../src/features/bookmarks/api', () => ({
  ...jest.requireActual('../src/features/bookmarks/api'),
  bookmarkApi: { add: jest.fn(), resolve: jest.fn(), list: jest.fn(), remove: jest.fn() },
}));
jest.mock('../src/features/coins/api', () => ({
  coinsApi: { access: jest.fn(), wallet: jest.fn(), unlock: jest.fn() },
}));
const marks = jest.mocked(bookmarkApi);
const api = jest.mocked(readerApi);
const catalog = jest.mocked(catalogApi);
function open(id = chapter.id, storyId = novel.id, bookmarkId?: string) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Layout() {
    return (
      <QueryClientProvider client={client}>
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    );
  }
  return renderRouter(
    { _layout: Layout, 'reader/[id]': Reader, 'story/[id]': () => <View /> },
    {
      initialUrl: `/reader/${id}?storyId=${storyId}${bookmarkId ? '&bookmarkId=' + bookmarkId : ''}`,
    },
  );
}
beforeEach(() => {
  jest.clearAllMocks();
  comicSettings.store.setState({ mode: 'vertical', hydrated: true, notice: null });
  readerSettings.store.setState({
    preferences: { ...DEFAULT_NOVEL_SETTINGS },
    hydrated: true,
    notice: null,
  });
  authSession.store.setState({ status: 'guest', user: null, notice: null });
  api.chapter.mockResolvedValue(novelChapter);
  marks.add.mockResolvedValue({ success: true, data: novelBookmark, created: true });
  marks.resolve.mockResolvedValue(resolvedNovel);
  api.progress.mockResolvedValue(emptyProgress);
  api.history.mockResolvedValue(undefined);
  api.save.mockImplementation(async (_id, p) => ({
    data: { ...p, storyId: novel.id },
    version: savedProgress.version,
  }));
  catalog.chapters.mockResolvedValue(result([chapter], 1, 1, 20));
  jest.spyOn(Image, 'getSize').mockImplementation((_url, success) => {
    success?.(600, 1200);
    return Promise.resolve({ width: 600, height: 1200 });
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test('Reader marks the current NOVEL paragraph and prevents duplicate taps without an extra progress save', async () => {
  jest.useFakeTimers();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.progress.mockResolvedValue(savedProgress);
  api.chapter.mockResolvedValue({
    ...novelChapter,
    type: 'NOVEL',
    content: 'a'.repeat(799) + '\n' + 'b'.repeat(799) + '\nEnd',
  });
  const slow = deferred<Awaited<ReturnType<typeof bookmarkApi.add>>>();
  marks.add.mockReturnValue(slow.promise);
  open();
  await screen.findByTestId('novel-block-800');
  const scroll = screen.getByTestId('novel-scroll');
  fireEvent(scroll, 'layout', { nativeEvent: { layout: { width: 393, height: 600 } } });
  fireEvent(scroll, 'contentSizeChange', 393, 3000);
  fireEvent(screen.getByTestId('novel-block-800'), 'layout', {
    nativeEvent: { layout: { y: 1000 } },
  });
  fireEvent(scroll, 'scrollBeginDrag');
  fireEvent.scroll(scroll, { nativeEvent: { contentOffset: { y: 1010 } } });
  fireEvent.press(screen.getByRole('button', { name: 'Đánh dấu chương' }));
  const pendingButton = screen.getByRole('button', { name: 'Đang lưu dấu trang…' });
  fireEvent.press(pendingButton);
  await waitFor(() => expect(marks.add).toHaveBeenCalledTimes(1));
  expect(marks.add).toHaveBeenCalledWith(
    { storyId: novel.id, chapterId: chapter.id, textOffset: 800, pageNumber: null },
    expect.anything(),
  );
  expect(api.save).not.toHaveBeenCalled();
  await act(async () => slow.resolve({ success: true, created: true, data: novelBookmark }));
  expect(await screen.findByText(/Đã lưu dấu trang/)).toBeVisible();
});

test('NOVEL bookmark overrides restoration only, then saves real reading with the original progress version', async () => {
  jest.useFakeTimers();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.progress.mockResolvedValue(savedProgress);
  api.chapter.mockResolvedValue({
    ...novelChapter,
    type: 'NOVEL',
    content: 'a'.repeat(799) + '\n' + 'b'.repeat(799) + '\nEnd',
  });
  open(chapter.id, novel.id, novelBookmark.id);
  await screen.findByTestId('novel-block-800');
  const scrollTo = jest.spyOn(screen.UNSAFE_getByType(ScrollView).instance, 'scrollTo');
  fireEvent(screen.getByTestId('novel-block-800'), 'layout', {
    nativeEvent: { layout: { y: 1000 } },
  });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1000, animated: false });
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(api.save).not.toHaveBeenCalled();
  fireEvent(screen.getByTestId('novel-scroll'), 'scrollBeginDrag');
  fireEvent.scroll(screen.getByTestId('novel-scroll'), {
    nativeEvent: { contentOffset: { y: 1010 } },
  });
  await act(async () => jest.advanceTimersByTimeAsync(1500));
  expect(api.save).toHaveBeenCalledWith(
    novel.id,
    expect.objectContaining({ textOffset: 800 }),
    savedProgress.version,
    expect.anything(),
  );
});

test('COMIC bookmark restores the actual page in paged mode and does not overwrite Continue Reading on mount', async () => {
  jest.useFakeTimers();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  comicSettings.store.setState({ mode: 'paged' });
  marks.resolve.mockResolvedValue({ ...comicBookmark, positionAdjusted: false });
  api.chapter.mockResolvedValue({
    ...comicChapter,
    storyId: comicBookmark.storyId,
    id: comicBookmark.chapterId,
  });
  api.progress.mockResolvedValue({
    data: {
      ...position,
      storyId: comicBookmark.storyId,
      chapterId: comicBookmark.chapterId,
      textOffset: null,
      pageNumber: 1,
    },
    version: savedProgress.version,
  });
  open(comicBookmark.chapterId, comicBookmark.storyId, comicBookmark.id);
  fireEvent(await screen.findByTestId('comic-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
  expect(await screen.findByLabelText('Trang 3')).toBeVisible();
  await act(async () => jest.advanceTimersByTimeAsync(2000));
  expect(api.save).not.toHaveBeenCalled();
  marks.add.mockResolvedValue({ success: true, created: false, data: comicBookmark });
  fireEvent.press(screen.getByRole('button', { name: 'Đánh dấu chương' }));
  await waitFor(() =>
    expect(marks.add).toHaveBeenCalledWith(
      {
        storyId: comicBookmark.storyId,
        chapterId: comicBookmark.chapterId,
        textOffset: null,
        pageNumber: 3,
      },
      expect.anything(),
    ),
  );
});

test('Guest cannot resolve private bookmarks', async () => {
  open(chapter.id, novel.id, novelBookmark.id);
  expect(await screen.findByText('Đăng nhập để mở dấu trang của bạn.')).toBeVisible();
  expect(marks.resolve).not.toHaveBeenCalled();
  expect(api.progress).not.toHaveBeenCalled();
  expect(screen.queryByTestId('novel-scroll')).toBeNull();
});

test('mismatched bookmark links cannot mount a Reader or write private reading state', async () => {
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  marks.resolve.mockResolvedValue({ ...resolvedNovel, storyId: comicBookmark.storyId });
  open(chapter.id, novel.id, novelBookmark.id);
  expect(await screen.findByText('Dấu trang không thuộc chương này.')).toBeVisible();
  expect(screen.queryByTestId('novel-scroll')).toBeNull();
  expect(api.progress).not.toHaveBeenCalled();
  expect(api.history).not.toHaveBeenCalled();
});

test('chapter navigation waits for the previous progress commit and prevents duplicate transitions', async () => {
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  const later = {
    ...chapter,
    id: '30000000-0000-4000-8000-000000000002',
    chapterNumber: 7,
    title: 'Chương kế tiếp',
  };
  catalog.chapters.mockResolvedValue(result([chapter, later], 1, 2, 20));
  api.chapter.mockImplementation(async (id) => ({
    ...novelChapter,
    id,
    title: id === later.id ? later.title : chapter.title,
  }));
  const pending = deferred<ProgressSnapshot>();
  api.save.mockReturnValueOnce(pending.promise);
  open();
  await screen.findByTestId('novel-scroll');
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Chương sau' })).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByText('Chương sau'));
  fireEvent.press(screen.getByText('Chương sau'));
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  expect(screen).toHavePathname(`/reader/${chapter.id}`);
  expect(api.chapter.mock.calls.some(([id]) => id === later.id)).toBe(false);
  api.progress.mockResolvedValue(savedProgress);
  await act(async () => pending.resolve(savedProgress));
  await waitFor(() => expect(screen).toHavePathname(`/reader/${later.id}`));
});
test('Android system Back waits for progress and consumes repeated presses while saving', async () => {
  let hardwareBack: Parameters<typeof BackHandler.addEventListener>[1] | undefined;
  const remove = jest.fn();
  jest.spyOn(BackHandler, 'addEventListener').mockImplementation((_event, handler) => {
    hardwareBack = handler;
    return { remove };
  });
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  const pending = deferred<ProgressSnapshot>();
  api.save.mockReturnValueOnce(pending.promise);
  open();
  await screen.findByTestId('novel-scroll');
  act(() => {
    const event = { type: 'hardwareBackPress', timeStamp: 1 };
    expect(hardwareBack?.(event)).toBe(true);
    expect(hardwareBack?.(event)).toBe(true);
  });
  await waitFor(() => expect(api.save).toHaveBeenCalledTimes(1));
  expect(screen).toHavePathname(`/reader/${chapter.id}`);
  await act(async () => pending.resolve(savedProgress));
  await waitFor(() => expect(screen).toHavePathname(`/story/${novel.id}`));
  expect(remove).toHaveBeenCalled();
});

test('Guest reads NOVEL with exact internal newlines and never calls private APIs', async () => {
  open();
  expect(
    await screen.findByText(novelChapter.type === 'NOVEL' ? novelChapter.content : ''),
  ).toBeVisible();
  expect(api.progress).not.toHaveBeenCalled();
  expect(api.history).not.toHaveBeenCalled();
  expect(api.save).not.toHaveBeenCalled();
});
test('font size, line spacing and all three themes are applied to native Text', async () => {
  open();
  const content = novelChapter.type === 'NOVEL' ? novelChapter.content : '';
  await screen.findByText(content);
  fireEvent.press(screen.getByText('Tùy chỉnh đọc'));
  fireEvent.press(screen.getByRole('button', { name: 'Tăng cỡ chữ' }));
  fireEvent.press(screen.getByText('Dòng 2.1'));
  fireEvent.press(screen.getByText('Nền sepia'));
  fireEvent.press(screen.getByText('Đóng tùy chỉnh'));
  expect(screen.getByText(content)).toHaveStyle({
    fontSize: 22,
    lineHeight: 46,
    color: readerThemes.sepia.text,
  });
  fireEvent.press(screen.getByText('Tùy chỉnh đọc'));
  fireEvent.press(screen.getByText('Nền tối'));
  fireEvent.press(screen.getByText('Đóng tùy chỉnh'));
  expect(screen.getByText(content)).toHaveStyle({ color: readerThemes.dark.text });
  fireEvent.press(screen.getByText('Tùy chỉnh đọc'));
  fireEvent.press(screen.getByText('Nền sáng'));
  fireEvent.press(screen.getByText('Đóng tùy chỉnh'));
  expect(screen.getByText(content)).toHaveStyle({ color: readerThemes.light.text });
});
test('NOVEL font selection applies local font, persists, and reset restores defaults without private writes', async () => {
  open();
  const content = novelChapter.type === 'NOVEL' ? novelChapter.content : '';
  await screen.findByText(content);
  fireEvent.press(screen.getByText('Tùy chỉnh đọc'));
  fireEvent.press(screen.getByRole('button', { name: 'Có chân' }));
  expect(screen.getByText(content)).toHaveStyle({ fontFamily: readerFontFamily('serif') });
  expect(screen.getByRole('button', { name: 'Có chân' })).toBeSelected();
  await act(async () => readerSettings.flush());
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    expect.any(String),
    expect.stringContaining('"font":"serif"'),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Đơn cách' }));
  expect(screen.getByText(content)).toHaveStyle({ fontFamily: readerFontFamily('mono') });
  fireEvent.press(screen.getByRole('button', { name: 'Khôi phục mặc định' }));
  expect(screen.getByText(content)).toHaveStyle({ fontSize: 20, lineHeight: 36 });
  expect(screen.getByRole('button', { name: 'Mặc định' })).toBeSelected();
  expect(api.progress).not.toHaveBeenCalled();
  expect(api.save).not.toHaveBeenCalled();
});

test('saved NOVEL settings hydrate before text mounts, without restoring with the wrong font', async () => {
  readerSettings.store.setState({ hydrated: false });
  const hydration = deferred<void>();
  jest.spyOn(readerSettings, 'hydrate').mockReturnValueOnce(hydration.promise);
  open();
  await waitFor(() => expect(api.chapter).toHaveBeenCalled());
  expect(screen.queryByTestId('novel-scroll')).toBeNull();
  await act(async () => {
    readerSettings.store.setState({
      hydrated: true,
      preferences: { font: 'serif', fontSize: 28, lineSpacing: 2.1, theme: 'dark' },
    });
    hydration.resolve();
  });
  const content = novelChapter.type === 'NOVEL' ? novelChapter.content : '';
  expect(await screen.findByText(content)).toHaveStyle({
    fontFamily: readerFontFamily('serif'),
    fontSize: 28,
    lineHeight: 59,
    color: readerThemes.dark.text,
  });
});

test('font relayout keeps UTF-16 anchor and ignores late programmatic scroll until a real drag', async () => {
  jest.useFakeTimers();
  const content = 'a'.repeat(799) + '\n' + 'b'.repeat(799) + '\nCuối chương.';
  const callback = jest.fn();
  const props = {
    chapterId: chapter.id,
    content,
    title: chapter.title,
    fontSize: 20,
    lineSpacing: 1.8,
    theme: readerThemes.light,
    saved: { ...position, storyId: novel.id, textOffset: 900 },
    restoreReady: true,
    onPosition: callback,
  };
  const { rerender } = render(<NovelContent {...props} />);
  const scrollTo = jest.spyOn(screen.UNSAFE_getByType(ScrollView).instance, 'scrollTo');
  fireEvent(screen.getByTestId('novel-block-800'), 'layout', {
    nativeEvent: { layout: { y: 1000 } },
  });
  rerender(<NovelContent {...props} fontFamily="serif" />);
  fireEvent(screen.getByTestId('novel-block-800'), 'layout', {
    nativeEvent: { layout: { y: 1200 } },
  });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1200, animated: false });
  await act(async () => jest.advanceTimersByTimeAsync(1000));
  fireEvent.scroll(screen.getByTestId('novel-scroll'), {
    nativeEvent: { contentOffset: { y: 0 } },
  });
  expect(callback).not.toHaveBeenCalled();
  rerender(<NovelContent {...props} fontFamily="monospace" />);
  fireEvent(screen.getByTestId('novel-block-800'), 'layout', {
    nativeEvent: { layout: { y: 1400 } },
  });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1400, animated: false });
  fireEvent(screen.getByTestId('novel-scroll'), 'scrollBeginDrag');
  fireEvent.scroll(screen.getByTestId('novel-scroll'), {
    nativeEvent: { contentOffset: { y: 1400 } },
  });
  expect(callback).toHaveBeenCalledWith(expect.objectContaining({ textOffset: 800 }));
});

test('reader tools can be hidden and shown without unmounting the text', async () => {
  open();
  await screen.findByText(chapter.title);
  fireEvent.press(screen.getByText('Ẩn công cụ'));
  expect(screen.queryByText('Tùy chỉnh đọc')).toBeNull();
  expect(screen.getByText(chapter.title)).toBeVisible();
  fireEvent.press(screen.getByText('Hiện công cụ'));
  expect(screen.getByText('Tùy chỉnh đọc')).toBeVisible();
});
test('published chapter directory follows pagination and navigates chapter gaps', async () => {
  const later = {
    ...chapter,
    id: '30000000-0000-4000-8000-000000000002',
    chapterNumber: 8,
    title: 'Chương tám',
  };
  catalog.chapters.mockImplementation(async (_id, page) =>
    page === 1 ? result([chapter], 1, 21, 20) : result([later], 2, 21, 20),
  );
  api.chapter.mockImplementation(async (id) => ({
    ...novelChapter,
    ...(id === later.id ? later : chapter),
  }));
  open();
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Chương sau' })).not.toBeDisabled(),
  );
  fireEvent.press(screen.getByText('Danh sách chương'));
  expect(await screen.findByText('Chương 3 · Khởi đầu · Đang đọc')).toBeVisible();
  expect(screen.getByText('Chương 8 · Chương tám')).toBeVisible();
  fireEvent.press(screen.getByText('Đóng danh sách chương'));
  fireEvent.press(screen.getByText('Chương sau'));
  await waitFor(() => expect(screen).toHavePathname(`/reader/${later.id}`));
  expect(await screen.findByText(later.title)).toBeVisible();
  fireEvent.press(screen.getByText('Chương trước'));
  await waitFor(() => expect(screen).toHavePathname(`/reader/${chapter.id}`));
});
test('404 and network failures are safe and retryable', async () => {
  api.chapter.mockRejectedValue(new ApiError(404, 'Không tìm thấy nội dung.'));
  open();
  expect(await screen.findByText('Không tìm thấy nội dung.')).toBeVisible();
  expect(api.history).not.toHaveBeenCalled();
  api.chapter.mockResolvedValue(novelChapter);
  fireEvent.press(screen.getByText('Thử lại'));
  expect(await screen.findByText(chapter.title)).toBeVisible();
});
test('invalid reader links never query chapters or private state', async () => {
  open('invalid');
  expect(
    await screen.findByText('Liên kết đọc không hợp lệ. Cần UUID truyện và chương.'),
  ).toBeVisible();
  expect(api.chapter).not.toHaveBeenCalled();
});
test.each(['USER', 'ADMIN'] as const)(
  '%s loads progress and records history once when a chapter opens',
  async (role) => {
    authSession.store.setState({ status: 'authenticated', user: { ...user, role }, notice: null });
    open();
    await screen.findByText(chapter.title);
    expect(api.progress).toHaveBeenCalledWith(novel.id, expect.anything());
    expect(api.history).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByText('Ẩn công cụ'));
    fireEvent.press(screen.getByText('Hiện công cụ'));
    expect(api.history).toHaveBeenCalledTimes(1);
    expect(api.save).not.toHaveBeenCalled();
  },
);
test('private progress/history failures do not prevent public reading or guess a version', async () => {
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.progress.mockRejectedValue(new Error('private'));
  api.history.mockRejectedValue(new Error('private'));
  open();
  expect(await screen.findByText(chapter.title)).toBeVisible();
  expect(await screen.findByText(/Chưa tải được tiến độ/)).toBeVisible();
  expect(api.save).not.toHaveBeenCalled();
});
test('NOVEL measurements map pixels to block character anchors; scrolling is debounced and history is not repeated', async () => {
  jest.useFakeTimers();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.chapter.mockResolvedValue({
    ...novelChapter,
    type: 'NOVEL',
    content: 'a'.repeat(799) + '\n' + 'b'.repeat(799) + '\nEnd',
  });
  open();
  await screen.findByTestId('novel-block-800');
  const scroll = screen.getByTestId('novel-scroll');
  fireEvent(scroll, 'layout', { nativeEvent: { layout: { width: 393, height: 600 } } });
  fireEvent(scroll, 'contentSizeChange', 393, 3000);
  for (const [offset, y] of [
    [0, 100],
    [800, 1000],
    [1600, 2000],
  ])
    fireEvent(screen.getByTestId(`novel-block-${offset}`), 'layout', {
      nativeEvent: { layout: { y } },
    });
  fireEvent(scroll, 'scrollBeginDrag');
  fireEvent.scroll(scroll, {
    nativeEvent: {
      contentOffset: { y: 1010 },
      layoutMeasurement: { height: 600 },
      contentSize: { height: 3000 },
    },
  });
  expect(api.save).not.toHaveBeenCalled();
  await act(async () => jest.advanceTimersByTimeAsync(1500));
  expect(api.save).toHaveBeenCalledWith(
    novel.id,
    expect.objectContaining({ textOffset: 800, pageNumber: null }),
    null,
    expect.anything(),
  );
  expect(api.history).toHaveBeenCalledTimes(1);
});
test('NOVEL restores the saved block and retains the same text anchor after font changes', () => {
  const content = 'a'.repeat(799) + '\n' + 'b'.repeat(799) + '\nEnd';
  const saved = { ...position, storyId: novel.id, textOffset: 900 };
  const callback = jest.fn();
  const props = {
    chapterId: chapter.id,
    content,
    title: chapter.title,
    fontSize: 20,
    lineSpacing: 1.8,
    theme: readerThemes.light,
    saved,
    restoreReady: true,
    onPosition: callback,
  };
  const { rerender } = render(<NovelContent {...props} />);
  const instance = screen.UNSAFE_getByType(ScrollView).instance;
  const scrollTo = jest.spyOn(instance, 'scrollTo');
  fireEvent(screen.getByTestId('novel-block-800'), 'layout', {
    nativeEvent: { layout: { y: 1000 } },
  });
  expect(scrollTo).toHaveBeenCalledWith({ y: 1000, animated: false });
  rerender(<NovelContent {...props} fontSize={24} />);
  fireEvent(screen.getByTestId('novel-block-800'), 'layout', {
    nativeEvent: { layout: { y: 1200 } },
  });
  expect(scrollTo).toHaveBeenLastCalledWith({ y: 1200, animated: false });
  expect(callback).not.toHaveBeenCalled();
});
test('COMIC uses measured aspect ratios and actual page numbers in a virtualized list', async () => {
  api.chapter.mockResolvedValue(comicChapter);
  open();
  fireEvent(await screen.findByTestId('comic-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
  expect(await screen.findByLabelText('Trang 1')).toHaveStyle({ width: 300, height: 600 });
  const list = screen.UNSAFE_getByType(FlatList);
  expect(list.props.data.map((p: { pageNumber: number }) => p.pageNumber)).toEqual([1, 3, 7]);
  expect(api.progress).not.toHaveBeenCalled();
});
test('COMIC settings switch modes and persist without exposing NOVEL controls or private writes for Guest', async () => {
  api.chapter.mockResolvedValue(comicChapter);
  open();
  fireEvent(await screen.findByTestId('comic-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
  fireEvent.press(screen.getByText('Tùy chỉnh đọc'));
  expect(screen.getByRole('button', { name: 'Cuộn dọc' })).toBeSelected();
  expect(screen.queryByRole('button', { name: 'Có chân' })).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Từng trang' }));
  await act(async () => comicSettings.flush());
  expect(AsyncStorage.setItem).toHaveBeenCalledWith(
    'webnovel.reader.comic-settings.v1',
    JSON.stringify({ version: 1, mode: 'paged' }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Đóng tùy chỉnh' }));
  expect(screen.getByTestId('comic-paged')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Trang sau' })).toBeVisible();
  expect(api.save).not.toHaveBeenCalled();
  expect(api.history).not.toHaveBeenCalled();
});

test('paged COMIC saves a real page change with the existing progress version and queue', async () => {
  jest.useFakeTimers();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  comicSettings.store.setState({ mode: 'paged' });
  api.chapter.mockResolvedValue(comicChapter);
  api.progress.mockResolvedValue({
    data: { ...position, storyId: novel.id, textOffset: null, pageNumber: 3, scrollOffset: 0 },
    version: savedProgress.version,
  });
  open();
  fireEvent(await screen.findByTestId('comic-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
  expect(await screen.findByLabelText('Trang 3')).toBeVisible();
  expect(api.save).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Trang sau' }));
  await act(async () => jest.advanceTimersByTimeAsync(1500));
  expect(api.save).toHaveBeenCalledTimes(1);
  expect(api.save).toHaveBeenCalledWith(
    novel.id,
    expect.objectContaining({ pageNumber: 7, textOffset: null, scrollOffset: 0 }),
    savedProgress.version,
    expect.anything(),
  );
});

test('COMIC restoration starts at the saved page without inventing preceding image heights', async () => {
  if (comicChapter.type !== 'COMIC') throw new Error('fixture');
  render(
    <ComicContent
      chapterId={chapter.id}
      title={chapter.title}
      pages={comicChapter.pages}
      theme={readerThemes.light}
      restoreReady
      saved={{ ...position, storyId: novel.id, textOffset: null, pageNumber: 7, scrollOffset: 100 }}
      onPosition={jest.fn()}
    />,
  );
  fireEvent(screen.getByTestId('comic-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
  expect(
    screen.UNSAFE_getByType(FlatList).props.data.map((p: { pageNumber: number }) => p.pageNumber),
  ).toEqual([7]);
  expect(await screen.findByLabelText('Trang 7')).toBeVisible();
  fireEvent.press(screen.getByText('Tải các trang trước'));
  expect(screen.UNSAFE_getByType(FlatList).props.data.length).toBe(3);
});
test('COMIC visible-page changes save pageNumber safely, never a guessed text offset', async () => {
  jest.useFakeTimers();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.chapter.mockResolvedValue(comicChapter);
  open();
  fireEvent(await screen.findByTestId('comic-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
  const list = screen.UNSAFE_getByType(FlatList);
  fireEvent(list, 'scrollBeginDrag');
  const page = comicChapter.type === 'COMIC' ? comicChapter.pages[1] : null;
  act(() =>
    list.props.onViewableItemsChanged({ viewableItems: [{ item: page, isViewable: true }] }),
  );
  await act(async () => jest.advanceTimersByTimeAsync(1500));
  expect(api.save).toHaveBeenCalledWith(
    novel.id,
    expect.objectContaining({ pageNumber: 3, scrollOffset: 0, textOffset: null }),
    null,
    expect.anything(),
  );
  expect(api.history).toHaveBeenCalledTimes(1);
});
test('COMIC image errors show an explicit retry control', async () => {
  jest.spyOn(Image, 'getSize').mockImplementation((_url, _success, failure) => {
    failure?.(new Error('image'));
    return Promise.reject(new Error('image')).catch(() => ({ width: 0, height: 0 }));
  });
  api.chapter.mockResolvedValue(comicChapter);
  open();
  fireEvent(await screen.findByTestId('comic-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
  expect(await screen.findByText('Không tải được trang 1.')).toBeVisible();
  const before = jest.mocked(Image.getSize).mock.calls.length;
  fireEvent.press(screen.getByLabelText('Thử lại trang 1'));
  await waitFor(() => expect(jest.mocked(Image.getSize).mock.calls.length).toBeGreaterThan(before));
});
test('409 displays a conflict notice, reloads saved state once and never auto-saves again', async () => {
  jest.useFakeTimers();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.chapter.mockResolvedValue({
    ...novelChapter,
    type: 'NOVEL',
    content: 'a'.repeat(799) + '\n' + 'b'.repeat(799) + '\nEnd',
  });
  api.save.mockRejectedValue(new ApiError(409, 'PROGRESS_VERSION_CONFLICT'));
  open();
  await screen.findByTestId('novel-block-800');
  const scroll = screen.getByTestId('novel-scroll');
  fireEvent(scroll, 'layout', { nativeEvent: { layout: { width: 393, height: 600 } } });
  fireEvent(scroll, 'contentSizeChange', 393, 3000);
  fireEvent(screen.getByTestId('novel-block-0'), 'layout', { nativeEvent: { layout: { y: 100 } } });
  fireEvent(screen.getByTestId('novel-block-800'), 'layout', {
    nativeEvent: { layout: { y: 1000 } },
  });
  fireEvent(scroll, 'scrollBeginDrag');
  fireEvent.scroll(scroll, {
    nativeEvent: {
      contentOffset: { y: 1010 },
      layoutMeasurement: { height: 600 },
      contentSize: { height: 3000 },
    },
  });
  await act(async () => jest.advanceTimersByTimeAsync(1500));
  expect(await screen.findByText(/Tiến độ đã thay đổi ở nơi khác/)).toBeVisible();
  expect(api.progress).toHaveBeenCalledTimes(2);
  fireEvent.scroll(scroll, {
    nativeEvent: {
      contentOffset: { y: 1200 },
      layoutMeasurement: { height: 600 },
      contentSize: { height: 3000 },
    },
  });
  await act(async () => jest.advanceTimersByTimeAsync(60_000));
  expect(api.save).toHaveBeenCalledTimes(1);
});
test('opening a new short chapter saves its start even if it fits without scrolling', async () => {
  jest.useFakeTimers();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  open();
  await screen.findByText(chapter.title);
  await act(async () => jest.advanceTimersByTimeAsync(1500));
  expect(api.save).toHaveBeenCalledWith(
    novel.id,
    expect.objectContaining({ chapterId: chapter.id, textOffset: 0, progressPercent: 0 }),
    null,
    expect.anything(),
  );
});
test('restoring an existing chapter does not overwrite its saved offset automatically', async () => {
  jest.useFakeTimers();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.progress.mockResolvedValue(savedProgress);
  open();
  await screen.findByText(chapter.title);
  await act(async () => jest.advanceTimersByTimeAsync(6000));
  expect(api.save).not.toHaveBeenCalled();
});

test('locked VIP Reader shows unlock UI and never mounts text/images or writes progress/history', async () => {
  api.chapter.mockRejectedValue(new ApiError(402, 'Chương VIP cần mở khóa.', 'CHAPTER_LOCKED'));
  jest.mocked(coinsApi.access).mockResolvedValue({
    id: novelChapter.id,
    storyId: novel.id,
    title: 'Chương VIP',
    type: 'NOVEL',
    isVip: true,
    coinPrice: 10,
    canRead: false,
  });
  open();
  expect(await screen.findByText('Đăng nhập để mở khóa')).toBeTruthy();
  expect(screen.queryByTestId('novel-scroll')).toBeNull();
  expect(api.history).not.toHaveBeenCalled();
  expect(api.save).not.toHaveBeenCalled();
  expect(api.progress).not.toHaveBeenCalled();
  expect(coinsApi.unlock).not.toHaveBeenCalled();
});

test('Reader content cache is separated by account and removed from view on logout', async () => {
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  api.chapter.mockImplementation(async () => {
    if (authSession.store.getState().status === 'authenticated') return novelChapter;
    throw new ApiError(402, 'Chương VIP cần mở khóa.', 'CHAPTER_LOCKED');
  });
  jest.mocked(coinsApi.access).mockResolvedValue({
    id: novelChapter.id,
    storyId: novel.id,
    title: 'Chương VIP',
    type: 'NOVEL',
    isVip: true,
    coinPrice: 10,
    canRead: false,
  });
  open();
  await screen.findByTestId('novel-scroll');
  await act(async () => authSession.store.setState({ status: 'guest', user: null, notice: null }));
  expect(await screen.findByText('Đăng nhập để mở khóa')).toBeTruthy();
  expect(screen.queryByTestId('novel-scroll')).toBeNull();
});
