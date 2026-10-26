import MockAdapter from 'axios-mock-adapter';
import { expect, it } from 'vitest';
import { createApiClient } from '../src/lib/api/client';
import { Session } from '../src/features/auth/session';
import { createChaptersApi } from '../src/features/chapters/api';
import { chapterInputSchema, makeBatches, MiB } from '../src/features/chapters/model';
import { input, transport } from './fixtures';
import { storyId, chapterId, testChapter } from './chapter-fixtures';
import { reorder, sortComicFiles } from '../src/features/chapters/comic-files';
async function fixture() {
  const session = new Session(transport());
  await session.login(input);
  const client = createApiClient(session);
  const mock = new MockAdapter(client, { onNoMatch: 'throwException' });
  return { api: createChaptersApi(client), mock };
}
// No requests can leave these per-test mock adapters.

it('natural order and move helpers preserve input files and bounds', () => {
  const files = ['010.png', '002.png', '001.png'].map(
    (name) => new File(['x'], name, { type: 'image/png' }),
  );
  expect(sortComicFiles(files).map((f) => f.name)).toEqual(['001.png', '002.png', '010.png']);
  expect(files[0]!.name).toBe('010.png');
  expect(reorder(files, 2, 0)).toEqual([files[2], files[0], files[1]]);
  expect(reorder(files, -1, 0)).toBe(files);
});
it('uses ADMIN list/detail contracts and pagination', async () => {
  const { api, mock } = await fixture();
  mock.onGet(`/admin/stories/${storyId}/chapters`).reply((config) => {
    expect(config.params).toEqual({ page: 2, limit: 10 });
    return [200, { data: [], pagination: {} }];
  });
  mock.onGet(`/admin/chapters/${chapterId}`).reply(200, { data: testChapter });
  await api.list(storyId, 2, 10);
  expect(await api.detail(chapterId)).toEqual(testChapter);
});
it('creates DRAFT using exact fields and preserves plain text/newlines', async () => {
  const { api, mock } = await fixture();
  const body = { chapterNumber: 1, title: 'Title', content: 'A\n\nB <b>plain text</b>' };
  mock.onPost(`/admin/stories/${storyId}/chapters`).reply((config) => {
    expect(JSON.parse(config.data)).toEqual(body);
    return [201, { data: testChapter }];
  });
  await api.create(storyId, body);
});
it('COMIC create never injects content, storyId or publishStatus', async () => {
  const { api, mock } = await fixture();
  const body = { chapterNumber: 1, title: 'Comic' };
  mock.onPost(`/admin/stories/${storyId}/chapters`).reply((config) => {
    expect(JSON.parse(config.data)).toEqual(body);
    return [201, { data: testChapter }];
  });
  await api.create(storyId, body);
});
it('preflight detects a changed version and sends no overwrite request', async () => {
  const { api, mock } = await fixture();
  mock
    .onGet(`/admin/chapters/${chapterId}`)
    .reply(200, { data: { ...testChapter, updatedAt: '2026-02-01T00:00:00Z' } });
  await expect(
    api.update(chapterId, { chapterNumber: 1, title: 'Stale title' }, testChapter.updatedAt),
  ).rejects.toMatchObject({ status: 409, code: 'CHAPTER_STALE' });
  expect(mock.history.patch).toHaveLength(0);
  await expect(api.pages(chapterId, [], testChapter.updatedAt)).rejects.toMatchObject({
    status: 409,
  });
  expect(mock.history.put).toHaveLength(0);
});
it('replaces all pages only with explicit PUT body after a fresh read', async () => {
  const { api, mock } = await fixture();
  mock.onGet(`/admin/chapters/${chapterId}`).reply(200, { data: testChapter });
  const pages = [
    { pageNumber: 1, imageUrl: 'https://example.test/a.png', storagePublicId: 'existing' },
  ];
  mock.onPut(`/admin/chapters/${chapterId}/pages`).reply((config) => {
    expect(JSON.parse(config.data)).toEqual({ pages, expectedUpdatedAt: testChapter.updatedAt });
    return [200, { data: { ...testChapter, pages } }];
  });
  await api.pages(chapterId, pages, testChapter.updatedAt);
});
it('publishes with the reviewed version after preflight', async () => {
  const { api, mock } = await fixture();
  mock.onGet(`/admin/chapters/${chapterId}`).reply(200, { data: testChapter });
  mock.onPatch(`/admin/chapters/${chapterId}/publish`).reply((config) => {
    expect(JSON.parse(config.data)).toEqual({ expectedUpdatedAt: testChapter.updatedAt });
    return [200, { data: testChapter }];
  });
  await api.publish(chapterId, testChapter.updatedAt);
});
it('sends the original edit version to PATCH, not a replacement read version', async () => {
  const { api, mock } = await fixture();
  mock.onGet(`/admin/chapters/${chapterId}`).reply(200, { data: testChapter });
  const body = { chapterNumber: 1, title: 'Edited', content: 'A\nB' };
  mock.onPatch(`/admin/chapters/${chapterId}`).reply((config) => {
    expect(JSON.parse(config.data)).toEqual({ ...body, expectedUpdatedAt: testChapter.updatedAt });
    return [200, { data: testChapter }];
  });
  await api.update(chapterId, body, testChapter.updatedAt);
});
it('a change after preflight is rejected by the write endpoint without automatic retry', async () => {
  const { api, mock } = await fixture();
  mock.onGet(`/admin/chapters/${chapterId}`).reply(200, { data: testChapter });
  mock
    .onPatch(`/admin/chapters/${chapterId}`)
    .reply(409, { error: { code: 'CHAPTER_STALE' }, message: 'untrusted internals' });
  await expect(
    api.update(chapterId, { title: 'Stale', chapterNumber: 1 }, testChapter.updatedAt),
  ).rejects.toMatchObject({
    status: 409,
    code: 'CHAPTER_STALE',
    message: expect.stringContaining('tải lại'),
  });
  expect(mock.history.patch).toHaveLength(1);
});
it('uploads multipart files, validates order and sorts the response without real Cloudinary', async () => {
  const { api, mock } = await fixture();
  const files = [
    new File(['a'], 'a.png', { type: 'image/png' }),
    new File(['b'], 'b.png', { type: 'image/png' }),
  ];
  mock.onPost('/admin/uploads/chapter-pages').reply((config) => {
    expect(config.data.getAll('files')).toEqual(files);
    expect([...config.data.keys()]).toEqual(['files', 'files']);
    return [
      201,
      {
        data: [
          { secureUrl: 'https://example.test/b.png', publicId: 'b', order: 2 },
          { secureUrl: 'https://example.test/a.png', publicId: 'a', order: 1 },
        ],
      },
    ];
  });
  expect((await api.upload(files)).map((p) => p.publicId)).toEqual(['a', 'b']);
  expect(mock.history.post).toHaveLength(1);
});
it('rejects incomplete upload responses and never retries ambiguous results', async () => {
  const { api, mock } = await fixture();
  mock.onPost('/admin/uploads/chapter-pages').reply(201, { data: [] });
  await expect(api.upload([new File(['a'], 'a.png', { type: 'image/png' })])).rejects.toMatchObject(
    { status: 502 },
  );
  expect(mock.history.post).toHaveLength(1);
});
it.each([
  [0, 1],
  [1, 1],
  [1, 3],
  [1.5, 2],
])('rejects invalid one-based upload order %s/%s without replay', async (first, second) => {
  const { api, mock } = await fixture();
  mock.onPost('/admin/uploads/chapter-pages').reply(201, {
    data: [first, second].map((order) => ({
      order,
      publicId: `mock-${order}`,
      secureUrl: 'https://example.test/generated.png',
    })),
  });
  await expect(
    api.upload([
      new File(['a'], 'a.png', { type: 'image/png' }),
      new File(['b'], 'b.png', { type: 'image/png' }),
    ]),
  ).rejects.toMatchObject({ status: 502 });
  expect(mock.history.post).toHaveLength(1);
});
it('batch planning respects count and multipart byte limits', () => {
  const small = () => new File(['x'], 'page.png', { type: 'image/png' });
  expect(makeBatches(Array.from({ length: 41 }, small)).map((b) => b.length)).toEqual([20, 20, 1]);
  const file = new File([new Uint8Array(10 * MiB)], 'big.png', { type: 'image/png' });
  expect(makeBatches([file, file, file, file, file]).map((b) => b.length)).toEqual([4, 1]);
  expect(() => makeBatches([new File(['x'], 'bad.svg', { type: 'image/svg+xml' })])).toThrow('SVG');
  expect(() =>
    makeBatches([new File([new Uint8Array(10 * MiB + 1)], 'huge.png', { type: 'image/png' })]),
  ).toThrow('10 MiB');
});
it('maps upload limits to the COMIC limits instead of the cover limit', async () => {
  const { api, mock } = await fixture();
  mock.onPost('/admin/uploads/chapter-pages').reply(413, { error: { code: 'UPLOAD_TOO_LARGE' } });
  await expect(api.upload([new File(['a'], 'a.png', { type: 'image/png' })])).rejects.toMatchObject(
    { status: 413, message: expect.stringContaining('10 MiB') },
  );
});
it('validates chapter numbers, title, content length and forbidden NUL', () => {
  const valid = { chapterNumber: 1, title: 'Title', content: 'A\nB' };
  expect(chapterInputSchema.parse(valid).content).toBe('A\nB');
  for (const body of [
    { ...valid, chapterNumber: 0 },
    { ...valid, chapterNumber: 1.5 },
    { ...valid, title: '' },
    { ...valid, content: 'x'.repeat(200001) },
    { ...valid, content: '\0' },
    { ...valid, storyId },
  ])
    expect(chapterInputSchema.safeParse(body).success).toBe(false);
});

it('VIP update validates price, checks version and sends only access settings', async () => {
  const { api, mock } = await fixture();
  mock.onGet(`/admin/chapters/${chapterId}`).reply(200, { data: testChapter });
  mock.onPatch(`/admin/chapters/${chapterId}`).reply((config) => {
    expect(JSON.parse(config.data)).toEqual({
      isVip: true,
      coinPrice: 10,
      expectedUpdatedAt: testChapter.updatedAt,
    });
    return [200, { data: { ...testChapter, isVip: true, coinPrice: 10 } }];
  });
  expect((await api.vip(chapterId, true, 10, testChapter.updatedAt)).isVip).toBe(true);
  for (const price of [0, -1, 10.5, 100001])
    await expect(api.vip(chapterId, true, price, testChapter.updatedAt)).rejects.toMatchObject({
      status: 400,
    });
  expect(mock.history.patch).toHaveLength(1);
});
