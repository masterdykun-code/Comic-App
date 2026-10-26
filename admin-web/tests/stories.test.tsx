import { act, render, screen, waitFor, within } from '@testing-library/react';
import { StrictMode } from 'react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AppProviders } from '../src/app/providers';
import { AppRoutes } from '../src/routes/AppRoutes';
import { Session } from '../src/features/auth/session';
import { storiesApi } from '../src/features/stories/api';
import { ApiError } from '../src/lib/api/errors';
import {
  coverFileError,
  storyFormSchema,
  type Story,
  type StoryList,
} from '../src/features/stories/model';
import { deferred, initial, input, transport } from './fixtures';

vi.mock('../src/features/stories/api', () => ({
  storiesApi: {
    list: vi.fn(),
    detail: vi.fn(),
    genres: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    unpublish: vi.fn(),
    remove: vi.fn(),
    upload: vi.fn(),
  },
}));
const id = '20000000-0000-4000-8000-000000000001';
const genre = { id: '30000000-0000-4000-8000-000000000001', name: 'Phiêu lưu', slug: 'phieu-luu' };
const story: Story = {
  id,
  title: 'Hành trình bình minh',
  slug: 'hanh-trinh',
  type: 'NOVEL',
  authorName: 'QA Author',
  description: 'Câu chuyện kiểm thử.',
  coverUrl: '',
  status: 'ONGOING',
  publishStatus: 'DRAFT',
  genres: [genre],
  chapterCount: 0,
  createdBy: 'qa-admin',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};
