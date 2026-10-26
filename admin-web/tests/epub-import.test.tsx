import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, expect, it, vi } from 'vitest';
import { AppProviders } from '../src/app/providers';
import { AppRoutes } from '../src/routes/AppRoutes';
import { Session } from '../src/features/auth/session';
import { epubApi, type EpubPreview } from '../src/features/stories/epub-api';
import { storiesApi } from '../src/features/stories/api';
import { ApiError } from '../src/lib/api/errors';
import { deferred, input, transport } from './fixtures';

vi.mock('../src/features/stories/epub-api', () => ({
  epubApi: { preview: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), status: vi.fn() },
}));
vi.mock('../src/features/stories/api', () => ({ storiesApi: { genres: vi.fn() } }));
const id = '10000000-0000-4000-8000-000000000001';
const preview: EpubPreview = {
  previewId: id,
  expiresAt: '2026-10-20T10:00:00Z',
  title: 'Sách EPUB thử',
  authorName: 'Tác giả',
  chapterCount: 2,
  duplicate: false,
  warnings: ['Chỉ nhập bản nháp.'],
  sample: 'Tiếng Việt dòng đầu.\n\nDòng sau <script>không thực thi</script>.',
  coverDataUrl: null,
  chapters: [
    { chapterNumber: 1, title: 'Chương 1', characters: 200 },
    { chapterNumber: 2, title: 'Chương 2', characters: 300 },
  ],
};
beforeEach(() => {
  vi.mocked(epubApi.preview).mockReset().mockResolvedValue(preview);
  vi.mocked(epubApi.confirm).mockReset().mockResolvedValue({ id, chapterCount: 2 });
  vi.mocked(epubApi.cancel).mockReset().mockResolvedValue();
  vi.mocked(epubApi.status)
    .mockReset()
    .mockResolvedValue({ status: 'imported', result: { id, chapterCount: 2 } });
  vi.mocked(storiesApi.genres).mockReset().mockResolvedValue([]);
});
async function setup(login = true) {
  const session = new Session(transport());
  if (login) await session.login(input);
  render(
    <MemoryRouter initialEntries={['/stories/import-epub']}>
      <AppProviders session={session}>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
  return userEvent.setup();
}
async function read(user: ReturnType<typeof userEvent.setup>) {
  await user.upload(
    await screen.findByLabelText('File EPUB'),
    new File(['epub'], 'book.epub', { type: 'application/epub+zip' }),
  );
  await user.click(screen.getByRole('button', { name: 'Đọc và xem trước EPUB' }));
  await screen.findByRole('heading', { name: 'Xem trước · 2 chương' });
}

it('requires ADMIN login for the import page', async () => {
  await setup(false);
  expect(await screen.findByRole('button', { name: /Đăng nhập/ })).toBeVisible();
  expect(epubApi.preview).not.toHaveBeenCalled();
});
it('previews before writing; confirms once and links to the new draft', async () => {
  const user = await setup();
  await read(user);
  expect(epubApi.confirm).not.toHaveBeenCalled();
  expect(screen.getByLabelText('Tên truyện')).toHaveValue(preview.title);
  await user.click(screen.getByText('Danh sách 2 chương theo thứ tự EPUB'));
  expect(screen.getByText(/Chương 2/)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Nhập sách nháp và 2 chương' }));
  expect(await screen.findByRole('link', { name: 'Mở sách vừa nhập' })).toHaveAttribute(
    'href',
    `/stories/${id}`,
  );
  expect(epubApi.confirm).toHaveBeenCalledTimes(1);
  expect(epubApi.confirm).toHaveBeenCalledWith(id, {
    title: preview.title,
    authorName: preview.authorName,
    description: '',
    genreIds: [],
    useCover: false,
  });
});
it('blocks duplicate previews, preserving existing data', async () => {
  vi.mocked(epubApi.preview).mockResolvedValue({ ...preview, duplicate: true });
  const user = await setup();
  await read(user);
  expect(screen.getByRole('button', { name: 'Nhập sách nháp và 2 chương' })).toBeDisabled();
  expect(epubApi.confirm).not.toHaveBeenCalled();
});
it('locks submit during import and checks a lost response without replaying POST', async () => {
  const waiting = deferred<{ id: string; chapterCount: number }>();
  vi.mocked(epubApi.confirm).mockReturnValue(waiting.promise);
  const user = await setup();
  await read(user);
  await user.click(screen.getByRole('button', { name: 'Nhập sách nháp và 2 chương' }));
  expect(screen.getByRole('button', { name: 'Nhập sách nháp và 2 chương' })).toBeDisabled();
  waiting.reject(new ApiError(0, 'Mất kết nối'));
  await screen.findByRole('button', { name: 'Kiểm tra kết quả' });
  await user.click(screen.getByRole('button', { name: 'Kiểm tra kết quả' }));
  await screen.findByRole('link', { name: 'Mở sách vừa nhập' });
  expect(epubApi.confirm).toHaveBeenCalledTimes(1);
  expect(epubApi.status).toHaveBeenCalledWith(id);
});
it('can discard a preview without creating a book', async () => {
  const user = await setup();
  await read(user);
  await user.click(screen.getByRole('button', { name: 'Hủy bản xem trước' }));
  await waitFor(() =>
    expect(screen.queryByRole('heading', { name: 'Xem trước · 2 chương' })).not.toBeInTheDocument(),
  );
  expect(epubApi.cancel).toHaveBeenCalledWith(id);
  expect(epubApi.confirm).not.toHaveBeenCalled();
});
