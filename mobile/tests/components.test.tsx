import { fireEvent, render, screen } from '@testing-library/react-native';
import { AppHeader } from '../src/components/AppHeader';
import { StoryCard } from '../src/components/StoryCard';
import { EmptyState, ErrorState, LoadingState } from '../src/components/States';
import { StoryCover } from '../src/components/StoryCover';
test('header and semantic loading/empty/error states render', () => {
  render(
    <>
      <AppHeader title="Khám phá" />
      <LoadingState label="Đang tải" />
      <EmptyState title="Không có truyện" message="Chưa tải dữ liệu" />
      <ErrorState message="Mất kết nối" />
    </>,
  );
  expect(screen.getByText('Khám phá')).toBeVisible();
  expect(screen.getByLabelText('Đang tải')).toBeVisible();
  expect(screen.getByText('Không có truyện')).toBeVisible();
  expect(screen.getByRole('alert')).toBeVisible();
});
test('error state only retries after an explicit action', () => {
  const retry = jest.fn();
  render(<ErrorState message="Mất mạng" onRetry={retry} />);
  expect(retry).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Thử lại'));
  expect(retry).toHaveBeenCalledTimes(1);
});
test.each(['NOVEL', 'COMIC'] as const)(
  'StoryCard supports %s with a cover fallback and explicit navigation callback',
  (type) => {
    const press = jest.fn();
    render(
      <StoryCard
        story={{ id: 'test', title: 'Fixture chỉ trong test', authorName: 'QA', type }}
        onPress={press}
      />,
    );
    expect(screen.getByText(type === 'NOVEL' ? 'TIỂU THUYẾT' : 'TRUYỆN TRANH')).toBeVisible();
    fireEvent.press(screen.getByLabelText('Xem Fixture chỉ trong test'));
    expect(press).toHaveBeenCalledTimes(1);
  },
);

test('broken cover images use a neutral fallback with 2:3 dimensions', () => {
  render(<StoryCover url="https://example.test/cover.png" title="Ảnh lỗi" width={80} />);
  const image = screen.getByLabelText('Ảnh bìa Ảnh lỗi');
  expect(image).toHaveStyle({ width: 80, height: 120 });
  fireEvent(image, 'error');
  expect(screen.getByLabelText('Chưa có ảnh bìa')).toBeVisible();
});
test('non-HTTP cover URLs never become image sources', () => {
  render(<StoryCover url="file:///private/image.png" title="Không hợp lệ" />);
  expect(screen.queryByLabelText('Ảnh bìa Không hợp lệ')).toBeNull();
  expect(screen.getByLabelText('Chưa có ảnh bìa')).toBeVisible();
});
