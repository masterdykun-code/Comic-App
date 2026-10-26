import { create } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { createLibraryApi } from '../src/features/library/api';
import { novel, result } from './catalog-fixtures';
import { favorite, progress, history } from './library-fixtures';
jest.mock('../src/services/runtime', () => ({ api: jest.requireActual('axios').default.create() }));
const client = create();
const mock = new MockAdapter(client);
const api = createLibraryApi(client);
beforeEach(() => mock.reset());
test.each(['favorites', 'progress', 'history'] as const)(
  'parses paginated %s without sending a userId',
  async (kind) => {
    const row = kind === 'favorites' ? favorite : kind === 'progress' ? progress : history;
    const path =
      kind === 'progress'
        ? '/me/reading-progress'
        : kind === 'history'
          ? '/me/reading-history'
          : '/me/favorites';
    mock.onGet(path).reply(200, { success: true, ...result([row], 2, 13) });
    expect(await api[kind](2)).toEqual(result([row], 2, 13));
    expect(mock.history.get[0].params).toEqual({ page: 2, limit: 12 });
  },
);
test('Favorite status requests can use limit 100 and still paginate', async () => {
  mock.onGet('/me/favorites').reply(200, { success: true, ...result([favorite], 2, 101, 100) });
  expect((await api.favorites(2, 100)).pagination.page).toBe(2);
});
test('add and remove Favorite follow the existing body and response', async () => {
  mock.onPost('/me/favorites', { storyId: novel.id }).reply(201, { success: true, data: favorite });
  mock.onDelete(`/me/favorites/${novel.id}`).reply(200, { success: true, data: { removed: true } });
  expect(await api.add(novel.id)).toEqual(favorite);
  expect(await api.remove(novel.id)).toEqual({ removed: true });
  expect(JSON.parse(mock.history.post[0].data)).toEqual({ storyId: novel.id });
});
test('clear history calls exactly the history endpoint, never favorites/progress', async () => {
  mock.onDelete('/me/reading-history').reply(200, { success: true, data: { deletedCount: 2 } });
  expect(await api.clearHistory()).toEqual({ deletedCount: 2 });
  expect(mock.history.delete).toHaveLength(1);
});
test.each([
  { ...favorite, story: { ...favorite.story, publishStatus: 'DRAFT' } },
  { ...favorite, storyId: '10000000-0000-4000-8000-000000000009' },
])('rejects private or mismatched reading payload', async (row) => {
  mock.onGet('/me/favorites').reply(200, { success: true, ...result([row]) });
  await expect(api.favorites()).rejects.toMatchObject({ status: 502 });
});
test('rejects malformed pagination without retaining raw secrets', async () => {
  mock.onGet('/me/favorites').reply(200, {
    success: true,
    ...result([favorite]),
    pagination: { page: 1, limit: 12, total: 1, totalPages: 3 },
    passwordHash: 'private',
  });
  await expect(api.favorites()).rejects.toMatchObject({
    status: 502,
    message: 'Dữ liệu giá sách chưa hợp lệ. Vui lòng thử lại.',
  });
});
