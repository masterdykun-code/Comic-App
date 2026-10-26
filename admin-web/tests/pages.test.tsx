import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { expect, it, vi } from 'vitest';
import { AppProviders } from '../src/app/providers';
import { AppRoutes } from '../src/routes/AppRoutes';
import { Session } from '../src/features/auth/session';
import { ApiError } from '../src/lib/api/errors';
import { admin, deferred, initial, input, transport } from './fixtures';
import type { TokenResponse } from '../src/types/auth';
vi.mock('../src/features/users/api', () => ({
  usersApi: {
    dashboard: vi.fn().mockResolvedValue({
      users: { total: 0, active: 0, banned: 0 },
      stories: { total: 0, novels: 0, comics: 0, published: 0 },
      totalChapters: 0,
      readingEvents: 0,
      readingMetric: 'STORED_AUTHENTICATED_HISTORY',
      popularStories: [],
    }),
  },
}));
function setup(path = '/login') {
  const api = transport();
  const session = new Session(api);
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppProviders session={session}>
        <AppRoutes />
      </AppProviders>
    </MemoryRouter>,
  );
  return { api, session, user: userEvent.setup() };
}
async function fill(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Địa chỉ email'), input.email);
  await user.type(screen.getByLabelText('Mật khẩu', { exact: true }), input.password);
}
it('renders login with accessible fields, validation and a hidden password', async () => {
  const { user, api } = setup();
  expect(screen.getByRole('heading', { name: 'Chào mừng trở lại' })).toBeInTheDocument();
  expect(screen.getByLabelText('Mật khẩu', { exact: true })).toHaveAttribute('type', 'password');
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByText('Vui lòng nhập email hợp lệ.')).toBeInTheDocument();
  expect(api.login).not.toHaveBeenCalled();
});
it('redirects a guest away from the protected Dashboard', () => {
  setup('/dashboard');
  expect(screen.getByRole('heading', { name: 'Chào mừng trở lại' })).toBeInTheDocument();
});
it('logs in an ADMIN, renders real profile and leaves unfinished navigation disabled', async () => {
  const { user, api } = setup();
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
  expect(screen.getByText(admin.email)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Stories' })).toHaveAttribute('href', '/stories');
  expect(screen.getByRole('link', { name: /^Chapters/ })).toHaveAttribute('href', '/stories');
  expect(screen.getByRole('link', { name: 'Genres' })).toHaveAttribute('href', '/genres');
  expect(screen.getByRole('link', { name: 'Comments' })).toHaveAttribute('href', '/comments');
  expect(screen.getByRole('link', { name: 'Users' })).toHaveAttribute('href', '/users');
  expect(screen.getByRole('button', { name: /^Settings/ })).toBeDisabled();
  expect(api.login).toHaveBeenCalledTimes(1);
  expect(localStorage.length).toBe(0);
  expect(sessionStorage.length).toBe(0);
});
it('blocks USER with a friendly error and clears the password', async () => {
  const { user, api } = setup();
  api.me.mockResolvedValue({ ...admin, role: 'USER' });
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('không có quyền');
  expect(screen.getByLabelText('Mật khẩu', { exact: true })).toHaveValue('');
  expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
});
it('shows loading and rejects duplicate login submissions', async () => {
  const { user, api } = setup();
  const wait = deferred<TokenResponse>();
  api.login.mockReturnValue(wait.promise);
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(screen.getByRole('button', { name: /Đang đăng nhập/ })).toBeDisabled();
  expect(api.login).toHaveBeenCalledTimes(1);
  await act(async () => {
    wait.resolve(initial);
  });
  expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
});
it('handles network failure without rendering server internals or credentials', async () => {
  const { user, api } = setup();
  api.login.mockRejectedValue(new ApiError(0, 'Không thể kết nối máy chủ.'));
  await fill(user);
  await user.click(screen.getByRole('button', { name: 'Đăng nhập' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Không thể kết nối');
  expect(document.body.textContent).not.toContain(input.password);
});
it('logout returns to Login and removes cached account UI', async () => {
  const { user, session } = setup();
  await act(async () => {
    await session.login(input);
  });
  await screen.findByRole('heading', { name: 'Dashboard' });
  await user.click(screen.getByRole('button', { name: 'Đăng xuất' }));
  expect(await screen.findByRole('heading', { name: 'Chào mừng trở lại' })).toBeInTheDocument();
  expect(screen.queryByText(admin.email)).not.toBeInTheDocument();
});
it('expired refresh removes the protected UI and shows a re-login message', async () => {
  const { session, api } = setup();
  await act(async () => {
    await session.login(input);
  });
  await screen.findByRole('heading', { name: 'Dashboard' });
  api.refresh.mockRejectedValue(new ApiError(401, 'Expired'));
  await act(async () => {
    await session.refresh().catch(() => {});
  });
  expect(await screen.findByRole('heading', { name: 'Chào mừng trở lại' })).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent('đăng nhập lại');
});
it('never logs passwords or tokens during login/logout', async () => {
  const output = [
    vi.spyOn(console, 'log').mockImplementation(() => {}),
    vi.spyOn(console, 'warn').mockImplementation(() => {}),
    vi.spyOn(console, 'error').mockImplementation(() => {}),
  ];
  const { session } = setup();
  await act(async () => {
    await session.login(input);
  });
  await act(async () => {
    await session.logout();
  });
  await waitFor(() =>
    expect(screen.getByRole('heading', { name: 'Chào mừng trở lại' })).toBeInTheDocument(),
  );
  const logs = JSON.stringify(output.flatMap((fn) => fn.mock.calls));
  for (const secret of [input.password, initial.accessToken, initial.refreshToken])
    expect(logs).not.toContain(secret);
});
