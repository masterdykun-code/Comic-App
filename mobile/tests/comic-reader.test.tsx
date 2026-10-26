import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { FlatList, Image, Modal } from 'react-native';
import { ComicContent } from '../src/features/reader/ComicContent';
import { ComicPageViewer } from '../src/features/reader/ComicPageViewer';
import { readerThemes } from '../src/features/reader/theme';
import { comicChapter, position } from './reader-fixtures';
import type { Position } from '../src/features/reader/api';
if (comicChapter.type !== 'COMIC') throw Error('fixture');
const pages = comicChapter.pages;
const props = {
  chapterId: comicChapter.id,
  pages,
  title: comicChapter.title,
  saved: null,
  restoreReady: true,
  theme: readerThemes.light,
};
beforeEach(() => {
  jest.spyOn(Image, 'getSize').mockImplementation((_url, success) => {
    success?.(600, 1200);
    return Promise.resolve({ width: 600, height: 1200 });
  });
});
afterEach(() => jest.restoreAllMocks());
function layout() {
  fireEvent(screen.getByTestId('comic-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 600 } },
  });
}
test('paged reading follows actual non-contiguous page numbers with disabled first/last controls', async () => {
  const changed = jest.fn();
  render(<ComicContent {...props} mode="paged" onPosition={changed} />);
  layout();
  expect(await screen.findByLabelText('Trang 1')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Trang trước' })).toBeDisabled();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Trang sau' }));
  expect(await screen.findByLabelText('Trang 3')).toBeVisible();
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({
      pageNumber: 3,
      textOffset: null,
      scrollOffset: 0,
      progressPercent: 33.33,
    }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Trang sau' }));
  expect(await screen.findByLabelText('Trang 7')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Trang sau' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Đã đọc hết chương' })).toBeDisabled();
  expect(changed.mock.calls.some(([p]: [Position]) => p.progressPercent === 100)).toBe(false);
  fireEvent(screen.getByLabelText('Trang 7'), 'load');
  fireEvent.press(screen.getByRole('button', { name: 'Đã đọc hết chương' }));
  expect(changed).toHaveBeenLastCalledWith(
    expect.objectContaining({ pageNumber: 7, progressPercent: 100 }),
  );
  fireEvent.press(screen.getByRole('button', { name: 'Trang trước' }));
  expect(await screen.findByLabelText('Trang 3')).toBeVisible();
});
test('restoring paged reading uses saved page and never overwrites saved progress on mount', async () => {
  const changed = jest.fn();
  render(
    <ComicContent
      {...props}
      mode="paged"
      saved={{ ...position, storyId: comicChapter.storyId, textOffset: null, pageNumber: 7 }}
      onPosition={changed}
    />,
  );
  layout();
  expect(await screen.findByLabelText('Trang 7')).toBeVisible();
  fireEvent(screen.getByLabelText('Trang 7'), 'load');
  expect(changed).not.toHaveBeenCalled();
});

