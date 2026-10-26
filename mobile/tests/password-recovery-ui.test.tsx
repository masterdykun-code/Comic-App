import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor, act } from 'expo-router/testing-library';
import { Text } from 'react-native';
import Login from '../src/app/login';
import ForgotPassword from '../src/app/forgot-password';
import { passwordRecoveryApi } from '../src/features/auth/password-recovery';
import { authSession } from '../src/services/runtime';
import { ApiError } from '../src/lib/errors';
import { deferred } from './fixtures';
jest.mock('../src/services/runtime', () => ({
  authTransport: {},
  authSession: {
    store: jest
      .requireActual('zustand/vanilla')
      .createStore(() => ({ status: 'guest', user: null, notice: null })),
    generation: () => 0,
  },
}));
jest.mock('../src/features/auth/password-recovery', () => ({
  ...jest.requireActual('../src/features/auth/password-recovery'),
  passwordRecoveryApi: { request: jest.fn(), reset: jest.fn() },
}));
function open(url = '/login') {
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
    {
      _layout: Layout,
      login: Login,
      'forgot-password': ForgotPassword,
      profile: () => <Text>Hồ sơ độc giả</Text>,
    },
    { initialUrl: url },
  );
}
async function sent() {
  open('/forgot-password');
  fireEvent.changeText(screen.getByLabelText('Email khôi phục'), 'reader@example.test');
  fireEvent.press(screen.getByText('Gửi mã xác minh'));
  await screen.findByLabelText('Mã xác minh');
}
function fill() {
  fireEvent.changeText(screen.getByLabelText('Mã xác minh'), '123456');
  fireEvent.changeText(screen.getByLabelText('Mật khẩu mới'), 'Next-test-password');
  fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), 'Next-test-password');
}
beforeEach(() => {
  jest.clearAllMocks();
  authSession.store.setState({ status: 'guest', user: null, notice: null });
  jest.mocked(passwordRecoveryApi.request).mockResolvedValue(undefined);
  jest.mocked(passwordRecoveryApi.reset).mockResolvedValue(undefined);
});
test('login exposes Forgot password and invalid email sends no request', async () => {
  open();
  fireEvent.press(screen.getByText('Quên mật khẩu?'));
  await waitFor(() => expect(screen).toHavePathname('/forgot-password'));
  fireEvent.press(screen.getByText('Gửi mã xác minh'));
  expect(screen.getByText('Địa chỉ email chưa hợp lệ.')).toBeVisible();
  expect(passwordRecoveryApi.request).not.toHaveBeenCalled();
});
test('email -> masked reset form -> success -> login without tokens or secrets in route params', async () => {
  await sent();
  expect(screen.getByText(/Nếu tài khoản đủ điều kiện/)).toBeVisible();
  expect(screen.getByLabelText('Mật khẩu mới').props.secureTextEntry).toBe(true);
  expect(screen.getByLabelText('Email khôi phục').props.editable).toBe(false);
  fill();
  fireEvent.press(screen.getByText('Đặt lại mật khẩu'));
  expect(await screen.findByText('Đặt lại mật khẩu thành công')).toBeVisible();
  expect(passwordRecoveryApi.reset).toHaveBeenCalledTimes(1);
  expect(passwordRecoveryApi.reset).toHaveBeenCalledWith(
    {
      email: 'reader@example.test',
      code: '123456',
      newPassword: 'Next-test-password',
      confirmPassword: 'Next-test-password',
    },
    expect.any(AbortSignal),
  );
  expect(screen.queryByLabelText('Mật khẩu mới')).toBeNull();
  fireEvent.press(screen.getByText('Đăng nhập bằng mật khẩu mới'));
  await waitFor(() => expect(screen).toHavePathname('/login'));
});
test('mismatched passwords block requests; invalid PIN clears secrets but keeps the reset form', async () => {
  await sent();
  fill();
  fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu mới'), 'Different-value');
  fireEvent.press(screen.getByText('Đặt lại mật khẩu'));
  expect(screen.getByText('Mật khẩu xác nhận chưa khớp.')).toBeVisible();
  expect(passwordRecoveryApi.reset).not.toHaveBeenCalled();
  jest
    .mocked(passwordRecoveryApi.reset)
    .mockRejectedValue(new ApiError(400, 'Mã không đúng, đã hết hạn hoặc đã được sử dụng.'));
  fill();
  fireEvent.press(screen.getByText('Đặt lại mật khẩu'));
  expect(await screen.findByText('Mã không đúng, đã hết hạn hoặc đã được sử dụng.')).toBeVisible();
  expect(screen.getByLabelText('Mật khẩu mới').props.value).toBe('');
  expect(screen.getByLabelText('Mã xác minh').props.value).toBe('');
});
test('resend starts disabled and changing email discards the old form', async () => {
  await sent();
  expect(screen.getByText(/Gửi lại mã sau/)).toBeVisible();
  fireEvent.press(screen.getByText(/Gửi lại mã sau/));
  expect(passwordRecoveryApi.request).toHaveBeenCalledTimes(1);
  fill();
  fireEvent.press(screen.getByText('Dùng email khác'));
  expect(screen.queryByLabelText('Mã xác minh')).toBeNull();
  expect(screen.getByLabelText('Email khôi phục').props.editable).toBe(true);
});
test('SMTP unavailable shows a clear error and does not claim that email was sent', async () => {
  jest
    .mocked(passwordRecoveryApi.request)
    .mockRejectedValue(new ApiError(503, 'Dịch vụ email chưa sẵn sàng.'));
  open('/forgot-password');
  fireEvent.changeText(screen.getByLabelText('Email khôi phục'), 'reader@example.test');
  fireEvent.press(screen.getByText('Gửi mã xác minh'));
  expect(await screen.findByText('Dịch vụ email chưa sẵn sàng.')).toBeVisible();
  expect(screen.queryByLabelText('Mã xác minh')).toBeNull();
});
test('double taps do not resend and navigation cancels the UI request without changing Auth', async () => {
  const pending = deferred<void>();
  jest.mocked(passwordRecoveryApi.request).mockReturnValue(pending.promise);
  open('/forgot-password');
  fireEvent.changeText(screen.getByLabelText('Email khôi phục'), 'reader@example.test');
  fireEvent.press(screen.getByText('Gửi mã xác minh'));
  fireEvent.press(screen.getByText('Đang xử lý…'));
  expect(passwordRecoveryApi.request).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByText('Quay lại đăng nhập'));
  await waitFor(() => expect(screen).toHavePathname('/login'));
  await act(async () => {
    pending.resolve();
  });
  expect(jest.mocked(passwordRecoveryApi.request).mock.calls).toHaveLength(1);
  expect(jest.mocked(passwordRecoveryApi.request).mock.calls[0][1]?.aborted).toBe(true);
  expect(authSession.store.getState().status).toBe('guest');
});