const list: StoryList = {
  data: [story],
  pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
};
beforeEach(() => {
  vi.mocked(storiesApi.list).mockReset().mockResolvedValue(list);
  vi.mocked(storiesApi.detail).mockReset().mockResolvedValue(story);
  vi.mocked(storiesApi.genres).mockReset().mockResolvedValue([genre]);
  vi.mocked(storiesApi.create).mockReset().mockResolvedValue(story);
  vi.mocked(storiesApi.update).mockReset().mockResolvedValue(story);
  vi.mocked(storiesApi.publish)
    .mockReset()
    .mockResolvedValue({ ...story, publishStatus: 'PUBLISHED' });
  vi.mocked(storiesApi.upload)
    .mockReset()
    .mockResolvedValue({ secureUrl: 'https://example.test/cover.png', publicId: 'mock-cover' });
  vi.mocked(storiesApi.unpublish)
    .mockReset()
    .mockResolvedValue({ ...story, publishStatus: 'DRAFT' });
  vi.mocked(storiesApi.remove).mockReset().mockResolvedValue({ deleted: true });
});
async function setup(path = '/stories', authenticated = true) {
  const auth = transport();
  const session = new Session(auth);
  if (authenticated) await session.login(input);
  render(
    <StrictMode>
      <MemoryRouter initialEntries={[path]}>
        <AppProviders session={session}>
          <AppRoutes />
        </AppProviders>
      </MemoryRouter>
    </StrictMode>,
  );
  return { user: userEvent.setup(), session, auth };
}
async function fields(user: ReturnType<typeof userEvent.setup>, type = 'NOVEL') {
  await user.type(await screen.findByLabelText(/Tên truyện/), 'Truyện mới');
  await user.type(screen.getByLabelText(/Tác giả/), 'Tác giả mới');
  await user.selectOptions(screen.getByLabelText('Loại truyện'), type);
}
it('renders list metadata, detail/edit actions and deletion behind confirmation', async () => {
  await setup();
  expect(await screen.findByRole('link', { name: story.title })).toBeVisible();
  expect(screen.getByText('QA Author')).toBeVisible();
  expect(screen.getAllByText('Bản nháp').some((node) => node.tagName === 'SPAN')).toBe(true);
  expect(screen.getByRole('link', { name: `Sửa ${story.title}` })).toHaveAttribute(
    'href',
    `/stories/${id}/edit`,
  );
  expect(screen.getByRole('button', { name: `Xóa truyện ${story.title}` })).toBeVisible();
  expect(storiesApi.remove).not.toHaveBeenCalled();
  expect(storiesApi.list).toHaveBeenCalledWith(
    { page: 1, limit: 20, sort: 'newest' },
    expect.any(AbortSignal),
  );
});
it('shows loading until the list resolves', async () => {
  const pending = deferred<StoryList>();
  vi.mocked(storiesApi.list).mockReturnValue(pending.promise);
  await setup();
  expect(screen.getByText('Đang tải truyện…')).toBeVisible();
  await act(async () => pending.resolve(list));
  expect(await screen.findByText(story.title)).toBeVisible();
});
it('shows an honest empty library with a create action', async () => {
  vi.mocked(storiesApi.list).mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  await setup();
  expect(await screen.findByText('Thư viện đang chờ câu chuyện đầu tiên')).toBeVisible();
  expect(screen.getAllByRole('link', { name: 'Tạo truyện mới' })).toHaveLength(2);
});
it('shows list failure and retries only on explicit action', async () => {
  vi.mocked(storiesApi.list).mockRejectedValue(
    new ApiError(500, 'Máy chủ chưa thể xử lý yêu cầu.'),
  );
  const { user } = await setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('Máy chủ');
  vi.mocked(storiesApi.list).mockResolvedValue(list);
  await user.click(screen.getByRole('button', { name: 'Tải lại' }));
  expect(await screen.findByText(story.title)).toBeVisible();
});
it('search and all filters use supported server params and reset page', async () => {
  const { user } = await setup('/stories?page=3');
  await screen.findByText(story.title);
  await user.type(screen.getByRole('textbox', { name: 'Tìm tên truyện' }), 'bình minh');
  await user.selectOptions(screen.getByLabelText('Loại truyện'), 'COMIC');
  await user.selectOptions(screen.getByLabelText('Xuất bản'), 'DRAFT');
  await user.selectOptions(screen.getByLabelText('Trạng thái'), 'COMPLETED');
  await user.selectOptions(screen.getByLabelText('Thể loại'), genre.id);
  await user.selectOptions(screen.getByLabelText('Sắp xếp'), 'title');
  await user.click(screen.getByRole('button', { name: 'Áp dụng' }));
  await waitFor(() =>
    expect(storiesApi.list).toHaveBeenLastCalledWith(
      {
        page: 1,
        limit: 20,
        search: 'bình minh',
        type: 'COMIC',
        publishStatus: 'DRAFT',
        status: 'COMPLETED',
        genreId: genre.id,
        sort: 'title',
      },
      expect.any(AbortSignal),
    ),
  );
});
it('pagination navigates to a real server page', async () => {
  vi.mocked(storiesApi.list).mockResolvedValue({
    ...list,
    pagination: { ...list.pagination, total: 25, totalPages: 2 },
  });
  const { user } = await setup();
  await screen.findByText(story.title);
  await user.click(screen.getByRole('button', { name: 'Trang sau' }));
  await waitFor(() =>
    expect(storiesApi.list).toHaveBeenLastCalledWith(
      { page: 2, limit: 20, sort: 'newest' },
      expect.any(AbortSignal),
    ),
  );
});
it('rejects an invalid form without creating a story', async () => {
  const { user } = await setup('/stories/new');
  await screen.findByLabelText(/Tên truyện/);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Lưu bản nháp' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  expect(await screen.findByText('Vui lòng nhập tên truyện.')).toBeVisible();
  expect(storiesApi.create).not.toHaveBeenCalled();
});
it.each(['NOVEL', 'COMIC'])(
  'creates %s as a draft, then navigates to ADMIN detail',
  async (type) => {
    const { user } = await setup('/stories/new');
    await fields(user, type);
    await user.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
    await waitFor(() =>
      expect(storiesApi.create).toHaveBeenCalledWith({
        title: 'Truyện mới',
        authorName: 'Tác giả mới',
        type,
        description: '',
        coverUrl: '',
        genreIds: [],
        status: 'ONGOING',
      }),
    );
    expect(await screen.findByRole('heading', { name: story.title })).toBeVisible();
    expect(await screen.findByText('Đã tạo bản nháp.')).toBeVisible();
    expect(storiesApi.publish).not.toHaveBeenCalled();
  },
);
it('blocks editing type for existing chapters while preserving form validity', async () => {
  vi.mocked(storiesApi.detail).mockResolvedValue({ ...story, chapterCount: 2 });
  const { user } = await setup(`/stories/${id}/edit`);
  expect(await screen.findByRole('combobox', { name: /^Loại truyện/ })).toBeDisabled();
  const title = screen.getByLabelText(/Tên truyện/);
  await user.clear(title);
  await user.type(title, 'Đã chỉnh sửa');
  await user.click(screen.getByRole('button', { name: 'Lưu thay đổi' }));
  await waitFor(() =>
    expect(storiesApi.update).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ title: 'Đã chỉnh sửa', type: 'NOVEL', genreIds: [genre.id] }),
      true,
    ),
  );
  expect(storiesApi.create).not.toHaveBeenCalled();
});
it('requires a dialog confirmation before publishing and invalidates the list', async () => {
  const { user } = await setup(`/stories/${id}`);
  await screen.findByRole('heading', { name: story.title });
  await user.click(screen.getByRole('button', { name: 'Xuất bản' }));
  const dialog = screen.getByRole('dialog', { name: 'Xuất bản truyện?' });
  expect(storiesApi.publish).not.toHaveBeenCalled();
  await user.click(within(dialog).getByRole('button', { name: 'Xác nhận xuất bản' }));
  await waitFor(() => expect(storiesApi.publish).toHaveBeenCalledTimes(1));
  expect(await screen.findByText('Đã xuất bản truyện.')).toBeVisible();
});
it('canceling publication sends no mutation', async () => {
  const { user } = await setup(`/stories/${id}`);
  await screen.findByRole('heading', { name: story.title });
  await user.click(screen.getByRole('button', { name: 'Xuất bản' }));
  await user.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(storiesApi.publish).not.toHaveBeenCalled();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});
