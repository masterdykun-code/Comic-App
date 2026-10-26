import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { changePasswordInput, createPasswordApi } from '../src/features/auth/change-password';
import { createAuthSession } from '../src/stores/auth';
import { createApiClient } from '../src/services/api';
import { initial, input, transport, vault } from './fixtures';

const values = {
  currentPassword: 'Previous-test-value',
  newPassword: 'Next-test-value',
  confirmPassword: 'Next-test-value',
};
test('password validation checks length, confirmation, unchanged password and unknown fields', () => {
  expect(changePasswordInput.safeParse(values).success).toBe(true);
  for (const bad of [
    { ...values, currentPassword: '' },
    { ...values, newPassword: 'short' },
    { ...values, newPassword: 'x'.repeat(129) },
    { ...values, confirmPassword: 'Different-value' },
    { ...values, newPassword: values.currentPassword, confirmPassword: values.currentPassword },
    { ...values, role: 'ADMIN' },
  ])
    expect(changePasswordInput.safeParse(bad).success).toBe(false);
});
test('API posts once, validates success and never keeps the response body', async () => {
  const http = axios.create(),
    mock = new MockAdapter(http),
    api = createPasswordApi(http);
  mock
    .onPost('/auth/change-password')
    .reply(200, { success: true, data: { sessionsRevoked: true } });
  await expect(api.change(values)).resolves.toBeUndefined();
  expect(JSON.parse(mock.history.post[0].data)).toEqual(values);
  expect(mock.history.post).toHaveLength(1);
});
test('shared authenticated interceptor keeps a wrong-password 403 session active and strips secrets', async () => {
  const session = createAuthSession(transport(), vault());
  await session.login(input);
  const http = createApiClient('http://10.0.2.2:4000/api', session),
    mock = new MockAdapter(http),
    api = createPasswordApi(http);
  mock.onPost('/auth/change-password').reply(403, {
    success: false,
    error: { code: 'CURRENT_PASSWORD_INCORRECT' },
    secret: values.currentPassword,
  });
  const error = await api.change(values).catch((e) => e);
  expect(error).toMatchObject({ status: 403, message: 'Mật khẩu hiện tại chưa đúng.' });
  expect(JSON.stringify(error)).not.toContain(values.currentPassword);
  expect(session.store.getState().status).toBe('authenticated');
  expect(mock.history.post).toHaveLength(1);
});
test.each([400, 401, 429, 500])('API handles HTTP %i safely, without retry', async (status) => {
  const http = axios.create(),
    mock = new MockAdapter(http),
    api = createPasswordApi(http);
  mock.onPost('/auth/change-password').reply(status, { message: values.newPassword });
  const error = await api.change(values).catch((e) => e);
  expect(error.status).toBe(status);
  expect(JSON.stringify(error)).not.toContain(values.newPassword);
  expect(mock.history.post).toHaveLength(1);
});
test('network uncertainty and malformed success never trigger an automatic resend', async () => {
  const http = axios.create(),
    mock = new MockAdapter(http),
    api = createPasswordApi(http);
  mock.onPost('/auth/change-password').networkError();
  await expect(api.change(values)).rejects.toMatchObject({
    status: 0,
    message: expect.stringContaining('Chưa xác nhận'),
  });
  mock.onPost('/auth/change-password').reply(200, { success: true });
  await expect(api.change(values)).rejects.toMatchObject({ status: 502 });
  expect(mock.history.post).toHaveLength(2);
});
test('confirmed password change clears memory and SecureStore without a redundant logout request', async () => {
  const http = transport(),
    storage = vault(),
    session = createAuthSession(http, storage);
  await session.login(input);
  const generation = session.generation();
  http.logout.mockClear();
  await session.passwordChanged(generation);
  expect(session.peek()).toBeNull();
  expect(await session.token()).toBeNull();
  expect(storage.value()).toBeNull();
  expect(http.logout).not.toHaveBeenCalled();
  expect(session.store.getState()).toMatchObject({
    status: 'guest',
    user: null,
    notice: expect.stringContaining('Đổi mật khẩu thành công'),
  });
});
test('a late password-change completion cannot log out a newer account session', async () => {
  const http = transport(),
    storage = vault(),
    session = createAuthSession(http, storage);
  await session.login(input);
  const old = session.generation();
  await session.login(input);
  await session.passwordChanged(old);
  expect(session.store.getState().status).toBe('authenticated');
  expect(session.peek()).toBe(initial.accessToken);
  expect(storage.value()).toBe(initial.refreshToken);
});
