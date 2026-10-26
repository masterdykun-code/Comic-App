import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Stack } from 'expo-router';
import { renderRouter, screen, fireEvent, waitFor } from 'expo-router/testing-library';
import { Text } from 'react-native';
import Login from '../src/app/login';
import Register from '../src/app/register';
import Profile from '../src/app/(tabs)/profile';
import { authSession, authTransport } from '../src/services/runtime';
import { ApiError } from '../src/lib/errors';
import { loginSchema, registerSchema } from '../src/features/auth/validation';
import { safeReturnPath } from '../src/features/auth/navigation';
import { input, user, deferred } from './fixtures';

jest.mock('../src/services/runtime', () => {
  const store = jest
    .requireActual('zustand/vanilla')
    .createStore(() => ({ status: 'guest', user: null, notice: null }));
  return {
    api: jest.requireActual('axios').default.create(),
    authTransport: { register: jest.fn() },
    authSession: { store, generation: jest.fn(() => 0), login: jest.fn(), logout: jest.fn() },
  };
});
const login = jest.mocked(authSession.login);
const register = jest.mocked(authTransport.register);
function Destination() {
  return <Text>Đích sau đăng nhập</Text>;
}
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
      register: Register,
      library: Destination,
      profile: Profile,
      history: Destination,
      'story/[id]': Destination,
    },
    { initialUrl: url },
  );
  return client;
}
function credentials() {
  fireEvent.changeText(screen.getByLabelText('Email'), input.email);
  fireEvent.changeText(screen.getByLabelText('Mật khẩu'), input.password);
}
beforeEach(() => {
  jest.clearAllMocks();
  authSession.store.setState({ status: 'guest', user: null, notice: null });
  login.mockResolvedValue(undefined);
  register.mockResolvedValue(user);
  jest.mocked(authSession.logout).mockImplementation(async () => {
    authSession.store.setState({ status: 'guest', user: null, notice: null });
  });
});
test('valid login uses the existing AuthSession and returns to a whitelisted story', async () => {
  open('/login?next=/story/20000000-0000-4000-8000-000000000001');
  credentials();
  fireEvent.press(screen.getByText('Đăng nhập'));
  await waitFor(() => expect(screen).toHavePathname('/story/20000000-0000-4000-8000-000000000001'));
  expect(login).toHaveBeenCalledWith(input);
});
test('wrong login stays on form, gives a generic safe error and clears password', async () => {
  login.mockRejectedValue(new ApiError(401, 'private backend message'));
  open();
  credentials();
  fireEvent.press(screen.getByText('Đăng nhập'));
  expect(
    await screen.findByText('Email hoặc mật khẩu chưa đúng, hoặc phiên không hợp lệ.'),
  ).toBeVisible();
  expect(screen.getByLabelText('Mật khẩu').props.value).toBe('');
  expect(screen).toHavePathname('/login');
});
test('invalid form never makes a login request', () => {
  open();
  fireEvent.press(screen.getByText('Đăng nhập'));
  expect(login).not.toHaveBeenCalled();
  expect(screen.getByText('Email chưa hợp lệ (tối đa 254 ký tự).')).toBeVisible();
});
test('password can be shown and hidden without persistence', () => {
  open();
  expect(screen.getByLabelText('Mật khẩu').props.secureTextEntry).toBe(true);
  fireEvent.press(screen.getByText('Hiện mật khẩu'));
  expect(screen.getByLabelText('Mật khẩu').props.secureTextEntry).toBe(false);
  fireEvent.press(screen.getByText('Ẩn mật khẩu'));
  expect(screen.getByLabelText('Mật khẩu').props.secureTextEntry).toBe(true);
});
test('duplicate login presses submit once and disable the form while pending', async () => {
  const pending = deferred<void>();
  login.mockReturnValue(pending.promise);
  open();
  credentials();
  const button = screen.getByText('Đăng nhập');
  fireEvent.press(button);
  fireEvent.press(button);
  await waitFor(() => expect(login).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText('Email').props.editable).toBe(false);
  pending.resolve();
  await screen.findByText('Đích sau đăng nhập');
});
test('register sends only username/email/password, then navigates to Login without auto-login', async () => {
  open('/register');
  credentials();
  fireEvent.changeText(screen.getByLabelText('Username'), ' Reader_123 ');
  fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu'), input.password);
  fireEvent.press(screen.getByText('Đăng ký'));
  await waitFor(() => expect(screen).toHavePathname('/login'));
  expect(register).toHaveBeenCalledWith({ ...input, username: 'reader_123' });
  expect(login).not.toHaveBeenCalled();
  expect(await screen.findByText('Đăng ký thành công. Hãy đăng nhập để tiếp tục.')).toBeVisible();
});
test('register validates confirmation and rejects unknown role fields', () => {
  open('/register');
  credentials();
  fireEvent.changeText(screen.getByLabelText('Username'), 'reader');
  fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu'), 'different-password');
  fireEvent.press(screen.getByText('Đăng ký'));
  expect(screen.getByText('Mật khẩu xác nhận chưa khớp.')).toBeVisible();
  expect(register).not.toHaveBeenCalled();
  expect(
    registerSchema.safeParse({
      ...input,
      username: 'reader',
      confirmPassword: input.password,
      role: 'ADMIN',
    }).success,
  ).toBe(false);
});
test('register duplicate username/email is a combined error matching the Backend contract', async () => {
  register.mockRejectedValue(new ApiError(409, 'ACCOUNT_CONFLICT'));
  open('/register');
  credentials();
  fireEvent.changeText(screen.getByLabelText('Username'), 'reader');
  fireEvent.changeText(screen.getByLabelText('Xác nhận mật khẩu'), input.password);
  fireEvent.press(screen.getByText('Đăng ký'));
  expect(await screen.findByText('Email hoặc username đã được sử dụng.')).toBeVisible();
});
test.each([
  'https://evil.invalid',
  '//evil.invalid',
  '/admin',
  '/login?next=/login',
  '/story/invalid',
  '/history#fragment',
  '/%2f%2fevil',
])('rejects unsafe redirect %s', (path) => expect(safeReturnPath(path)).toBe('/library'));
test('login schema agrees with email and password bounds', () => {
  expect(loginSchema.safeParse({ ...input, password: '1234567' }).success).toBe(false);
  expect(loginSchema.safeParse({ ...input, password: 'a'.repeat(129) }).success).toBe(false);
  expect(loginSchema.parse({ ...input, email: 'READER@EXAMPLE.INVALID' }).email).toBe(input.email);
});
test('logout requires confirmation and clears private queries/mutations before existing logout', async () => {
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  const client = open('/profile');
  client.setQueryData(['private', user.id, 0, 'favorites'], 'private data');
  client.setQueryData(['public', 'story'], 'public data');
  client
    .getMutationCache()
    .build(client, { mutationKey: ['private', user.id, 0, 'favorite-change'] });
  expect(client.getQueryData(['private', user.id, 0, 'favorites'])).toBe('private data');
  fireEvent.press(screen.getByText('Đăng xuất'));
  expect(authSession.logout).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Hủy'));
  expect(authSession.logout).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Đăng xuất'));
  fireEvent.press(screen.getByText('Xác nhận'));
  await waitFor(() => expect(authSession.logout).toHaveBeenCalledTimes(1));
  expect(client.getQueriesData({ queryKey: ['private'] })).toEqual([]);
  expect(client.getMutationCache().getAll()).toHaveLength(0);
  expect(client.getQueryData(['public', 'story'])).toBe('public data');
  expect(await screen.findByText('Chào bạn đọc')).toBeVisible();
});
test('offline logout shows the existing session warning without keeping account details visible', async () => {
  authSession.store.setState({ status: 'authenticated', user, notice: null });
  jest.mocked(authSession.logout).mockImplementation(async () => {
    authSession.store.setState({
      status: 'guest',
      user: null,
      notice: 'Đã đóng phiên trên ứng dụng. Chưa xác nhận thu hồi trên máy chủ.',
    });
  });
  open('/profile');
  fireEvent.press(screen.getByText('Đăng xuất'));
  fireEvent.press(screen.getByText('Xác nhận'));
  expect(
    await screen.findByText('Đã đóng phiên trên ứng dụng. Chưa xác nhận thu hồi trên máy chủ.'),
  ).toBeVisible();
  expect(screen.queryByText(user.email)).toBeNull();
  expect(screen.getByText('Chào bạn đọc')).toBeVisible();
});