it('publication errors explain actual requirements', async () => {
  vi.mocked(storiesApi.publish).mockRejectedValue(
    new ApiError(
      400,
      'Xuất bản cần mô tả, URL ảnh bìa hợp lệ và ít nhất một thể loại.',
      'STORY_NOT_PUBLISHABLE',
    ),
  );
  const { user } = await setup(`/stories/${id}`);
  await screen.findByRole('heading', { name: story.title });
  await user.click(screen.getByRole('button', { name: 'Xuất bản' }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận xuất bản' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Xuất bản cần');
});
it('cover selection previews only; upload requires two explicit actions and uses returned URL', async () => {
  const { user } = await setup('/stories/new');
  await fields(user);
  const file = new File(['mock-png'], 'cover.png', { type: 'image/png' });
  await user.upload(screen.getByLabelText('Chọn ảnh bìa'), file);
  expect(await screen.findByAltText('Xem trước ảnh bìa đã chọn, chưa tải lên')).toBeVisible();
  expect(storiesApi.upload).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Lưu bản nháp' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Xác nhận tải ảnh lên' }));
  expect(storiesApi.upload).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Tải lên Cloudinary' }));
  await waitFor(() =>
    expect(screen.getByLabelText('URL ảnh bìa')).toHaveValue('https://example.test/cover.png'),
  );
  expect(storiesApi.upload).toHaveBeenCalledExactlyOnceWith(file);
  await user.click(screen.getByRole('button', { name: 'Hủy' }));
  expect(screen.getByRole('dialog')).toHaveTextContent('Cloudinary');
});
it('upload failure is visible and never retried automatically', async () => {
  vi.mocked(storiesApi.upload).mockRejectedValue(
    new ApiError(502, 'Dịch vụ ảnh chưa xử lý được yêu cầu.'),
  );
  const { user } = await setup('/stories/new');
  await screen.findByLabelText(/Tên truyện/);
  await user.upload(
    screen.getByLabelText('Chọn ảnh bìa'),
    new File(['x'], 'cover.png', { type: 'image/png' }),
  );
  await user.click(screen.getByRole('button', { name: 'Xác nhận tải ảnh lên' }));
  await user.click(screen.getByRole('button', { name: 'Tải lên Cloudinary' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('không tự gửi lại');
  expect(storiesApi.upload).toHaveBeenCalledTimes(1);
  expect(storiesApi.create).not.toHaveBeenCalled();
});
it('rejects SVG and oversized files before upload', () => {
  expect(coverFileError(new File(['x'], 'bad.svg', { type: 'image/svg+xml' }))).toContain('SVG');
  expect(
    coverFileError(
      new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    ),
  ).toContain('5 MiB');
  expect(coverFileError(new File(['x'], 'ok.webp', { type: 'image/webp' }))).toBe('');
});
it.each([401, 403, 409])('handles HTTP %s safely without leaking request data', async (status) => {
  const message =
    status === 401
      ? 'Phiên đăng nhập đã hết hạn.'
      : status === 403
        ? 'Không có quyền.'
        : 'Dữ liệu có xung đột.';
  vi.mocked(storiesApi.create).mockRejectedValue(new ApiError(status, message));
  const { user } = await setup('/stories/new');
  await fields(user);
  await user.click(screen.getByRole('button', { name: 'Lưu bản nháp' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(message);
  expect(document.body.textContent).not.toContain('signature');
});
it('guest cannot render Stories or issue admin queries', async () => {
  await setup('/stories', false);
  expect(screen.getByRole('heading', { name: 'Chào mừng trở lại' })).toBeVisible();
  expect(storiesApi.list).not.toHaveBeenCalled();
});
it('USER login cannot reach Stories', async () => {
  const auth = transport();
  auth.me.mockResolvedValue({ ...initial.user, role: 'USER' });
  const session = new Session(auth);
  await expect(session.login(input)).rejects.toThrow();
  render(
    <MemoryRouter initialEntries={['/stories']}>
      <AppProviders session={session}>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
  expect(screen.getByRole('heading', { name: 'Chào mừng trở lại' })).toBeVisible();
  expect(storiesApi.list).not.toHaveBeenCalled();
});
it('invalid UUID does not query detail', async () => {
  await setup('/stories/not-an-id');
  expect(screen.getByRole('alert')).toHaveTextContent('UUID');
  expect(storiesApi.detail).not.toHaveBeenCalled();
});
it('detail shows 404 and never falls back to public data', async () => {
  vi.mocked(storiesApi.detail).mockRejectedValue(new ApiError(404, 'Không tìm thấy truyện.'));
  await setup(`/stories/${id}`);
  expect(await screen.findByRole('alert')).toHaveTextContent('Không tìm thấy');
});
describe('form contract', () => {
  it('rejects arbitrary fields, invalid URLs and duplicate genres', () => {
    const valid = {
      title: 'A',
      type: 'NOVEL',
      authorName: 'B',
      description: '',
      coverUrl: '',
      genreIds: [],
      status: 'ONGOING',
    };
    expect(storyFormSchema.safeParse({ ...valid, createdBy: 'forged' }).success).toBe(false);
    expect(storyFormSchema.safeParse({ ...valid, coverUrl: 'javascript:alert(1)' }).success).toBe(
      false,
    );
    expect(storyFormSchema.safeParse({ ...valid, genreIds: [genre.id, genre.id] }).success).toBe(
      false,
    );
  });
});

it('list deletion can be canceled; confirmed deletion sends only the selected snapshot and refreshes the list', async () => {
  const other = { ...story, id: '20000000-0000-4000-8000-000000000002', title: 'Truyện khác' };
  vi.mocked(storiesApi.list).mockResolvedValue({
    ...list,
    data: [story, other],
    pagination: { ...list.pagination, total: 2 },
  });
  vi.mocked(storiesApi.remove).mockImplementation(async () => {
    vi.mocked(storiesApi.list).mockResolvedValue({ ...list, data: [other] });
    return { deleted: true };
  });
  const { user } = await setup();
  await user.click(await screen.findByRole('button', { name: `Xóa truyện ${story.title}` }));
  expect(await screen.findByRole('dialog')).toHaveTextContent('không thể hoàn tác');
  await user.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(storiesApi.remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: `Xóa truyện ${story.title}` }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận xóa vĩnh viễn' }));
  await waitFor(() =>
    expect(screen.queryByRole('link', { name: story.title })).not.toBeInTheDocument(),
  );
  expect(screen.getByRole('link', { name: other.title })).toBeVisible();
  expect(storiesApi.remove).toHaveBeenCalledExactlyOnceWith(id, story.updatedAt);
});
it('published detail can be hidden then re-published using the existing publish flow', async () => {
  const published = {
    ...story,
    coverUrl: 'https://example.test/cover.png',
    publishStatus: 'PUBLISHED' as const,
  };
  vi.mocked(storiesApi.detail).mockResolvedValue(published);
  vi.mocked(storiesApi.unpublish).mockImplementation(async () => {
    const hidden = { ...published, publishStatus: 'DRAFT' as const };
    vi.mocked(storiesApi.detail).mockResolvedValue(hidden);
    return hidden;
  });
  const { user } = await setup(`/stories/${id}`);
  await user.click(await screen.findByRole('button', { name: `Ẩn truyện ${story.title}` }));
  expect(storiesApi.unpublish).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Xác nhận ẩn truyện' }));
  expect(await screen.findByRole('button', { name: 'Xuất bản' })).toBeVisible();
  expect(storiesApi.unpublish).toHaveBeenCalledExactlyOnceWith(id);
  await user.click(screen.getByRole('button', { name: 'Xuất bản' }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận xuất bản' }));
  await waitFor(() => expect(storiesApi.publish).toHaveBeenCalledExactlyOnceWith(id));
});
it('published detail deletion navigates back to the list and cannot double submit', async () => {
  const pending = deferred<{ deleted: true }>();
  vi.mocked(storiesApi.detail).mockResolvedValue({ ...story, publishStatus: 'PUBLISHED' });
  vi.mocked(storiesApi.remove).mockReturnValue(pending.promise);
  const { user } = await setup(`/stories/${id}`);
  await user.click(await screen.findByRole('button', { name: `Xóa truyện ${story.title}` }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận xóa vĩnh viễn' }));
  expect(screen.getByRole('button', { name: 'Đang xử lý…' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Đang xử lý…' }));
  await act(async () => pending.resolve({ deleted: true }));
  expect(await screen.findByRole('heading', { name: 'Quản lý truyện' })).toBeVisible();
  expect(storiesApi.remove).toHaveBeenCalledTimes(1);
});
it('stale deletion explains the conflict and leaves the story intact', async () => {
  vi.mocked(storiesApi.remove).mockRejectedValue(
    new ApiError(409, 'Truyện đã thay đổi. Hãy tải lại dữ liệu.', 'STORY_STALE'),
  );
  const { user } = await setup();
  await user.click(await screen.findByRole('button', { name: `Xóa truyện ${story.title}` }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận xóa vĩnh viễn' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Truyện đã thay đổi');
  expect(screen.getByRole('link', { name: story.title })).toBeVisible();
  expect(storiesApi.remove).toHaveBeenCalledTimes(1);
});
it('uncertain deletion never retries automatically and tells Admin to inspect the list', async () => {
  vi.mocked(storiesApi.remove).mockRejectedValue(new ApiError(0, 'Network unavailable'));
  const { user } = await setup();
  await user.click(await screen.findByRole('button', { name: `Xóa truyện ${story.title}` }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận xóa vĩnh viễn' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Chưa xác nhận kết quả xóa');
  expect(storiesApi.remove).toHaveBeenCalledTimes(1);
});