test('paged image fits the measured reading area when controls or screen height change', async () => {
  render(<ComicContent {...props} mode="paged" onPosition={jest.fn()} />);
  layout();
  const image = await screen.findByLabelText('Trang 1');
  fireEvent(screen.getByTestId('comic-page-viewport'), 'layout', {
    nativeEvent: { layout: { height: 280 } },
  });
  expect(image).toHaveStyle({ width: 140, height: 280 });
  fireEvent(screen.getByTestId('comic-page-viewport'), 'layout', {
    nativeEvent: { layout: { height: 200 } },
  });
  expect(image).toHaveStyle({ width: 100, height: 200 });
});
test('changing modes retains the current page without creating a progress write', async () => {
  const changed = jest.fn();
  const { rerender } = render(<ComicContent {...props} onPosition={changed} />);
  layout();
  const list = screen.UNSAFE_getByType(FlatList);
  act(() =>
    list.props.onViewableItemsChanged({ viewableItems: [{ item: pages[1], isViewable: true }] }),
  );
  rerender(<ComicContent {...props} mode="paged" onPosition={changed} />);
  expect(await screen.findByLabelText('Trang 3')).toBeVisible();
  expect(changed).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Trang sau' }));
  expect(await screen.findByLabelText('Trang 7')).toBeVisible();
  changed.mockClear();
  rerender(<ComicContent {...props} mode="vertical" onPosition={changed} />);
  expect(
    screen.UNSAFE_getByType(FlatList).props.data.map((p: { pageNumber: number }) => p.pageNumber),
  ).toEqual([7]);
  expect(changed).not.toHaveBeenCalled();
});
test('vertical viewer opens/closes without interpreting zoom or late scroll events as progress', async () => {
  const changed = jest.fn();
  render(<ComicContent {...props} onPosition={changed} />);
  layout();
  await screen.findByLabelText('Trang 1');
  const list = screen.UNSAFE_getByType(FlatList);
  fireEvent(list, 'scrollBeginDrag');
  fireEvent.press(screen.getByRole('button', { name: 'Phóng to trang 1' }));
  expect(screen.getByRole('button', { name: 'Đóng ảnh phóng to' })).toBeVisible();
  fireEvent.scroll(list, {
    nativeEvent: {
      contentOffset: { y: 10 },
      contentSize: { height: 600 },
      layoutMeasurement: { height: 600 },
    },
  });
  act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
  fireEvent.scroll(list, {
    nativeEvent: {
      contentOffset: { y: 0 },
      contentSize: { height: 600 },
      layoutMeasurement: { height: 600 },
    },
  });
  expect(screen.queryByTestId('comic-zoom-viewport')).toBeNull();
  expect(changed).not.toHaveBeenCalled();
});
test('zoom buttons resize image 100–300%, reset and Android modal Back closes viewer', async () => {
  const close = jest.fn();
  render(<ComicPageViewer page={pages[1]} theme={readerThemes.light} onClose={close} />);
  fireEvent(screen.getByTestId('comic-zoom-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 500 } },
  });
  const image = await screen.findByLabelText('Ảnh phóng to trang 3');
  expect(screen.getByRole('button', { name: 'Phóng to ảnh' })).toBeDisabled();
  fireEvent(image, 'load');
  expect(screen.getByRole('button', { name: 'Thu nhỏ ảnh' })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: 'Phóng to ảnh' }));
  expect(screen.getByText('150%')).toBeVisible();
  expect(image).toHaveStyle({ width: 450, height: 900 });
  for (let i = 0; i < 5; i++) fireEvent.press(screen.getByRole('button', { name: 'Phóng to ảnh' }));
  expect(screen.getByText('300%')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Phóng to ảnh' })).toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: 'Thu nhỏ ảnh' }));
  expect(screen.getByText('250%')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Đặt lại kích thước ảnh' }));
  expect(screen.getByText('100%')).toBeVisible();
  act(() => screen.UNSAFE_getByType(Modal).props.onRequestClose());
  expect(close).toHaveBeenCalledTimes(1);
});
test('failed image can retry in paged mode and cannot mark completion before it loads', async () => {
  jest.spyOn(Image, 'getSize').mockImplementation((_url, _success, failure) => {
    failure?.(new Error('image'));
    return Promise.resolve({ width: 0, height: 0 });
  });
  const changed = jest.fn();
  render(<ComicContent {...props} pages={[pages[0]]} mode="paged" onPosition={changed} />);
  layout();
  expect(await screen.findByText('Không tải được trang 1.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Đã đọc hết chương' })).toBeDisabled();
  const count = jest.mocked(Image.getSize).mock.calls.length;
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại trang 1' }));
  await waitFor(() => expect(jest.mocked(Image.getSize).mock.calls.length).toBeGreaterThan(count));
  expect(changed).not.toHaveBeenCalled();
});
test('zoom image failure is retryable and zoom resets when viewport changes', async () => {
  render(<ComicPageViewer page={pages[0]} theme={readerThemes.dark} onClose={jest.fn()} />);
  fireEvent(screen.getByTestId('comic-zoom-viewport'), 'layout', {
    nativeEvent: { layout: { width: 300, height: 500 } },
  });
  fireEvent(await screen.findByLabelText('Ảnh phóng to trang 1'), 'error');
  expect(await screen.findByText('Không tải được ảnh phóng to.')).toBeVisible();
  fireEvent.press(screen.getByRole('button', { name: 'Thử lại ảnh phóng to' }));
  fireEvent(await screen.findByLabelText('Ảnh phóng to trang 1'), 'load');
  fireEvent.press(screen.getByRole('button', { name: 'Phóng to ảnh' }));
  expect(screen.getByText('150%')).toBeVisible();
  fireEvent(screen.getByTestId('comic-zoom-viewport'), 'layout', {
    nativeEvent: { layout: { width: 500, height: 300 } },
  });
  expect(screen.getByText('100%')).toBeVisible();
});
