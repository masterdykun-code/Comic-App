import { AxiosError } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { diagnostic, failureDetails } from '../src/lib/diagnostics';
import { createApiClient } from '../src/services/api';
import { createAuthSession } from '../src/stores/auth';
import { createCatalogApi } from '../src/features/stories/api';
import { ApiError } from '../src/lib/errors';
import { input, transport, vault } from './fixtures';
const base = 'http://192.168.1.43:4001/api';
let output: jest.SpyInstance;
const originalDev = __DEV__;
beforeEach(() => {
  Object.defineProperty(globalThis, '__DEV__', { value: true, configurable: true, writable: true });
  output = jest.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  output.mockRestore();
  Object.defineProperty(globalThis, '__DEV__', {
    value: originalDev,
    configurable: true,
    writable: true,
  });
});
const events = () => output.mock.calls.map((call) => JSON.parse(call[1] as string));
test('production diagnostics produce no output', () => {
  Object.defineProperty(globalThis, '__DEV__', { value: false });
  diagnostic('api.config', { baseURL: base });
  expect(output).not.toHaveBeenCalled();
});
test('diagnostics strip query, credentials, arbitrary path, headers, body and raw error', () => {
  const secret = 'PRIVATE_SENTINEL';
  diagnostic('request.fail', {
    baseURL: base,
    url: `/stories?search=${secret}&token=${secret}`,
    method: 'get',
    headers: { Authorization: secret },
    data: { password: secret },
    error: secret,
  } as never);
  diagnostic('api.config', { baseURL: `http://user:${secret}@example.invalid/api` });
  diagnostic('request.fail', { baseURL: base, url: `/stories/${secret}`, code: secret });
  expect(JSON.stringify(output.mock.calls)).not.toContain(secret);
  expect(events()[0]).toMatchObject({ baseURL: base, path: '/api/stories', method: 'GET' });
  expect(events()[1].baseURL).toBeUndefined();
  expect(events()[2].path).toBe('/api/[redacted]');
});
test('network, timeout, HTTP and application failures remain distinguishable', () => {
  expect(failureDetails(new AxiosError('private', 'ERR_NETWORK'))).toMatchObject({
    kind: 'network',
    code: 'ERR_NETWORK',
  });
  expect(failureDetails(new AxiosError('private', 'ECONNABORTED'))).toMatchObject({
    kind: 'timeout',
  });
  for (const status of [400, 500])
    expect(
      failureDetails(
        AxiosError.from(new Error('private'), 'ERR_BAD_RESPONSE', undefined, undefined, {
          status,
        } as never),
      ),
    ).toMatchObject({ kind: 'http', status });
  expect(failureDetails(new ApiError(502, 'private'))).toMatchObject({
    kind: 'application',
    status: 502,
  });
});
test('public request logs auth preparation then dispatch then HTTP result without secrets', async () => {
  const session = createAuthSession(transport(), vault());
  const client = createApiClient(base, session);
  const mock = new MockAdapter(client);
  mock.onGet('/stories').reply(200, { success: true });
  await client.get('/stories', { params: { search: 'PRIVATE_SEARCH' } });
  expect(events().map((e) => e.event)).toEqual([
    'api.config',
    'request.auth.start',
    'request.auth.ready',
    'request.start',
    'request.complete',
  ]);
  expect(events().at(-1)).toMatchObject({ status: 200, requestId: expect.any(Number) });
  expect(JSON.stringify(output.mock.calls)).not.toContain('PRIVATE_SEARCH');
});
test('expired session refresh failure can block Stories before dispatch; logging preserves existing behavior', async () => {
  let now = 0;
  const http = transport();
  const session = createAuthSession(http, vault(), () => now);
  await session.login(input);
  now = 1_000_000;
  http.refresh.mockRejectedValue(new ApiError(0, 'PRIVATE_FAILURE'));
  output.mockClear();
  const client = createApiClient(base, session);
  const mock = new MockAdapter(client);
  mock.onGet('/stories').reply(200, {});
  await expect(client.get('/stories')).rejects.toMatchObject({ status: 0 });
  expect(events().map((e) => e.event)).toEqual(
    expect.arrayContaining([
      'request.auth.start',
      'session.refresh.start',
      'session.refresh.fail',
      'request.auth.fail',
    ]),
  );
  expect(events().some((e) => e.event === 'request.start')).toBe(false);
  expect(mock.history.get).toHaveLength(0);
  expect(JSON.stringify(output.mock.calls)).not.toMatch(
    /PRIVATE|synthetic|signature|Synthetic-only-password/,
  );
});
test('HTTP success followed by invalid catalog shape logs parse failure, not network failure', async () => {
  const session = createAuthSession(transport(), vault());
  const client = createApiClient(base, session);
  new MockAdapter(client).onGet('/stories').reply(200, { success: true, data: 'PRIVATE_PAYLOAD' });
  await expect(createCatalogApi(client).stories()).rejects.toMatchObject({ status: 502 });
  expect(events().map((e) => e.event)).toEqual(
    expect.arrayContaining(['request.complete', 'catalog.parse.fail']),
  );
  expect(events().some((e) => e.event === 'request.fail')).toBe(false);
  expect(JSON.stringify(output.mock.calls)).not.toContain('PRIVATE_PAYLOAD');
});
test('logger failures never block a request and timeout retains its original classification', async () => {
  const client = createApiClient(base, createAuthSession(transport(), vault()));
  new MockAdapter(client).onGet('/stories').timeout();
  output.mockImplementation(() => {
    throw new Error('console unavailable');
  });
  await expect(client.get('/stories')).rejects.toMatchObject({ code: 'TIMEOUT' });
});
