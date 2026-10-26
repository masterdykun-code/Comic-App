import { create } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { createCatalogApi } from '../src/features/stories/api';
import { safeError } from '../src/lib/errors';
import { chapter, comic, genre, novel, result } from './catalog-fixtures';

jest.mock('../src/services/runtime', () => ({ api: jest.requireActual('axios').default.create() }));
const client = create();
const mock = new MockAdapter(client);
const api = createCatalogApi(client);
const envelope = (value: object) => ({ success: true, message: 'OK', ...value });
beforeEach(() => mock.reset());
test('uses the public list endpoint with exact supported filters and pagination', async () => {
  const filters = {
    type: 'COMIC',
    status: 'COMPLETED',
    genreId: genre.id,
    sort: 'updated',
    search: 'Vườn mùa hạ',
    limit: 12,
  } as const;
  mock
    .onGet('/stories', { params: { ...filters, page: 2 } })
    .reply(200, envelope(result([comic], 2, 13)));
  expect(await api.stories(filters, 2)).toEqual(result([comic], 2, 13));
  expect(mock.history.get[0].params.publishStatus).toBeUndefined();
});
test('accepts published public metadata without inventing chapter counts or private fields', async () => {
  mock
    .onGet(`/stories/${novel.id}`)
    .reply(200, envelope({ data: { ...novel, createdBy: 'private', chapterCount: 999 } }));
  expect(await api.story(novel.id)).toEqual(novel);
});
test('fetches actual genre metadata', async () => {
  mock.onGet('/genres').reply(200, envelope({ data: [{ ...genre, createdAt: novel.createdAt }] }));
  expect(await api.genres()).toEqual([genre]);
});
test('genre stories endpoint does not send unsupported status, sort or search parameters', async () => {
  const { genres: _genres, ...row } = comic;
  mock.onGet(`/genres/${genre.id}/stories`).reply(200, envelope(result([row])));
  expect((await api.genreStories(genre.id, 1, 'COMIC')).data[0].genres).toEqual([]);
  expect(mock.history.get[0].params).toEqual({ page: 1, limit: 12, type: 'COMIC' });
});
test('chapter page total is the published chapter count; first chapter need not be number 1', async () => {
  mock.onGet(`/stories/${novel.id}/chapters`).reply(200, envelope(result([chapter], 1, 1, 20)));
  expect((await api.chapters(novel.id)).data[0].chapterNumber).toBe(3);
});
test.each(['stories', 'detail', 'chapters'])(
  'rejects explicit DRAFT from %s rather than rendering private content',
  async (endpoint) => {
    const path =
      endpoint === 'stories'
        ? '/stories'
        : endpoint === 'detail'
          ? `/stories/${novel.id}`
          : `/stories/${novel.id}/chapters`;
    mock
      .onGet(path)
      .reply(
        200,
        envelope(
          endpoint === 'detail'
            ? { data: { ...novel, publishStatus: 'DRAFT' } }
            : result([{ ...(endpoint === 'chapters' ? chapter : novel), publishStatus: 'DRAFT' }]),
        ),
      );
    const request =
      endpoint === 'stories'
        ? api.stories()
        : endpoint === 'detail'
          ? api.story(novel.id)
          : api.chapters(novel.id);
    await expect(request).rejects.toMatchObject({ status: 502 });
  },
);
test.each([
  { success: false, data: [novel] },
  envelope({ data: [novel], pagination: { page: 1, limit: 12, total: 1, totalPages: 99 } }),
  envelope(result([{ ...novel, type: 'OTHER' }])),
  envelope(result([{ ...novel, genres: undefined }])),
])('rejects malformed public response safely', async (body) => {
  mock.onGet('/stories').reply(200, body);
  await expect(api.stories()).rejects.toMatchObject({ status: 502 });
});
test('rejects chapters belonging to another story', async () => {
  mock
    .onGet(`/stories/${novel.id}/chapters`)
    .reply(200, envelope(result([{ ...chapter, storyId: comic.id }])));
  await expect(api.chapters(novel.id)).rejects.toMatchObject({ status: 502 });
});
test('rejects a chapter list out of order', async () => {
  mock
    .onGet(`/stories/${novel.id}/chapters`)
    .reply(200, envelope(result([chapter, { ...chapter, chapterNumber: 2 }])));
  await expect(api.chapters(novel.id)).rejects.toMatchObject({ status: 502 });
});
test.each(['network', 'timeout', 'not-found'])(
  'propagates %s through safe error handling',
  async (kind) => {
    if (kind === 'network') mock.onGet('/stories').networkError();
    else if (kind === 'timeout') mock.onGet('/stories').timeout();
    else mock.onGet('/stories').reply(404, { message: 'private database detail' });
    try {
      await api.stories();
      throw new Error('expected failure');
    } catch (error) {
      expect(safeError(error).message).not.toContain('private database detail');
      expect(safeError(error).status).toBe(kind === 'not-found' ? 404 : 0);
    }
  },
);
test('forwards the abort signal to the shared client', async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(api.stories({}, 1, controller.signal)).rejects.toMatchObject({
    code: 'ERR_CANCELED',
  });
});
