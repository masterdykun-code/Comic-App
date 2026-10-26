import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AppProviders } from '../src/app/providers';
import { AppRoutes } from '../src/routes/AppRoutes';
import { Session } from '../src/features/auth/session';
import { usersApi, type ManagedUser } from '../src/features/users/api';
import { ApiError } from '../src/lib/api/errors';
import { admin, deferred, input, transport } from './fixtures';
vi.mock('../src/features/users/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/features/users/api')>()),
  usersApi: { list: vi.fn(), detail: vi.fn(), status: vi.fn(), dashboard: vi.fn() },
}));
export const userFixture: ManagedUser = {
  ...admin,
  id: '20000000-0000-4000-8000-000000000001',
  username: 'reader',
  email: 'reader@example.test',
  displayName: 'Bạn đọc',
  role: 'USER',
  status: 'ACTIVE',
};
export const statsFixture = {
  users: { total: 20, active: 18, banned: 2 },
  stories: { total: 25, novels: 15, comics: 10, published: 22 },
  totalChapters: 1200,
  readingEvents: 87,
  readingMetric: 'STORED_AUTHENTICATED_HISTORY' as const,
  popularStories: [
    {
      id: '30000000-0000-4000-8000-000000000001',
      title: 'Truyện nổi bật',
      type: 'NOVEL' as const,
      publishStatus: 'PUBLISHED' as const,
      readCount: 50,
    },
  ],
};
let row: ManagedUser;
const routers: ReturnType<typeof createMemoryRouter>[] = [];
afterEach(() => routers.splice(0).forEach((r) => r.dispose()));
beforeEach(() => {
  row = structuredClone(userFixture);
  vi.mocked(usersApi.list)
    .mockReset()
    .mockImplementation(async (q) => ({
      data: q.search === 'không có' ? [] : [row],
      pagination: {
        page: q.page,
        limit: q.limit,
        total: q.search === 'không có' ? 0 : 1,
        totalPages: q.search === 'không có' ? 0 : 1,
      },
    }));
  vi.mocked(usersApi.detail)
    .mockReset()
    .mockImplementation(async () => ({ ...row }));
  vi.mocked(usersApi.status)
    .mockReset()
    .mockImplementation(async (input) => {
      row = { ...row, status: input.status, updatedAt: '2026-02-01T00:00:00Z' };
      return { ...row };
    });
  vi.mocked(usersApi.dashboard).mockReset().mockResolvedValue(statsFixture);
});
async function setup(path = '/users', actor: 'admin' | 'user' | 'guest' = 'admin') {
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
  return { user: userEvent.setup(), router, session };
}
it('lists USER accounts and searches names/emails with pagination reset', async () => {
  const { user } = await setup('/users?page=2');
  expect(await screen.findByText(row.email, { exact: false })).toBeVisible();
  await user.type(screen.getByLabelText('Tìm kiếm'), 'không có');
  await user.click(screen.getByRole('button', { name: 'Tìm người dùng' }));
  expect(await screen.findByText('Không có người dùng phù hợp')).toBeVisible();
  expect(usersApi.list).toHaveBeenLastCalledWith({ page: 1, limit: 20, search: 'không có' });
  expect(usersApi.status).not.toHaveBeenCalled();
});
it('shows account detail and sends a status write only after confirming, then unbans', async () => {
  const { user } = await setup(`/users/${row.id}`);
  expect(await screen.findByText(row.email)).toBeVisible();
  await user.click(screen.getByRole('button', { name: 'Khóa tài khoản' }));
  await user.click(screen.getByRole('button', { name: 'Quay lại' }));
  expect(usersApi.status).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Khóa tài khoản' }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận khóa' }));
  expect(await screen.findByRole('button', { name: 'Mở khóa tài khoản' })).toBeVisible();
  expect(usersApi.status).toHaveBeenCalledWith({
    id: row.id,
    status: 'BANNED',
    expectedUpdatedAt: userFixture.updatedAt,
  });
  await user.click(screen.getByRole('button', { name: 'Mở khóa tài khoản' }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận mở khóa' }));
  expect(await screen.findByRole('button', { name: 'Khóa tài khoản' })).toBeVisible();
});
it('pending status cannot be submitted twice and ambiguous/stale failure requires reload', async () => {
  const pending = deferred<ManagedUser>();
  vi.mocked(usersApi.status).mockReturnValue(pending.promise);
  const { user } = await setup(`/users/${row.id}`);
  await user.click(await screen.findByRole('button', { name: 'Khóa tài khoản' }));
  await user.click(screen.getByRole('button', { name: 'Xác nhận khóa' }));
  expect(
    screen.getByRole('dialog').querySelector('button[type="submit"]') ??
      screen.getByRole('button', { name: /Đang xử lý/ }),
  ).toBeDisabled();
  await act(async () => pending.reject(new ApiError(409, 'Tài khoản đã thay đổi.', 'USER_STALE')));
  expect(await screen.findByRole('alert')).toHaveTextContent('đã thay đổi');
  expect(screen.getByRole('button', { name: 'Khóa tài khoản' })).toBeDisabled();
  expect(usersApi.status).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('button', { name: 'Làm mới tài khoản' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Khóa tài khoản' })).toBeEnabled());
});
it('validates invalid filters/UUID and handles unavailable account without a mutation', async () => {
  await setup('/users/not-a-uuid');
  expect(screen.getByRole('alert')).toHaveTextContent('không hợp lệ');
  expect(usersApi.detail).not.toHaveBeenCalled();
  expect(usersApi.status).not.toHaveBeenCalled();
});
it('invalid list query does not request API', async () => {
  await setup('/users?limit=101');
  expect(screen.getByRole('alert')).toHaveTextContent('Bộ lọc không hợp lệ');
  expect(usersApi.list).not.toHaveBeenCalled();
});
it.each(['user', 'guest'] as const)('protects users and dashboard against %s', async (actor) => {
  await setup('/users', actor);
  expect(screen.getByRole('heading', { name: 'Chào mừng trở lại' })).toBeVisible();
  expect(usersApi.list).not.toHaveBeenCalled();
  expect(usersApi.dashboard).not.toHaveBeenCalled();
});
it('dashboard renders actual totals, ranking links and honest read metric', async () => {
  await setup('/dashboard');
  const section = await screen.findByRole('region', { name: 'Thống kê thư viện' });
  expect(within(section).getByText('1.200')).toBeVisible();
  expect(within(section).getByText('87')).toBeVisible();
  expect(within(section).getByText('20')).toBeVisible();
  expect(within(section).getByText(/không tính khách/)).toBeVisible();
  expect(within(section).getByRole('link', { name: 'Truyện nổi bật' })).toHaveAttribute(
    'href',
    `/stories/${statsFixture.popularStories[0]!.id}`,
  );
});
it('empty dashboard displays zero and no invented popular stories', async () => {
  vi.mocked(usersApi.dashboard).mockResolvedValue({
    ...statsFixture,
    readingEvents: 0,
    popularStories: [],
  });
  await setup('/dashboard');
  expect(await screen.findByText('Chưa có lịch sử đọc')).toBeVisible();
  expect(screen.getByText('0')).toBeVisible();
});
it('dashboard error is visible and can be retried', async () => {
  vi.mocked(usersApi.dashboard).mockRejectedValueOnce(
    new ApiError(0, 'Không thể kết nối máy chủ.'),
  );
  const { user } = await setup('/dashboard');
  expect(await screen.findByRole('alert')).toHaveTextContent('Không thể kết nối');
  await user.click(screen.getByRole('button', { name: /Tải lại/ }));
  expect(await screen.findByText('Truyện nổi bật')).toBeVisible();
});
