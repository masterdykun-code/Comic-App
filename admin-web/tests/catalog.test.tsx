import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders } from '../src/app/providers';
import { AppRoutes } from '../src/routes/AppRoutes';
import { Session } from '../src/features/auth/session';
import { genresApi } from '../src/features/genres/api';
import { commentsApi } from '../src/features/comments/api';
import { storiesApi } from '../src/features/stories/api';
import { ApiError } from '../src/lib/api/errors';
import { genreInputSchema } from '../src/features/genres/model';
import { genre, rootComment, replyComment, catalogStoryId } from './catalog-fixtures';
import { admin, deferred, input, transport } from './fixtures';
import type { Genre } from '../src/features/stories/model';
import type { AdminComment, CommentList } from '../src/features/comments/model';
vi.mock('../src/features/stories/api', () => ({
  storiesApi: {
    genres: vi.fn(),
    list: vi.fn(),
    detail: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    publish: vi.fn(),
    upload: vi.fn(),
  },
}));
vi.mock('../src/features/genres/api', () => ({
  genresApi: { create: vi.fn(), update: vi.fn(), remove: vi.fn() },
}));
vi.mock('../src/features/comments/api', () => ({
  commentsApi: { list: vi.fn(), moderate: vi.fn() },
}));
let genres: Genre[];
let comments: AdminComment[];
const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => routers.splice(0).forEach((router) => router.dispose()));
beforeEach(() => {
  genres = [{ ...genre }];
  comments = structuredClone([rootComment, replyComment]);
  vi.mocked(storiesApi.genres)
    .mockReset()
    .mockImplementation(async () => [...genres]);
  vi.mocked(genresApi.create)
    .mockReset()
    .mockImplementation(async (value) => {
      const row = { ...value, id: '30000000-0000-4000-8000-000000000002' };
      genres.push(row);
      return row;
    });
  vi.mocked(genresApi.update)
    .mockReset()
    .mockImplementation(async (id, value) => {
      const row = { id, ...value };
      genres = genres.map((g) => (g.id === id ? row : g));
      return row;
    });
  vi.mocked(genresApi.remove)
    .mockReset()
    .mockImplementation(async (id) => {
      genres = genres.filter((g) => g.id !== id);
      return { id, removed: true };
    });
  vi.mocked(commentsApi.list)
    .mockReset()
    .mockImplementation(async (q) => {
      const rows = comments.filter(
        (c) =>
          (!q.status || c.status === q.status) &&
          (!q.storyId || c.storyId === q.storyId) &&
          (!q.parentId || c.parentId === q.parentId),
      );
      return {
        data: rows.slice((q.page - 1) * q.limit, q.page * q.limit),
        pagination: {
          page: q.page,
          limit: q.limit,
          total: rows.length,
          totalPages: Math.ceil(rows.length / q.limit),
        },
      };
    });
  vi.mocked(commentsApi.moderate)
    .mockReset()
    .mockImplementation(async (id, status) => {
      comments = comments.map((c) =>
        c.id === id
          ? { ...c, status }
          : c.parentId === id && c.parent
            ? { ...c, parent: { ...c.parent, status } }
            : c,
      );
      return { id, status, storyId: catalogStoryId, updatedAt: '2026-02-01T00:00:00Z' };
    });
});
async function setup(path = '/genres', actor: 'admin' | 'guest' | 'user' = 'admin') {
  const auth = transport();
  if (actor === 'user') auth.me.mockResolvedValue({ ...admin, role: 'USER' });
  const session = new Session(auth);
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
  return { user: userEvent.setup(), router };
}
async function fillGenre(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Thêm thể loại' }));
  await user.type(screen.getByLabelText('Tên thể loại'), 'Khoa học');
  await user.click(screen.getByRole('button', { name: 'Tạo slug từ tên' }));
}
it('renders genres from the existing shared list query', async () => {
  await setup();
  expect(await screen.findByText(genre.name)).toBeVisible();
  expect(screen.getByText(genre.slug)).toBeVisible();
});
it('renders genre loading, then an empty list honestly', async () => {
  const pending = deferred<Genre[]>();
  vi.mocked(storiesApi.genres).mockReturnValue(pending.promise);
  await setup();
  expect(screen.getByText('Đang tải thể loại…')).toBeVisible();
  await act(async () => pending.resolve([]));
  expect(await screen.findByText('Chưa có thể loại')).toBeVisible();
});
it('invalid genre forms send no request', async () => {
  const { user } = await setup();
  await user.click(screen.getByRole('button', { name: 'Thêm thể loại' }));
  await user.click(screen.getByRole('button', { name: 'Tạo thể loại' }));
  expect(await screen.findByText('Vui lòng nhập tên thể loại.')).toBeVisible();
  expect(genresApi.create).not.toHaveBeenCalled();
});
it('create requires confirmation and refreshes the shared genre cache used by Story forms', async () => {
  const { user, router } = await setup();
  await screen.findByText(genre.name);
  await fillGenre(user);
  expect(screen.getByLabelText('Slug thể loại')).toHaveValue('khoa-hoc');
  await user.click(screen.getByRole('button', { name: 'Tạo thể loại' }));
  expect(genresApi.create).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Xác nhận tạo thể loại' }));
  expect(await screen.findByText('Khoa học', { selector: 'td' })).toBeVisible();
  expect(genresApi.create).toHaveBeenCalledExactlyOnceWith({ name: 'Khoa học', slug: 'khoa-hoc' });
  await act(async () => {
    await router.navigate('/stories/new');
  });
  expect(await screen.findByRole('checkbox', { name: 'Khoa học' })).toBeVisible();
});
it('edit requires confirmation and preserves the ID', async () => {
  const { user } = await setup();
  await user.click(await screen.findByRole('button', { name: `Sửa ${genre.name}` }));
  await user.clear(screen.getByLabelText('Tên thể loại'));
  await user.type(screen.getByLabelText('Tên thể loại'), 'Phiêu lưu mới');
  await user.click(screen.getByRole('button', { name: 'Lưu thể loại' }));
  expect(genresApi.update).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Xác nhận lưu thể loại' }));
  expect(await screen.findByText('Phiêu lưu mới', { selector: 'td' })).toBeVisible();
  expect(genresApi.update).toHaveBeenCalledExactlyOnceWith(genre.id, {
    name: 'Phiêu lưu mới',
    slug: genre.slug,
  });
});
it('delete confirmation can be canceled without mutation', async () => {
  const { user } = await setup();
  await user.click(await screen.findByRole('button', { name: `Xóa ${genre.name}` }));
  expect(genresApi.remove).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(screen.getByText(genre.name, { selector: 'td' })).toBeVisible();
  expect(genresApi.remove).not.toHaveBeenCalled();
});
it('confirmed delete removes an unused genre from the list', async () => {
  const { user } = await setup();
  await user.click(await screen.findByRole('button', { name: `Xóa ${genre.name}` }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận xóa thể loại' }));
  expect(await screen.findByText('Chưa có thể loại')).toBeVisible();
  expect(genresApi.remove).toHaveBeenCalledExactlyOnceWith(genre.id);
});
it('linked genre conflict keeps the row visible and reports why deletion failed', async () => {
  vi.mocked(genresApi.remove).mockRejectedValue(
    new ApiError(409, 'Thể loại đang được truyện sử dụng nên không thể xóa.'),
  );
  const { user } = await setup();
  await user.click(await screen.findByRole('button', { name: `Xóa ${genre.name}` }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận xóa thể loại' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('đang được truyện sử dụng');
  expect(screen.getByText(genre.name, { selector: 'td' })).toBeVisible();
});
it('duplicate name/slug errors preserve form input', async () => {
  vi.mocked(genresApi.create).mockRejectedValue(new ApiError(409, 'Tên hoặc slug đã tồn tại.'));
  const { user } = await setup();
  await fillGenre(user);
  await user.click(screen.getByRole('button', { name: 'Tạo thể loại' }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận tạo thể loại' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('đã tồn tại');
  expect(screen.getByLabelText('Tên thể loại')).toHaveValue('Khoa học');
});
it('handles genre list errors and explicit refresh', async () => {
  vi.mocked(storiesApi.genres).mockRejectedValue(new ApiError(500, 'Máy chủ chưa xử lý được.'));
  const { user } = await setup();
  expect(await screen.findByRole('alert')).toHaveTextContent('Máy chủ');
  vi.mocked(storiesApi.genres).mockResolvedValue([genre]);
  await user.click(screen.getByRole('button', { name: 'Tải lại' }));
  expect(await screen.findByText(genre.name)).toBeVisible();
});
it('validates slug controls, invisible names and forbidden fields', () => {
  for (const value of [
    { name: ' ', slug: 'ok' },
    { name: 'Name', slug: '../escape' },
    { name: '\u200b', slug: 'ok' },
    { name: '<script>', slug: 'ok' },
    { name: 'Name', slug: 'ok', role: 'ADMIN' },
  ])
    expect(genreInputSchema.safeParse(value).success).toBe(false);
});
it('comments show author/story, hidden status and reply relation, with no delete action', async () => {
  await setup('/comments');
  expect(await screen.findByText(/Một câu chuyện thú vị/)).toHaveTextContent(
    /Mong chờ chương tiếp theo/,
  );
  expect(screen.getAllByText(rootComment.user.displayName)).toHaveLength(2);
  expect(screen.getAllByRole('link', { name: rootComment.story.title })).toHaveLength(2);
  expect(screen.getByText(/Phản hồi @qa_reader/)).toBeVisible();
  expect(screen.queryByRole('button', { name: /Xóa bình luận/ })).not.toBeInTheDocument();
});
it('comments loading/empty states render without fake content', async () => {
  const pending = deferred<CommentList>();
  vi.mocked(commentsApi.list).mockReturnValue(pending.promise);
  await setup('/comments');
  expect(screen.getByText('Đang tải bình luận…')).toBeVisible();
  await act(async () =>
    pending.resolve({ data: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }),
  );
  expect(await screen.findByText('Không có bình luận phù hợp')).toBeVisible();
});
it('filters comments by status/story and resets pagination', async () => {
  const { user } = await setup('/comments?page=3');
  await user.selectOptions(screen.getByLabelText('Trạng thái bình luận'), 'HIDDEN');
  await user.type(screen.getByLabelText('Lọc Story ID'), catalogStoryId);
  await user.click(screen.getByRole('button', { name: 'Áp dụng bộ lọc' }));
  await waitFor(() =>
    expect(commentsApi.list).toHaveBeenLastCalledWith(
      { page: 1, limit: 20, sort: 'newest', status: 'HIDDEN', storyId: catalogStoryId },
      expect.any(AbortSignal),
    ),
  );
  expect(screen.queryByText(rootComment.content, { exact: false })).not.toBeInTheDocument();
});
it('invalid filter input does not issue a new list request', async () => {
  const { user } = await setup('/comments');
  await screen.findByText(replyComment.content);
  const before = vi.mocked(commentsApi.list).mock.calls.length;
  await user.type(screen.getByLabelText('Lọc Story ID'), 'not-a-uuid');
  await user.click(screen.getByRole('button', { name: 'Áp dụng bộ lọc' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('UUID');
  expect(commentsApi.list).toHaveBeenCalledTimes(before);
});
it('invalid query URL is rejected without sending a malformed API query', async () => {
  await setup('/comments?status=INVALID');
  expect(screen.getByRole('alert')).toHaveTextContent('URL bộ lọc');
  expect(commentsApi.list).not.toHaveBeenCalled();
});
it('reply navigation applies bounded parentId filter', async () => {
  const { user } = await setup('/comments');
  await user.click(await screen.findByRole('button', { name: 'Xem 1 phản hồi' }));
  await waitFor(() =>
    expect(commentsApi.list).toHaveBeenLastCalledWith(
      { page: 1, limit: 20, sort: 'newest', parentId: rootComment.id },
      expect.any(AbortSignal),
    ),
  );
  expect(await screen.findByText(replyComment.content)).toBeVisible();
});
it('comment pagination requests another server page', async () => {
  vi.mocked(commentsApi.list).mockResolvedValue({
    data: [rootComment],
    pagination: { page: 1, limit: 20, total: 25, totalPages: 2 },
  });
  const { user } = await setup('/comments');
  await user.click(await screen.findByRole('button', { name: 'Trang sau' }));
  await waitFor(() =>
    expect(commentsApi.list).toHaveBeenLastCalledWith(
      { page: 2, limit: 20, sort: 'newest' },
      expect.any(AbortSignal),
    ),
  );
});
it('Hide is confirmed before writing and refreshes comments after success', async () => {
  const { user } = await setup('/comments');
  await user.click(await screen.findByRole('button', { name: `Ẩn bình luận ${rootComment.id}` }));
  expect(commentsApi.moderate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Xác nhận ẩn bình luận' }));
  expect(
    await screen.findByRole('button', { name: `Hiện bình luận ${rootComment.id}` }),
  ).toBeVisible();
  expect(commentsApi.moderate).toHaveBeenCalledExactlyOnceWith(rootComment.id, 'HIDDEN');
  expect(screen.getByText('Không xuất hiện công khai vì bình luận gốc đang ẩn.')).toBeVisible();
});
it('Show requires confirmation; cancel sends nothing', async () => {
  const { user } = await setup('/comments');
  await user.click(
    await screen.findByRole('button', { name: `Hiện bình luận ${replyComment.id}` }),
  );
  await user.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(commentsApi.moderate).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: `Hiện bình luận ${replyComment.id}` }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận hiện bình luận' }));
  await waitFor(() =>
    expect(commentsApi.moderate).toHaveBeenCalledExactlyOnceWith(replyComment.id, 'VISIBLE'),
  );
});
it.each([401, 403, 409])(
  'handles moderation HTTP %s without exposing secrets or retrying',
  async (status) => {
    vi.mocked(commentsApi.moderate).mockRejectedValue(
      new ApiError(status, `Thông báo an toàn ${status}`),
    );
    const { user } = await setup('/comments');
    await user.click(await screen.findByRole('button', { name: `Ẩn bình luận ${rootComment.id}` }));
    await user.click(screen.getByRole('button', { name: 'Xác nhận ẩn bình luận' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(`Thông báo an toàn ${status}`);
    expect(commentsApi.moderate).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).not.toContain('passwordHash');
    if (status === 409)
      expect(screen.getByRole('button', { name: `Ẩn bình luận ${rootComment.id}` })).toBeDisabled();
  },
);
it('shows safe comment list errors and supports reload', async () => {
  vi.mocked(commentsApi.list).mockRejectedValue(new ApiError(500, 'Không tải được danh sách.'));
  const { user } = await setup('/comments');
  expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được');
  vi.mocked(commentsApi.list).mockResolvedValue({
    data: [],
    pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
  });
  await user.click(screen.getByRole('button', { name: 'Tải lại' }));
  expect(await screen.findByText('Không có bình luận phù hợp')).toBeVisible();
});
it.each(['/genres', '/comments'])('Guest cannot query %s', async (path) => {
  await setup(path, 'guest');
  expect(screen.getByRole('heading', { name: 'Chào mừng trở lại' })).toBeVisible();
  expect(storiesApi.genres).not.toHaveBeenCalled();
  expect(commentsApi.list).not.toHaveBeenCalled();
});
it('USER cannot access moderation UI', async () => {
  await setup('/comments', 'user');
  expect(screen.getByRole('heading', { name: 'Chào mừng trở lại' })).toBeVisible();
  expect(commentsApi.list).not.toHaveBeenCalled();
});
