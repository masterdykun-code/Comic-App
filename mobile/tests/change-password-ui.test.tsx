import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor, act } from 'expo-router/testing-library';
import { Text } from 'react-native';
import Profile from '../src/app/(tabs)/profile';
import { authSession } from '../src/services/runtime';
import { passwordApi } from '../src/features/auth/change-password';
import { ApiError } from '../src/lib/errors';
import { user, deferred } from './fixtures';

jest.mock('../src/services/runtime', () => ({
  api: jest.requireActual('axios').default.create(),
  authSession: {
    store: jest
      .requireActual('zustand/vanilla')
      .createStore(() => ({ status: 'guest', user: null, notice: null })),
    generation: jest.fn(() => 0),
    passwordChanged: jest.fn(),
  },
}));
jest.mock('../src/features/auth/change-password', () => ({
  ...jest.requireActual('../src/features/auth/change-password'),
  passwordApi: { change: jest.fn() },
}));
function open() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  function Layout() {
    return (
      <QueryClientProvider client={client}>
        <Stack screenOptions={{ headerShown: false }} />
      </QueryClientProvider>
    );
  }
  renderRouter(
    { _layout: Layout, profile: Profile, login: () => <Text>Đăng nhập lại</Text> },
    { initialUrl: '/profile' },
  );
  return client;
}
function fill() {
  fireEvent.changeText(screen.getByLabelText('Mật khẩu hiện tại'), 'Previous-test-value');
  fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), 'Next-test-value');
  fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), 'Next-test-value');
}
beforeEach(() => {
  jest.clearAllMocks();
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  jest.mocked(authSession.generation).mockReturnValue(0);
  jest.mocked(passwordApi.change).mockResolvedValue(undefined);
  jest.mocked(authSession.passwordChanged).mockImplementation(async () => {
    authSession.store.setState({
      status: 'guest',
      user: null,
      notice: 'Đổi mật khẩu thành công. Vui lòng đăng nhập lại.',
    });
  });
});
test('Profile opens masked form, submits once, clears private cache and shows successful sign-out', async () => {
  const client = open();
  client.setQueryData(['private', user.id, 0, 'bookmarks'], ['private fixture']);
  fireEvent.press(screen.getByText('Đổi mật khẩu'));
  expect(screen.getByLabelText('Mật khẩu hiện tại').props.secureTextEntry).toBe(true);
  fill();
  fireEvent.press(screen.getByText('Lưu mật khẩu mới'));
  fireEvent.press(screen.getByText('Đang đổi mật khẩu…'));
  expect(await screen.findByText('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.')).toBeVisible();
  expect(passwordApi.change).toHaveBeenCalledTimes(1);
  expect(authSession.passwordChanged).toHaveBeenCalledWith(0);
  expect(client.getQueryData(['private', user.id, 0, 'bookmarks'])).toBeUndefined();
});
test('invalid or mismatched form sends no request', () => {
  open();
  fireEvent.press(screen.getByText('Đổi mật khẩu'));
  fireEvent.press(screen.getByText('Lưu mật khẩu mới'));
  expect(screen.getByText('Mật khẩu cần từ 8 đến 128 ký tự.')).toBeVisible();
  fill();
  fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), 'Incorrect-confirmation');
  fireEvent.press(screen.getByText('Lưu mật khẩu mới'));
  expect(screen.getByText('Mật khẩu xác nhận chưa khớp.')).toBeVisible();
  expect(passwordApi.change).not.toHaveBeenCalled();
});
test('wrong current password clears fields but keeps the form/session and explains the error', async () => {
  jest
    .mocked(passwordApi.change)
    .mockRejectedValue(new ApiError(403, 'Mật khẩu hiện tại chưa đúng.'));
  open();
  fireEvent.press(screen.getByText('Đổi mật khẩu'));
  fill();
  fireEvent.press(screen.getByText('Lưu mật khẩu mới'));
  expect(await screen.findByText('Mật khẩu hiện tại chưa đúng.')).toBeVisible();
  expect(screen.getByLabelText('Mật khẩu hiện tại').props.value).toBe('');
  expect(screen.getByLabelText('Mật khẩu mới').props.value).toBe('');
  expect(authSession.passwordChanged).not.toHaveBeenCalled();
  expect(authSession.store.getState().status).toBe('authenticated');
});
test('cancel discards entered secrets; Guest cannot open the password form', async () => {
  open();
  fireEvent.press(screen.getByText('Đổi mật khẩu'));
  fill();
  fireEvent.press(screen.getByText('Hủy đổi mật khẩu'));
  fireEvent.press(screen.getByText('Đổi mật khẩu'));
  expect(screen.getByLabelText('Mật khẩu hiện tại').props.value).toBe('');
  await act(async () => {
    authSession.store.setState({ status: 'guest', user: null });
  });
  expect(screen.queryByText('Đổi mật khẩu')).toBeNull();
  expect(passwordApi.change).not.toHaveBeenCalled();
});
test('late response after switching sessions does not log out the new session', async () => {
  const pending = deferred<void>();
  jest.mocked(passwordApi.change).mockReturnValue(pending.promise);
  open();
  fireEvent.press(screen.getByText('Đổi mật khẩu'));
  fill();
  fireEvent.press(screen.getByText('Lưu mật khẩu mới'));
  await waitFor(() => expect(passwordApi.change).toHaveBeenCalledTimes(1));
  await act(async () => {
    jest.mocked(authSession.generation).mockReturnValue(1);
    authSession.store.setState({
      status: 'authenticated',
      user: { ...user, id: '10000000-0000-4000-8000-000000000002' },
    });
    pending.resolve();
  });
  expect(authSession.passwordChanged).not.toHaveBeenCalled();
  expect(authSession.store.getState().status).toBe('authenticated');
});
