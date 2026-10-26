import { create } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { runOwnedRequest } from '../src/features/library/session';
import { createLibraryApi } from '../src/features/library/api';
import { authSession } from '../src/services/runtime';
import { deferred, user } from './fixtures';
import { novel } from './catalog-fixtures';
jest.mock('../src/services/runtime', () => ({
  api: jest.requireActual('axios').default.create(),
  authSession: {
    store: jest
      .requireActual('zustand/vanilla')
      .createStore(() => ({ status: 'authenticated', user: null, notice: null })),
  },
}));
beforeEach(() => authSession.store.setState({ status: 'authenticated', user }));
const active = () => authSession.store.getState().user?.id === user.id;
test('owner change while Axios is waiting prevents an old mutation from reaching the adapter under the new account', async () => {
  const client = create();
  const gate = deferred<void>();
  const mock = new MockAdapter(client);
  client.interceptors.request.use(async (config) => {
    await gate.promise;
    return config;
  });
  mock.onDelete(`/me/favorites/${novel.id}`).reply(200, { success: true, data: { removed: true } });
  const request = runOwnedRequest(active, (signal) =>
    createLibraryApi(client).remove(novel.id, signal),
  );
  authSession.store.setState({ user: { ...user, id: '10000000-0000-4000-8000-000000000002' } });
  gate.resolve();
  await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(mock.history.delete).toHaveLength(0);
  mock.restore();
});
test('query cancellation also prevents dispatch when the account remains active', async () => {
  const client = create();
  const gate = deferred<void>();
  const mock = new MockAdapter(client);
  const source = new AbortController();
  client.interceptors.request.use(async (config) => {
    await gate.promise;
    return config;
  });
  mock.onGet('/me/favorites').reply(200, {});
  const request = runOwnedRequest(
    active,
    (signal) => createLibraryApi(client).favorites(1, 12, signal),
    source.signal,
  );
  source.abort();
  gate.resolve();
  await expect(request).rejects.toMatchObject({ code: 'ERR_CANCELED' });
  expect(mock.history.get).toHaveLength(0);
  mock.restore();
});
