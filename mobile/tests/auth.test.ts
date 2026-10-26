import { createAuthSession } from '../src/stores/auth';
import { ApiError } from '../src/lib/errors';
import { deferred, initial, input, rotated, transport, user, vault } from './fixtures';

test('offline logout closes memory immediately and warns if remote revocation is unconfirmed', async () => {
  const http = transport();
  const storage = vault();
  const session = createAuthSession(http, storage);
  await session.login(input);
  http.logout.mockRejectedValue(new Error('network failure with private details'));
  await session.logout();
  expect(session.peek()).toBeNull();
  expect(storage.value()).toBeNull();
  expect(session.store.getState().notice).toContain('Chưa xác nhận');
  expect(JSON.stringify(session.store.getState())).not.toContain('private details');
});

test('fresh installation restores Guest without any auth write request', async () => {
  const http = transport();
  const session = createAuthSession(http, vault());
  await Promise.all([session.restore(), session.restore()]);
  expect(session.store.getState().status).toBe('guest');
  expect(http.refresh).not.toHaveBeenCalled();
  expect(http.login).not.toHaveBeenCalled();
  expect(await session.token()).toBeNull();
});
test.each(['USER', 'ADMIN'] as const)(
  'accepts active %s as a reader, with no admin feature or token in Zustand state',
  async (role) => {
    const http = transport();
    http.me.mockResolvedValue({ ...user, role, passwordHash: 'private-test-hash' } as typeof user);
    const storage = vault();
    const session = createAuthSession(http, storage);
    await session.login(input);
    expect(session.store.getState().user?.role).toBe(role);
    expect(storage.value()).toBe(initial.refreshToken);
    expect(await session.token()).toBe(initial.accessToken);
    const snapshot = JSON.stringify(session.store.getState());
    for (const value of [initial.accessToken, initial.refreshToken, 'passwordHash', input.password])
      expect(snapshot).not.toContain(value);
  },
);
test('banned accounts fail closed and revoke the issued session', async () => {
  const http = transport();
  http.me.mockResolvedValue({ ...user, status: 'BANNED' });
  const storage = vault();
  const session = createAuthSession(http, storage);
  await expect(session.login(input)).rejects.toMatchObject({ status: 401 });
  expect(session.peek()).toBeNull();
  expect(storage.value()).toBeNull();
  expect(http.logout).toHaveBeenCalledWith(initial.refreshToken);
});
test('access expiry coalesces concurrent refresh calls and persists rotation', async () => {
  let time = 0;
  const http = transport();
  const storage = vault();
  const session = createAuthSession(http, storage, () => time);
  await session.login(input);
  time = 900000;
  expect(await Promise.all([session.token(), session.token(), session.token()])).toEqual([
    rotated.accessToken,
    rotated.accessToken,
    rotated.accessToken,
  ]);
  expect(http.refresh).toHaveBeenCalledTimes(1);
  expect(http.refresh).toHaveBeenCalledWith(initial.refreshToken);
  expect(storage.value()).toBe(rotated.refreshToken);
});
test('restart restores via one real-contract refresh and reads the current profile', async () => {
  const http = transport();
  const storage = vault(initial.refreshToken);
  const session = createAuthSession(http, storage);
  await Promise.all([session.restore(), session.restore()]);
  expect(http.refresh).toHaveBeenCalledTimes(1);
  expect(http.me).toHaveBeenCalledWith(rotated.accessToken);
  expect(storage.value()).toBe(rotated.refreshToken);
});
test('expired refresh clears the vault and never loops or retries a consumed token', async () => {
  const http = transport();
  http.refresh.mockRejectedValue(new ApiError(401, 'Expired'));
  const storage = vault(initial.refreshToken);
  const session = createAuthSession(http, storage);
  await session.restore();
  await session.restore();
  expect(await session.token()).toBeNull();
  expect(http.refresh).toHaveBeenCalledTimes(1);
  expect(storage.value()).toBeNull();
  expect(session.store.getState().status).toBe('guest');
});
test('malformed stored refresh is removed without sending it to the server', async () => {
  const http = transport();
  const storage = vault('invalid');
  const session = createAuthSession(http, storage);
  await session.restore();
  expect(http.refresh).not.toHaveBeenCalled();
  expect(storage.value()).toBeNull();
});
test('logout clears memory and secure storage and revokes the correct rotated token', async () => {
  const http = transport();
  const storage = vault();
  const session = createAuthSession(http, storage);
  await session.login(input);
  await session.refresh();
  await session.logout();
  expect(session.peek()).toBeNull();
  expect(storage.value()).toBeNull();
  expect(http.logout).toHaveBeenLastCalledWith(rotated.refreshToken);
  expect(session.store.getState().status).toBe('guest');
});
test('late refresh after logout cannot resurrect a session or persist the replacement', async () => {
  const http = transport();
  const storage = vault();
  const session = createAuthSession(http, storage);
  await session.login(input);
  const pending = deferred<typeof initial>();
  http.refresh.mockReturnValue(pending.promise);
  const refresh = session.refresh();
  const assertion = expect(refresh).rejects.toMatchObject({ status: 401 });
  await session.logout();
  pending.resolve(rotated);
  await assertion;
  expect(storage.value()).toBeNull();
  expect(session.peek()).toBeNull();
  expect(http.logout).toHaveBeenCalledWith(rotated.refreshToken);
});
test('logout wins a race with a pending secure write', async () => {
  const http = transport();
  const storage = vault();
  const gate = deferred<void>();
  const original = storage.set;
  let started = false;
  storage.set = async (value) => {
    started = true;
    await gate.promise;
    await original(value);
  };
  const session = createAuthSession(http, storage);
  const login = session.login(input);
  const assertion = expect(login).rejects.toMatchObject({ status: 401 });
  while (!started) await new Promise((done) => setTimeout(done, 0));
  const logout = session.logout();
  gate.resolve();
  await Promise.all([assertion, logout]);
  expect(storage.value()).toBeNull();
  expect(session.store.getState().status).toBe('guest');
});
test('secure storage failure never falls back to plaintext or publishes a signed-in user', async () => {
  const http = transport();
  const storage = vault();
  storage.set = jest.fn().mockRejectedValue(new Error('private device details'));
  const session = createAuthSession(http, storage);
  await expect(session.login(input)).rejects.toMatchObject({ status: 500 });
  expect(session.store.getState().user).toBeNull();
  expect(JSON.stringify(session.store.getState())).not.toContain('private device details');
  expect(http.logout).toHaveBeenCalledWith(initial.refreshToken);
});
test('transport errors are sanitized and no password, token or error is logged', async () => {
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  const error = jest.spyOn(console, 'error').mockImplementation(() => {});
  try {
    const http = transport();
    http.login.mockRejectedValue(new Error(input.password));
    const session = createAuthSession(http, vault());
    await expect(session.login(input)).rejects.toMatchObject({ status: 500 });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  } finally {
    log.mockRestore();
    error.mockRestore();
  }
});
