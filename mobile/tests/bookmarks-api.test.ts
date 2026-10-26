import axios from 'axios';
import MockAdapter from 'axios-mock-adapter';
import { createBookmarkApi } from '../src/features/bookmarks/api';
import { bookmarkPosition } from '../src/features/bookmarks/position';
import { novelBookmark, comicBookmark, resolvedNovel } from './bookmark-fixtures';
import { novelChapter, comicChapter } from './reader-fixtures';
import { result } from './catalog-fixtures';

test('bookmark API validates list, create duplicate, resolve and delete envelopes', async () => {
  const client = axios.create(),
    http = new MockAdapter(client),
    api = createBookmarkApi(client);
  http
    .onGet('/me/bookmarks')
    .reply(200, { success: true, ...result([novelBookmark, comicBookmark], 1, 2, 20) });
  expect((await api.list()).data).toHaveLength(2);
  http.onPost('/me/bookmarks').reply(201, { success: true, data: novelBookmark, created: true });
  const input = {
    storyId: novelBookmark.storyId,
    chapterId: novelBookmark.chapterId,
    textOffset: 900,
  };
  expect((await api.add(input)).created).toBe(true);
  expect(JSON.parse(http.history.post[0].data)).toEqual({ ...input, pageNumber: null });
  http
    .onGet('/me/bookmarks/' + novelBookmark.id)
    .reply(200, { success: true, data: resolvedNovel });
  expect((await api.resolve(novelBookmark.id)).textOffset).toBe(900);
  http
    .onDelete('/me/bookmarks/' + novelBookmark.id)
    .reply(200, { success: true, data: { removed: true } });
  expect((await api.remove(novelBookmark.id)).removed).toBe(true);
  http.restore();
});
test.each([
  { ...novelBookmark, chapterId: comicBookmark.chapterId },
  { ...novelBookmark, textOffset: -1 },
  { ...novelBookmark, pageNumber: 2 },
  { ...novelBookmark, available: false },
])('malformed bookmark is rejected instead of navigating to untrusted data', async (value) => {
  const client = axios.create(),
    http = new MockAdapter(client),
    api = createBookmarkApi(client);
  http.onGet('/me/bookmarks').reply(200, { success: true, ...result([value], 1, 1, 20) });
  await expect(api.list()).rejects.toMatchObject({ status: 502 });
  http.restore();
});
test('unavailable bookmark supports deletion while withholding hidden metadata', async () => {
  const client = axios.create(),
    http = new MockAdapter(client),
    api = createBookmarkApi(client);
  http.onGet('/me/bookmarks').reply(200, {
    success: true,
    ...result([{ ...novelBookmark, available: false, story: null, chapter: null }], 1, 1, 20),
  });
  expect((await api.list()).data[0].available).toBe(false);
  http.restore();
});
test('restoration uses UTF-16 offsets and actual COMIC pageNumber without modifying source progress', () => {
  const n = { ...novelChapter, type: 'NOVEL' as const, content: 'a'.repeat(1600) };
  expect(bookmarkPosition(resolvedNovel, n).textOffset).toBe(900);
  expect(bookmarkPosition({ ...resolvedNovel, textOffset: 9999 }, n).textOffset).toBe(1600);
  expect(() => bookmarkPosition({ ...resolvedNovel, storyId: comicBookmark.storyId }, n)).toThrow();
  const c = { ...comicChapter, storyId: comicBookmark.storyId, id: comicBookmark.chapterId };
  expect(bookmarkPosition({ ...comicBookmark, positionAdjusted: false }, c).pageNumber).toBe(3);
  expect(
    bookmarkPosition({ ...comicBookmark, pageNumber: 99, positionAdjusted: true }, c).pageNumber,
  ).toBe(1);
});
