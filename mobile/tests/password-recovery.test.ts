import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import {
  createPasswordRecoveryApi,
  recoveryEmailInput,
  recoveryResetInput,
} from '../src/features/auth/password-recovery';
const values = {
  email: 'reader@example.test',
  code: '123456',
  newPassword: 'Next-test-password',
  confirmPassword: 'Next-test-password',
};
test('recovery validates and normalizes email and enforces code/password confirmation', () => {
  expect(recoveryEmailInput.parse({ email: ' Reader@Example.test ' }).email).toBe(values.email);
  expect(recoveryResetInput.safeParse(values).success).toBe(true);
  for (const input of [
    { ...values, code: '123' },
    { ...values, code: 'abcdef' },
    { ...values, newPassword: 'short' },
    { ...values, newPassword: 'x'.repeat(129) },
    { ...values, confirmPassword: 'Different-value' },
    { ...values, role: 'ADMIN' },
  ])
    expect(recoveryResetInput.safeParse(input).success).toBe(false);
});
test('anonymous recovery API sends only explicit input and no Authorization header', async () => {
  const http = axios.create(),
    mock = new MockAdapter(http),
    api = createPasswordRecoveryApi(http);
  mock.onPost('/auth/forgot-password').reply(202, { success: true });
  mock
    .onPost('/auth/reset-password')
    .reply(200, { success: true, data: { sessionsRevoked: true } });
  await api.request(' Reader@Example.test ');
  await api.reset(values);
  expect(JSON.parse(mock.history.post[0].data)).toEqual({ email: values.email });
  expect(JSON.parse(mock.history.post[1].data)).toEqual(values);
  expect(mock.history.post.every((request) => !request.headers?.Authorization)).toBe(true);
  expect(mock.history.post).toHaveLength(2);
});
test('bad client input never makes a request', async () => {
  const http = axios.create(),
    mock = new MockAdapter(http),
    api = createPasswordRecoveryApi(http);
  await expect(api.request('invalid')).rejects.toMatchObject({ status: 400 });
  await expect(api.reset({ ...values, code: '0' })).rejects.toMatchObject({ status: 400 });
  expect(mock.history.post).toHaveLength(0);
});
test('invalid/expired/used code gives one safe message without retaining request secrets', async () => {
  const http = axios.create(),
    mock = new MockAdapter(http),
    api = createPasswordRecoveryApi(http);
  mock.onPost('/auth/reset-password').reply(400, {
    success: false,
    error: { code: 'INVALID_RESET_CODE' },
    message: values.newPassword,
  });
  const error = await api.reset(values).catch((e) => e);
  expect(error).toMatchObject({
    status: 400,
    code: 'INVALID_RESET_CODE',
    message: expect.stringContaining('hết hạn'),
  });
  for (const secret of [values.newPassword, values.code, values.email])
    expect(JSON.stringify(error)).not.toContain(secret);
  expect(mock.history.post).toHaveLength(1);
});
test.each([429, 500, 503])('HTTP %i is sanitized and not retried', async (status) => {
  const http = axios.create(),
    mock = new MockAdapter(http),
    api = createPasswordRecoveryApi(http);
  mock.onPost('/auth/forgot-password').reply(status, { message: 'private server detail' });
  const error = await api.request(values.email).catch((e) => e);
  expect(error.status).toBe(status);
  expect(JSON.stringify(error)).not.toContain('private');
  if (status === 503) expect(error.message).toContain('Dịch vụ email');
  expect(mock.history.post).toHaveLength(1);
});
test('network uncertainty and malformed success never auto-repeat a reset', async () => {
  const http = axios.create(),
    mock = new MockAdapter(http),
    api = createPasswordRecoveryApi(http);
  mock.onPost('/auth/reset-password').networkError();
  await expect(api.reset(values)).rejects.toMatchObject({
    status: 0,
    message: expect.stringContaining('Chưa xác nhận'),
  });
  mock.onPost('/auth/reset-password').reply(200, { success: true });
  await expect(api.reset(values)).rejects.toMatchObject({ status: 502 });
  expect(mock.history.post).toHaveLength(2);
});
