import { afterEach, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import { authHttp, authTransport } from '../src/lib/api/transport';
import { createApiClient } from '../src/lib/api/client';
import { Session } from '../src/features/auth/session';
import { initial, input, transport } from './fixtures';
const mocks: MockAdapter[] = [];
afterEach(() => {
  mocks.splice(0).forEach((mock) => mock.restore());
});
function mock(client = authHttp) {
  const value = new MockAdapter(client);
  mocks.push(value);
  return value;
}
it('uses the exact Backend JSON contract, whitelists profile fields and disables cookies', async () => {
  const adapter = mock();
  adapter.onPost('/auth/login').reply(200, {
    success: true,
    data: { ...initial, user: { ...initial.user, passwordHash: 'DO_NOT_EXPOSE' } },
  });
  const result = await authTransport.login(input);
  expect(result.user).not.toHaveProperty('passwordHash');
  expect(JSON.parse(adapter.history.post[0].data as string)).toEqual(input);
  expect(authHttp.defaults.withCredentials).toBe(false);
});
it('sanitizes network and server errors without retaining credentials/config', async () => {
  const adapter = mock();
  adapter.onPost('/auth/login').networkError();
  try {
    await authTransport.login(input);
    expect.fail('expected network failure');
  } catch (error) {
    expect(error).toMatchObject({ status: 0 });
    expect(JSON.stringify(error)).not.toContain(input.password);
    expect(error).not.toHaveProperty('config');
  }
});
it('rejects malformed success payloads safely', async () => {
  mock()
    .onPost('/auth/login')
    .reply(200, { success: true, data: { accessToken: 'broken' } });
  await expect(authTransport.login(input)).rejects.toMatchObject({ status: 502 });
});
it('shares one rotation for concurrent 401 reads and retries each read once', async () => {
  const api = transport();
  const session = new Session(api);
  await session.login(input);
  const client = createApiClient(session);
  const adapter = mock(client);
  adapter
    .onGet('/private')
    .reply((config) =>
      config.headers?.Authorization === `Bearer ${initial.accessToken}`
        ? [401, {}]
        : [200, { success: true }],
    );
  await Promise.all([client.get('/private'), client.get('/private')]);
  expect(api.refresh).toHaveBeenCalledTimes(1);
  expect(adapter.history.get).toHaveLength(4);
});
it('does not loop on persistent 401 or refresh on 403', async () => {
  const api = transport();
  const session = new Session(api);
  await session.login(input);
  const client = createApiClient(session);
  const adapter = mock(client);
  adapter.onGet('/denied').reply(403, {});
  await expect(client.get('/denied')).rejects.toMatchObject({ status: 403 });
  expect(api.refresh).not.toHaveBeenCalled();
  adapter.onGet('/expired').reply(401, {});
  await expect(client.get('/expired')).rejects.toMatchObject({ status: 401 });
  expect(api.refresh).toHaveBeenCalledTimes(1);
  expect(session.peek()).toBeNull();
});
it('never forwards authorization to an external URL or automatically replays a mutation', async () => {
  const api = transport();
  const session = new Session(api);
  await session.login(input);
  const client = createApiClient(session);
  const adapter = mock(client);
  await expect(client.get('https://external.invalid/private')).rejects.toMatchObject({
    status: 400,
  });
  expect(adapter.history.get).toHaveLength(0);
  adapter.onPost('/future-write').reply(401, {});
  await expect(client.post('/future-write', {})).rejects.toMatchObject({ status: 401 });
  expect(adapter.history.post).toHaveLength(1);
  expect(api.refresh).not.toHaveBeenCalled();
});
