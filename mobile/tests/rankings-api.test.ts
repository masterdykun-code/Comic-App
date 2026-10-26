import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { createRankingsApi } from '../src/features/rankings/api';
import { rankedNovel, rankedComic, rankingResult } from './rankings-fixtures';
const client = axios.create(),
  mock = new MockAdapter(client),
  api = createRankingsApi(client);
afterEach(() => mock.reset());
afterAll(() => mock.restore());
test('ranking GET uses exact public query and whitelists fields', async () => {
  mock.onGet('/stories/rankings').reply((config) => {
    expect(config.params).toEqual({ kind: 'reads', type: undefined, page: 1, limit: 20 });
    return [
      200,
      rankingResult([
        { ...rankedNovel, createdBy: 'private', content: 'private' } as typeof rankedNovel,
      ]),
    ];
  });
  const result = await api.list('reads');
  expect(result.data[0]).toEqual(rankedNovel);
  expect(result.data[0]).not.toHaveProperty('createdBy');
  expect(result.data[0]).not.toHaveProperty('content');
});
test('rating/updated and NOVEL/COMIC filters retain server rank/order', async () => {
  for (const kind of ['rating', 'updated'] as const) {
    mock.onGet('/stories/rankings').reply(200, rankingResult([{ ...rankedComic, rank: 1 }], kind));
    expect((await api.list(kind, 'COMIC')).data[0]!.type).toBe('COMIC');
  }
});
test('empty ratings are returned honestly; zero reads are valid', async () => {
  mock.onGet('/stories/rankings').reply(200, rankingResult([], 'rating'));
  expect((await api.list('rating')).data).toEqual([]);
  mock
    .onGet('/stories/rankings')
    .reply(
      200,
      rankingResult([{ ...rankedNovel, readCount: 0, ratingCount: 0, averageScore: null }]),
    );
  expect((await api.list('reads')).data[0]!.readCount).toBe(0);
});
test.each([
  ['draft', { ...rankedNovel, publishStatus: 'DRAFT' }],
  ['negative reads', { ...rankedNovel, readCount: -1 }],
  ['bad average', { ...rankedNovel, averageScore: 6 }],
  ['inconsistent rating', { ...rankedNovel, ratingCount: 0 }],
  ['wrong rank', { ...rankedNovel, rank: 2 }],
  ['bad date', { ...rankedNovel, updatedAt: 'bad' }],
])('rejects %s data without rendering it', async (_label, row) => {
  mock.onGet('/stories/rankings').reply(200, rankingResult([row] as (typeof rankedNovel)[]));
  await expect(api.list('reads')).rejects.toMatchObject({ status: 502 });
});
test('rejects wrong board/filter/pagination response and duplicate IDs', async () => {
  mock.onGet('/stories/rankings').reply(200, rankingResult([rankedNovel], 'rating'));
  await expect(api.list('reads')).rejects.toMatchObject({ status: 502 });
  mock.onGet('/stories/rankings').reply(200, rankingResult([rankedNovel]));
  await expect(api.list('reads', 'COMIC')).rejects.toMatchObject({ status: 502 });
  mock
    .onGet('/stories/rankings')
    .reply(200, rankingResult([rankedNovel, { ...rankedNovel, rank: 2 }]));
  await expect(api.list('reads')).rejects.toMatchObject({ status: 502 });
});
test('invalid requests do not send network calls; API uses GET only', async () => {
  await expect(api.list('bad' as 'reads')).rejects.toThrow();
  await expect(api.list('reads', '' as const, 0)).rejects.toThrow();
  expect(mock.history.get).toHaveLength(0);
  expect(mock.history.post).toHaveLength(0);
});
