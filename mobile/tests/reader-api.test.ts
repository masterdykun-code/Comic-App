import { create } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { createReaderApi } from '../src/features/reader/api';
import { novel } from './catalog-fixtures';
import {
  comicChapter,
  emptyProgress,
  novelChapter,
  position,
  savedProgress,
} from './reader-fixtures';
jest.mock('../src/services/runtime', () => ({ api: jest.requireActual('axios').default.create() }));
const client = create();
const mock = new MockAdapter(client);
const api = createReaderApi(client);
const response = (data: unknown) => ({ success: true, data });
beforeEach(() => mock.reset());
test('NOVEL public content retains Unicode and exact newlines', async () => {
  mock.onGet(`/chapters/${novelChapter.id}`).reply(200, response(novelChapter));
  expect(await api.chapter(novelChapter.id, novel.id)).toMatchObject({
    content: novelChapter.type === 'NOVEL' ? novelChapter.content : '',
  });
});
test('COMIC pages are sorted by actual pageNumber with no private storage IDs', async () => {
  if (comicChapter.type !== 'COMIC') throw new Error('fixture');
  mock.onGet(`/chapters/${comicChapter.id}`).reply(
    200,
    response({
      ...comicChapter,
      pages: [...comicChapter.pages].reverse().map((p) => ({ ...p, storagePublicId: 'private' })),
    }),
  );
  const data = await api.chapter(comicChapter.id, novel.id);
  expect(data).toMatchObject({ type: 'COMIC', pages: comicChapter.pages });
  expect(JSON.stringify(data)).not.toContain('storagePublicId');
});
test.each([
  { ...novelChapter, storyId: '10000000-0000-4000-8000-000000000009' },
  { ...novelChapter, publishStatus: 'DRAFT' },
  { ...novelChapter, type: 'NOVEL', content: '  ' },
  { ...comicChapter, pages: [] },
  { ...comicChapter, pages: [{ pageNumber: 1, imageUrl: 'file:///private' }] },
  {
    ...comicChapter,
    pages: [
      { pageNumber: 1, imageUrl: 'https://example.test/1' },
      { pageNumber: 1, imageUrl: 'https://example.test/2' },
    ],
  },
])('rejects mismatched/private/invalid chapter safely', async (data) => {
  mock.onGet(`/chapters/${novelChapter.id}`).reply(200, response(data));
  await expect(api.chapter(novelChapter.id, novel.id)).rejects.toMatchObject({ status: 502 });
});
test('no progress yet is a successful null snapshot', async () => {
  mock
    .onGet(`/me/reading-progress/${novel.id}`)
    .reply(200, { success: true, ...emptyProgress, resume: 'FIRST_PUBLISHED_CHAPTER' });
  expect(await api.progress(novel.id)).toEqual(emptyProgress);
});
test('hidden saved chapter preserves version even when data is null', async () => {
  mock.onGet(`/me/reading-progress/${novel.id}`).reply(200, {
    success: true,
    data: null,
    version: savedProgress.version,
    resume: 'FIRST_PUBLISHED_CHAPTER',
  });
  expect(await api.progress(novel.id)).toEqual({ data: null, version: savedProgress.version });
});
test('accepts Prisma decimal strings and whitelists progress fields', async () => {
  mock.onGet(`/me/reading-progress/${novel.id}`).reply(200, {
    success: true,
    ...savedProgress,
    data: { ...savedProgress.data, progressPercent: '25.00', story: { title: 'metadata' } },
  });
  expect(await api.progress(novel.id)).toEqual(savedProgress);
});
test('writes the exact optimistic concurrency body', async () => {
  mock.onPut(`/me/reading-progress/${novel.id}`).reply(200, { success: true, ...savedProgress });
  await api.save(novel.id, position, null);
  expect(JSON.parse(mock.history.put[0].data)).toEqual({ ...position, expectedUpdatedAt: null });
});
test('history records only story and chapter, accepting deduplicated responses', async () => {
  mock.onPost('/me/reading-history').reply(200, { success: true, data: {}, recorded: false });
  await api.history(novel.id, novelChapter.id);
  expect(JSON.parse(mock.history.post[0].data)).toEqual({
    storyId: novel.id,
    chapterId: novelChapter.id,
  });
});
