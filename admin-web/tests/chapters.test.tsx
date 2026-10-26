import { act, render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders } from '../src/app/providers';
import { AppRoutes } from '../src/routes/AppRoutes';
import { Session } from '../src/features/auth/session';
import { storiesApi } from '../src/features/stories/api';
import { chaptersApi } from '../src/features/chapters/api';
import { ApiError } from '../src/lib/api/errors';
import {
  chapterList,
  chapterId,
  storyId,
  testChapter,
  testComic,
  testStory,
} from './chapter-fixtures';
import { deferred, input, transport } from './fixtures';
import type { ChapterList } from '../src/features/chapters/model';
vi.mock('../src/features/stories/api', () => ({
  storiesApi: {
    list: vi.fn(),
    detail: vi.fn(),
    genres: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    upload: vi.fn(),
  },
}));
vi.mock('../src/features/chapters/api', () => ({
  chaptersApi: {
    list: vi.fn(),
    detail: vi.fn(),
    vip: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    pages: vi.fn(),
    publish: vi.fn(),
    upload: vi.fn(),
  },
}));
const root = `/stories/${storyId}/chapters`;
const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => {
  routers.splice(0).forEach((router) => router.dispose());
});
beforeEach(() => {
  vi.mocked(storiesApi.list).mockReset();

  vi.mocked(storiesApi.detail).mockReset().mockResolvedValue(testStory);
  vi.mocked(chaptersApi.list).mockReset().mockResolvedValue(chapterList);
  vi.mocked(chaptersApi.detail).mockReset().mockResolvedValue(testChapter);
  vi.mocked(chaptersApi.create).mockReset().mockResolvedValue(testChapter);
  vi.mocked(chaptersApi.update).mockReset().mockResolvedValue(testChapter);
  vi.mocked(chaptersApi.pages).mockReset().mockResolvedValue(testComic);
  vi.mocked(chaptersApi.publish)
    .mockReset()
    .mockResolvedValue({ ...testChapter, publishStatus: 'PUBLISHED' });
  vi.mocked(chaptersApi.upload)
    .mockReset()
    .mockImplementation(async (files) =>
      files.map((_file, order) => ({
        order: order + 1,
        publicId: `mock-${order}`,
        secureUrl: `https://images.example.test/new-${order}.png`,
      })),
    );
});
async function setup(path = root, actor: 'admin' | 'guest' | 'user' = 'admin') {
  const auth = transport();
  const session = new Session(auth);
  if (actor === 'user') auth.me.mockResolvedValue({ ...testUser(), role: 'USER' });
  if (actor !== 'guest') await session.login(input).catch(() => {});
  const router = createMemoryRouter(
    [
      {
        path: '*',
        element: (
          <AppProviders session={session}>
            <AppRoutes />
          </AppProviders>
        ),
      },
    ],
    { initialEntries: [path] },
  );
  routers.push(router);
  render(<RouterProvider router={router} useTransitions={false} />);
  return { user: userEvent.setup(), router, session };
}
function testUser() {
  return {
    id: 'qa-user',
    username: 'qa',
    displayName: 'QA User',
    email: 'user@example.test',
    avatarUrl: null,
    role: 'USER' as const,
    status: 'ACTIVE' as const,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}
function comic() {
  vi.mocked(storiesApi.detail).mockResolvedValue({ ...testStory, type: 'COMIC' });
  vi.mocked(chaptersApi.detail).mockResolvedValue(testComic);
  vi.mocked(chaptersApi.create).mockResolvedValue({ ...testComic, pages: [] });
}
it('renders DRAFT/PUBLISHED rows and pagination without a Delete action', async () => {
  await setup();
  expect(await screen.findByRole('link', { name: testChapter.title })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Chương xuất bản' })).toBeVisible();
  expect(screen.getByText('Bản nháp')).toBeVisible();
  expect(screen.queryByRole('button', { name: /Xóa chương/ })).not.toBeInTheDocument();
});
it('handles loading and then empty data without mock content in the UI', async () => {
  const pending = deferred<ChapterList>();
  vi.mocked(chaptersApi.list).mockReturnValue(pending.promise);
  await setup();
  expect(await screen.findByText('Đang tải chương…')).toBeVisible();
  await act(async () =>
    pending.resolve({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
  );
  expect(await screen.findByText('Chưa có chương ở trang này')).toBeVisible();
});
it('shows list errors and supports explicit reload', async () => {
  vi.mocked(chaptersApi.list).mockRejectedValue(new ApiError(403, 'Không có quyền.'));
  const { user } = await setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('Không có quyền');
  vi.mocked(chaptersApi.list).mockResolvedValue(chapterList);
  await user.click(screen.getByRole('button', { name: 'Tải lại' }));
  expect(await screen.findByRole('link', { name: testChapter.title })).toBeVisible();
});
it('paginates with supported server parameters', async () => {
  vi.mocked(chaptersApi.list).mockResolvedValue({
    ...chapterList,
    pagination: { page: 1, limit: 20, total: 30, totalPages: 2 },
  });
  const { user } = await setup();
  await screen.findByRole('link', { name: testChapter.title });
  await user.click(screen.getByRole('button', { name: 'Trang sau' }));
  await waitFor(() =>
    expect(chaptersApi.list).toHaveBeenLastCalledWith(storyId, 2, 20, expect.any(AbortSignal)),
  );
});
it('does not create an invalid NOVEL form', async () => {
  const { user } = await setup(`${root}/new`);
  await user.click(await screen.findByRole('button', { name: 'Tạo chương nháp' }));
  expect(await screen.findByText('Vui lòng nhập tên chương.')).toBeVisible();
  expect(chaptersApi.create).not.toHaveBeenCalled();
});
it('creates a NOVEL draft with unchanged newlines and plain text', async () => {
  const { user } = await setup(`${root}/new`);
  await user.type(await screen.findByLabelText('Tên chương'), 'Một chương mới');
  await user.type(screen.getByLabelText('Nội dung chương'), 'Dòng A\n\nDòng B <b>plain text</b>');
  await user.click(screen.getByRole('button', { name: 'Tạo chương nháp' }));
  await waitFor(() =>
    expect(chaptersApi.create).toHaveBeenCalledWith(storyId, {
      chapterNumber: 1,
      title: 'Một chương mới',
      content: 'Dòng A\n\nDòng B <b>plain text</b>',
    }),
  );
  expect(chaptersApi.publish).not.toHaveBeenCalled();
  expect(await screen.findByRole('heading', { name: testChapter.title })).toBeVisible();
});
it('creates a COMIC metadata draft without a content field then opens the page editor', async () => {
  comic();
  const { user } = await setup(`${root}/new`);
  await user.type(await screen.findByLabelText('Tên chương'), 'Chương COMIC');
  expect(screen.queryByLabelText('Nội dung chương')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Tạo chương nháp' }));
  await waitFor(() =>
    expect(chaptersApi.create).toHaveBeenCalledWith(storyId, {
      chapterNumber: 1,
      title: 'Chương COMIC',
    }),
  );
  expect(await screen.findByRole('heading', { name: 'Trang ảnh COMIC' })).toBeVisible();
  expect(chaptersApi.upload).not.toHaveBeenCalled();
});
it('updates NOVEL content, keeps storyId immutable and preserves line breaks in detail', async () => {
  const { user } = await setup(`${root}/${chapterId}/edit`);
  const field = await screen.findByLabelText('Nội dung chương');
  await user.clear(field);
  await user.type(field, 'A\nB');
  await user.click(screen.getByRole('button', { name: 'Lưu thông tin chương' }));
  await waitFor(() =>
    expect(chaptersApi.update).toHaveBeenCalledWith(
      chapterId,
      { chapterNumber: 1, title: testChapter.title, content: 'A\nB' },
      testChapter.updatedAt,
    ),
  );
  expect(screen.queryByLabelText('storyId')).not.toBeInTheDocument();
});
it('protects a published NOVEL from empty text before sending PATCH', async () => {
  vi.mocked(chaptersApi.detail).mockResolvedValue({ ...testChapter, publishStatus: 'PUBLISHED' });
  const { user } = await setup(`${root}/${chapterId}/edit`);
  await user.clear(await screen.findByLabelText('Nội dung chương'));
  await user.click(screen.getByRole('button', { name: 'Lưu thông tin chương' }));
  expect(
    await screen.findByText('Chương đã xuất bản phải giữ nội dung chữ không trống.'),
  ).toBeVisible();
  expect(chaptersApi.update).not.toHaveBeenCalled();
});
it('warns before internal navigation and allows canceling the departure', async () => {
  const { user, router } = await setup(`${root}/new`);
  await user.type(await screen.findByLabelText('Tên chương'), 'Chưa lưu');
  await user.click(screen.getByRole('link', { name: 'Hủy' }));
  expect(await screen.findByRole('dialog', { name: 'Rời trang chương?' })).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(router.state.location.pathname).toBe(`${root}/new`);
  expect(screen.getByLabelText('Tên chương')).toHaveValue('Chưa lưu');
});
it('renders NOVEL text as text, never HTML', async () => {
  vi.mocked(chaptersApi.detail).mockResolvedValue({
    ...testChapter,
    content: '<script>not executed</script>\nLine 2',
  });
  await setup(`${root}/${chapterId}`);
  const text = await screen.findByText(/not executed/);
  expect(text.textContent).toBe('<script>not executed</script>\nLine 2');
  expect(document.querySelector('.chapters-novel script')).toBeNull();
});
it('selecting pages does not upload; confirming uploads one batch and never auto-saves pages', async () => {
  comic();
  const { user } = await setup(`${root}/${chapterId}/edit`);
  const files = [
    new File(['a'], 'a.png', { type: 'image/png' }),
    new File(['b'], 'b.png', { type: 'image/png' }),
  ];
  await user.upload(await screen.findByLabelText('Chọn ảnh trang truyện'), files);
  expect(chaptersApi.upload).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: /Xác nhận tải batch tiếp theo/ }));
  expect(chaptersApi.upload).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Tải 2 ảnh trong batch này' }));
  await waitFor(() =>
    expect(chaptersApi.upload).toHaveBeenCalledExactlyOnceWith(files, expect.any(Function)),
  );
  expect(await screen.findByAltText('Trang 4')).toHaveAttribute(
    'src',
    'https://images.example.test/new-1.png',
  );
  expect(chaptersApi.pages).not.toHaveBeenCalled();
});

it('naturally sorts selected files, reorders the queue and appends uploads without saving', async () => {
  comic();
  const { user } = await setup(`${root}/${chapterId}/edit`);
  const files = ['010.png', '002.png', '001.png'].map(
    (name) => new File(['x'], name, { type: 'image/png' }),
  );
  await user.upload(await screen.findByLabelText('Chọn ảnh trang truyện'), files);
  expect(screen.getByText('1. 001.png')).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Đưa ảnh chờ 3 lên' }));
  expect(screen.getByText('2. 010.png')).toBeVisible();
  const transfer = { setData: vi.fn(), effectAllowed: '' };
  const first = screen.getByText('1. 001.png').closest('.chapters-local-image')!;
  const last = screen.getByText('3. 002.png').closest('.chapters-local-image')!;
  fireEvent.dragStart(first, { dataTransfer: transfer });
  fireEvent.dragOver(last, { dataTransfer: transfer });
  fireEvent.drop(last, { dataTransfer: transfer });
  expect(screen.getByText('3. 001.png')).toBeVisible();
  await user.click(screen.getByRole('button', { name: /Xác nhận tải batch tiếp theo/ }));
  await user.click(screen.getByRole('button', { name: 'Tải 3 ảnh trong batch này' }));
  await waitFor(() =>
    expect(chaptersApi.upload).toHaveBeenCalledWith(
      [files[0], files[1], files[2]],
      expect.any(Function),
    ),
  );
  expect(chaptersApi.pages).not.toHaveBeenCalled();
  expect(screen.getByAltText('Trang 1')).toHaveAttribute('src', testComic.pages[0]!.imageUrl);
});

it('requires separate confirmation for batches larger than 20', async () => {
  comic();
  const { user } = await setup(`${root}/${chapterId}/edit`);
  const files = Array.from(
    { length: 21 },
    (_, n) => new File(['x'], `${n}.png`, { type: 'image/png' }),
  );
  await user.upload(await screen.findByLabelText('Chọn ảnh trang truyện'), files);
  await user.click(screen.getByRole('button', { name: /Xác nhận tải batch tiếp theo/ }));
  await user.click(screen.getByRole('button', { name: 'Tải 20 ảnh trong batch này' }));
  await screen.findByRole('button', { name: 'Xác nhận tải batch tiếp theo (1 ảnh)' });
  expect(chaptersApi.upload).toHaveBeenCalledTimes(1);
  expect(screen.getByRole('button', { name: 'Lưu danh sách trang' })).toBeDisabled();
});
it('reorders/removes pages locally then confirms replacement preserving old public IDs', async () => {
  comic();
  const { user } = await setup(`${root}/${chapterId}/edit`);
  await user.click(await screen.findByRole('button', { name: 'Đưa trang 2 lên' }));
  expect(screen.getByAltText('Trang 1')).toHaveAttribute('src', testComic.pages[1]!.imageUrl);
  expect(chaptersApi.pages).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Loại trang 2' }));
  await user.click(screen.getByRole('button', { name: 'Lưu danh sách trang' }));
  expect(chaptersApi.pages).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Xác nhận lưu danh sách trang' }));
  await waitFor(() =>
    expect(chaptersApi.pages).toHaveBeenCalledWith(
      chapterId,
      [{ pageNumber: 1, imageUrl: testComic.pages[1]!.imageUrl, storagePublicId: 'old-public-2' }],
      testComic.updatedAt,
    ),
  );
});
it('failed upload batches stop and cannot be silently replayed', async () => {
  comic();
  vi.mocked(chaptersApi.upload).mockRejectedValue(new ApiError(502, 'Dịch vụ ảnh lỗi.'));
  const { user } = await setup(`${root}/${chapterId}/edit`);
  await user.upload(
    await screen.findByLabelText('Chọn ảnh trang truyện'),
    new File(['x'], 'a.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: /Xác nhận tải batch tiếp theo/ }));
  await user.click(screen.getByRole('button', { name: 'Tải 1 ảnh trong batch này' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('không tự thử lại');
  expect(screen.getByRole('button', { name: /Xác nhận tải batch tiếp theo/ })).toBeDisabled();
  expect(chaptersApi.upload).toHaveBeenCalledTimes(1);
  expect(chaptersApi.pages).not.toHaveBeenCalled();
});
it('publishing requires confirmation and sends only saved data', async () => {
  const { user } = await setup(`${root}/${chapterId}`);
  await user.click(await screen.findByRole('button', { name: 'Xuất bản' }));
  expect(await screen.findByRole('dialog', { name: 'Xuất bản chương?' })).toBeVisible();
  expect(chaptersApi.publish).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Xác nhận xuất bản' }));
  await waitFor(() =>
    expect(chaptersApi.publish).toHaveBeenCalledWith(chapterId, testChapter.updatedAt),
  );
});
it.each(['NOVEL', 'COMIC'])('blocks invalid %s publication', async (type) => {
  vi.mocked(storiesApi.detail).mockResolvedValue({ ...testStory, type: type as 'NOVEL' | 'COMIC' });
  vi.mocked(chaptersApi.detail).mockResolvedValue({ ...testChapter, content: null, pages: [] });
  const { user } = await setup(`${root}/${chapterId}`);
  await user.click(await screen.findByRole('button', { name: 'Xuất bản' }));
  expect(await screen.findByRole('button', { name: 'Xác nhận xuất bản' })).toBeDisabled();
  expect(chaptersApi.publish).not.toHaveBeenCalled();
});
it('409 locks writes until explicit confirmed reload and never overwrites', async () => {
  vi.mocked(chaptersApi.update).mockRejectedValue(new ApiError(409, 'Có cập nhật đồng thời.'));
  const { user } = await setup(`${root}/${chapterId}/edit`);
  const title = await screen.findByLabelText('Tên chương');
  await user.clear(title);
  await user.type(title, 'Bản cục bộ');
  await user.click(screen.getByRole('button', { name: 'Lưu thông tin chương' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('đồng thời');
  expect(screen.getByRole('button', { name: 'Lưu thông tin chương' })).toBeDisabled();
  expect(chaptersApi.update).toHaveBeenCalledTimes(1);
  vi.mocked(chaptersApi.detail).mockResolvedValue({
    ...testChapter,
    title: 'Bản mới trên server',
    updatedAt: '2026-02-01T00:00:00Z',
  });
  await user.click(screen.getByRole('button', { name: 'Tải lại dữ liệu chương' }));
  await user.click(screen.getByRole('button', { name: 'Bỏ thay đổi và tải lại' }));
  await waitFor(() =>
    expect(screen.getByLabelText('Tên chương')).toHaveValue('Bản mới trên server'),
  );
  expect(screen.getByRole('button', { name: 'Lưu thông tin chương' })).toBeEnabled();
  expect(chaptersApi.update).toHaveBeenCalledTimes(1);
});
it.each([400, 401, 403, 404])('handles HTTP %s with safe errors', async (status) => {
  vi.mocked(chaptersApi.update).mockRejectedValue(new ApiError(status, `Lỗi an toàn ${status}`));
  const { user } = await setup(`${root}/${chapterId}/edit`);
  await user.click(await screen.findByRole('button', { name: 'Lưu thông tin chương' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(`Lỗi an toàn ${status}`);
  expect(document.body.textContent).not.toContain('signature');
});
it.each(['guest', 'user'] as const)('blocks %s without admin API queries', async (actor) => {
  await setup(`${root}/new`, actor);
  expect(await screen.findByRole('heading', { name: 'Chào mừng trở lại' })).toBeVisible();
  expect(chaptersApi.list).not.toHaveBeenCalled();
  expect(chaptersApi.detail).not.toHaveBeenCalled();
});
it('page replacement conflicts preserve local order and lock writes until reload', async () => {
  comic();
  vi.mocked(chaptersApi.pages).mockRejectedValue(new ApiError(409, 'Danh sách trang đã thay đổi.'));
  const { user } = await setup(`${root}/${chapterId}/edit`);
  await user.click(await screen.findByRole('button', { name: 'Đưa trang 2 lên' }));
  await user.click(screen.getByRole('button', { name: 'Lưu danh sách trang' }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận lưu danh sách trang' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('đã thay đổi');
  expect(screen.getByAltText('Trang 1')).toHaveAttribute('src', testComic.pages[1]!.imageUrl);
  expect(screen.getByRole('button', { name: 'Lưu danh sách trang' })).toBeDisabled();
  expect(chaptersApi.pages).toHaveBeenCalledTimes(1);
});
it('publication is blocked while the parent Story remains DRAFT', async () => {
  vi.mocked(storiesApi.detail).mockResolvedValue({ ...testStory, publishStatus: 'DRAFT' });
  const { user } = await setup(`${root}/${chapterId}`);
  await user.click(await screen.findByRole('button', { name: 'Xuất bản' }));
  expect(await screen.findByRole('button', { name: 'Xác nhận xuất bản' })).toBeDisabled();
  expect(screen.getByRole('alert')).toHaveTextContent('xuất bản truyện trước');
  expect(chaptersApi.publish).not.toHaveBeenCalled();
});
it('refuses mismatched Story/Chapter routes before rendering an editor', async () => {
  vi.mocked(chaptersApi.detail).mockResolvedValue({
    ...testChapter,
    storyId: '20000000-0000-4000-8000-000000000099',
  });
  await setup(`${root}/${chapterId}/edit`);
  expect(await screen.findByRole('alert')).toHaveTextContent('không thuộc truyện');
  expect(screen.queryByRole('button', { name: 'Lưu thông tin chương' })).not.toBeInTheDocument();
});

it.each(['NOVEL', 'COMIC'] as const)(
  'ADMIN confirms FREE/VIP switch for %s and cancel sends no write',
  async (type) => {
    const current = type === 'NOVEL' ? testChapter : testComic;
    vi.mocked(storiesApi.detail).mockResolvedValue({ ...testStory, type });
    vi.mocked(chaptersApi.detail).mockResolvedValue({ ...current, isVip: false, coinPrice: 10 });
    vi.mocked(chaptersApi.vip)
      .mockReset()
      .mockImplementation(async (_id, isVip, coinPrice) => ({
        ...current,
        isVip,
        coinPrice,
        updatedAt: isVip ? '2026-03-01T00:00:00Z' : '2026-03-02T00:00:00Z',
      }));
    const { user } = await setup(`${root}/${chapterId}`);
    await user.selectOptions(await screen.findByLabelText('Chế độ chương'), 'VIP');
    expect(screen.getByLabelText('Giá mở khóa (Coin)')).toHaveValue(10);
    await user.click(screen.getByRole('button', { name: 'Lưu quyền đọc' }));
    await user.click(screen.getByRole('button', { name: 'Quay lại' }));
    expect(chaptersApi.vip).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Lưu quyền đọc' }));
    await user.click(screen.getByRole('button', { name: 'Xác nhận quyền đọc' }));
    expect(await screen.findByText('VIP · 10 Coin')).toBeVisible();
    expect(chaptersApi.vip).toHaveBeenCalledWith(chapterId, true, 10, current.updatedAt);
    await user.selectOptions(screen.getByLabelText('Chế độ chương'), 'FREE');
    await user.click(screen.getByRole('button', { name: 'Lưu quyền đọc' }));
    await user.click(screen.getByRole('button', { name: 'Xác nhận quyền đọc' }));
    expect(await screen.findByText('Miễn phí cho mọi độc giả')).toBeVisible();
  },
);
it('VIP invalid price cannot save and stale write requires reload', async () => {
  vi.mocked(chaptersApi.vip)
    .mockReset()
    .mockRejectedValue(new ApiError(409, 'Chương đã thay đổi.', 'CHAPTER_STALE'));
  const { user } = await setup(`${root}/${chapterId}`);
  await user.selectOptions(await screen.findByLabelText('Chế độ chương'), 'VIP');
  await user.clear(screen.getByLabelText('Giá mở khóa (Coin)'));
  await user.type(screen.getByLabelText('Giá mở khóa (Coin)'), '0');
  expect(screen.getByRole('button', { name: 'Lưu quyền đọc' })).toBeDisabled();
  await user.clear(screen.getByLabelText('Giá mở khóa (Coin)'));
  await user.type(screen.getByLabelText('Giá mở khóa (Coin)'), '10');
  await user.click(screen.getByRole('button', { name: 'Lưu quyền đọc' }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận quyền đọc' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('đã thay đổi');
  expect(screen.getByRole('button', { name: 'Tải lại chương để kiểm tra' })).toBeVisible();
});
