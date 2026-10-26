import MockAdapter from 'axios-mock-adapter';
import { createAuthSession } from '../src/stores/auth';
import { createApiClient } from '../src/services/api';
import { createAuthTransport } from '../src/services/auth';
import { createHttp } from '../src/services/http';
import { parseApiBaseUrl } from '../src/lib/config';
import { deferred, input, initial, transport, user, vault } from './fixtures';
const base = 'http://10.0.2.2:4000/api';
test('a late response from an old session is rejected without affecting the new session', async () => {
  const { client, mock, session } = await setup(true);
  const started = deferred<void>();
  const response = deferred<[number, unknown]>();
  mock.onGet('/auth/me').reply(() => {
    started.resolve();
    return response.promise;
  });
  const pending = client.get('/auth/me');
  const assertion = expect(pending).rejects.toMatchObject({ status: 401 });
  await started.promise;
  await session.logout();
  await session.login(input);
  response.resolve([200, { data: user }]);
  await assertion;
  expect(session.store.getState().status).toBe('authenticated');
});
async function setup(loggedIn = false) {
  const http = transport();
  const session = createAuthSession(http, vault());
  await session.restore();
  if (loggedIn) await session.login(input);
  const client = createApiClient(base, session);
  const mock = new MockAdapter(client, { onNoMatch: 'throwException' });
  return { client, mock, session, http };
}
test('API config requires an explicit URL with no credentials/query, never falls back to localhost', () => {
  for (const raw of [
    undefined,
    '',
    'ftp://host/api',
    'https://user:secret@host/api',
    'https://host/api?key=secret',
    'https://host/',
    '/api',
  ])
    expect(parseApiBaseUrl(raw)).toBeNull();
  expect(parseApiBaseUrl(base + '/')).toBe(base);
  expect(parseApiBaseUrl('https://example.invalid/api')).toBe('https://example.invalid/api');
});
test('Guest can request public content without tokens or triggering refresh', async () => {
  const { client, mock, http } = await setup();
  mock.onGet('/genres').reply(200, { success: true, data: [] });
  expect((await client.get('/genres')).data.data).toEqual([]);
  expect(mock.history.get[0].headers?.Authorization).toBeUndefined();
  expect(http.refresh).not.toHaveBeenCalled();
});
test('active reader requests attach only the access token', async () => {
  const { client, mock } = await setup(true);
  mock.onGet('/auth/me').reply(200, { data: user });
  await client.get('/auth/me');
  expect(mock.history.get[0].headers?.Authorization).toBe(`Bearer ${initial.accessToken}`);
  expect(JSON.stringify(mock.history.get[0].headers)).not.toContain(initial.refreshToken);
});
test.each([400, 403, 404, 409, 429, 500])(
  'HTTP %s is safe and never leaks raw API error details',
  async (status) => {
    const { client, mock, http } = await setup(true);
    mock.onGet('/genres').reply(status, {
      error: { code: 'PRIVATE', message: 'DATABASE_URL private passwordHash' },
      stack: 'private trace',
    });
    await expect(client.get('/genres')).rejects.toMatchObject({ status });
    try {
      await client.get('/genres');
    } catch (error) {
      expect(JSON.stringify(error)).not.toMatch(/passwordHash|DATABASE_URL|private trace/);
    }
    expect(http.refresh).not.toHaveBeenCalled();
  },
);
test('network failure and timeout produce actionable safe messages', async () => {
  const { client, mock } = await setup();
  mock.onGet('/genres').networkErrorOnce();
  mock.onGet('/genres').timeoutOnce();
  await expect(client.get('/genres')).rejects.toMatchObject({
    status: 0,
    message: expect.stringContaining('kết nối'),
  });
  await expect(client.get('/genres')).rejects.toMatchObject({ status: 0, code: 'TIMEOUT' });
});
test('missing API config fails before a network adapter can run', async () => {
  const http = transport();
  const session = createAuthSession(http, vault());
  const client = createApiClient(null, session);
  const mock = new MockAdapter(client);
  await expect(client.get('/genres')).rejects.toMatchObject({ code: 'API_NOT_CONFIGURED' });
  expect(mock.history).toHaveLength(0);
});
test('cross-origin requests are refused before leaking an Authorization header', async () => {
  const { client, mock } = await setup(true);
  await expect(client.get('https://other.invalid/api/genres')).rejects.toMatchObject({
    status: 400,
  });
  expect(mock.history).toHaveLength(0);
});
test('concurrent 401 reads share one rotation and each replay at most once', async () => {
  const { client, mock, http } = await setup(true);
  mock.onGet('/genres').replyOnce(401).onGet('/genres').reply(200, { data: [] });
  mock.onGet('/stories').replyOnce(401).onGet('/stories').reply(200, { data: [] });
  await Promise.all([client.get('/genres'), client.get('/stories')]);
  expect(http.refresh).toHaveBeenCalledTimes(1);
  expect(mock.history.get).toHaveLength(4);
});
test('a second 401 expires the session without a refresh loop', async () => {
  const { client, mock, session, http } = await setup(true);
  mock.onGet('/genres').reply(401);
  await expect(client.get('/genres')).rejects.toMatchObject({ status: 401 });
  expect(http.refresh).toHaveBeenCalledTimes(1);
  expect(mock.history.get).toHaveLength(2);
  expect(session.store.getState().status).toBe('guest');
});
test('401 never replays a mutation and 403 does not discard a valid reader session', async () => {
  const { client, mock, session, http } = await setup(true);
  mock.onGet('/genres').reply(403);
  await expect(client.get('/genres')).rejects.toMatchObject({ status: 403 });
  expect(session.peek()).not.toBeNull();
  mock.onPost('/never-called-for-real').reply(401);
  await expect(client.post('/never-called-for-real', {})).rejects.toMatchObject({ status: 401 });
  expect(mock.history.post).toHaveLength(1);
  expect(http.refresh).not.toHaveBeenCalled();
});
test('auth transport matches JSON contract, registration returns user only, no HttpOnly-cookie assumption', async () => {
  const client = createHttp(base);
  const mock = new MockAdapter(client, { onNoMatch: 'throwException' });
  const auth = createAuthTransport(base, client);
  mock.onPost('/auth/login').reply(200, { data: initial });
  mock.onPost('/auth/register').reply(201, { data: user });
  mock.onPost('/auth/refresh').reply(200, { data: initial });
  mock.onPost('/auth/logout').reply(200, { success: true });
  mock.onGet('/auth/me').reply(200, { data: user });
  expect(await auth.login(input)).toEqual(initial);
  expect(
    await auth.register({ ...input, username: user.username, role: 'ADMIN' } as never),
  ).toEqual(user);
  await auth.refresh(initial.refreshToken);
  await auth.logout(initial.refreshToken);
  expect(await auth.me(initial.accessToken)).toEqual(user);
  expect(JSON.parse(mock.history.post[1].data)).toEqual({ ...input, username: user.username });
  expect(mock.history.post.slice(2).map((r) => JSON.parse(r.data))).toEqual([
    { refreshToken: initial.refreshToken },
    { refreshToken: initial.refreshToken },
  ]);
  expect(client.defaults.withCredentials).toBe(false);
  expect(client.defaults.timeout).toBe(12000);
});
