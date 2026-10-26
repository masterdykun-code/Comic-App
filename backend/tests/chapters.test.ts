import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import { createChapterRouter } from '../src/routes/chapter.routes';
import { createChapterService } from '../src/services/chapter.service';
import { createStoryRouters } from '../src/routes/story.routes';
import { createStoryService } from '../src/services/story.service';
import { createAuthService } from '../src/services/auth.service';
import { errorHandler, notFoundHandler } from '../src/middlewares/error-handler';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { MemoryStoryStore } from './helpers/memory-story.store';
import { MemoryChapterStore } from './helpers/memory-chapter.store';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
const image = (pageNumber: number) => ({ pageNumber, imageUrl: `https://example.test/${pageNumber}.png`, storagePublicId: `private-storage-${pageNumber}` });
const absent = '00000000-0000-4000-8000-000000000001';

type Request = (path: string, method?: string, body?: unknown, actor?: 'admin' | 'user' | 'guest') => Promise<{ status: number; body: any }>;
async function fixture(run: (f: {
  request: Request; store: MemoryChapterStore; storyStore: MemoryStoryStore;
  authStore: MemoryAuthStore; adminId: string;
  story: (type?: 'NOVEL' | 'COMIC', publish?: boolean) => Promise<any>;
  chapter: (storyId: string, body?: object) => Promise<any>;
  publish: (chapterId: string) => Promise<any>;
  pages: (chapterId: string, values?: object[]) => Promise<any>;
}) => Promise<void>) {
  const authStore = new MemoryAuthStore(); const auth = createAuthService(authStore);
  const admin = await auth.register({ username: 'chapter_admin', email: 'admin@example.test', password: 'Test-password-123' });
  authStore.users.get(admin.id)!.role = 'ADMIN'; // In-memory test account only.
  await auth.register({ username: 'chapter_user', email: 'user@example.test', password: 'Test-password-123' });
  const tokens = {
    admin: (await auth.login('admin@example.test', 'Test-password-123')).accessToken,
    user: (await auth.login('user@example.test', 'Test-password-123')).accessToken,
  };
  const storyStore = new MemoryStoryStore(authStore); const store = new MemoryChapterStore(storyStore);
  storyStore.genres.set(absent, { id: absent, name: 'Test genre', slug: 'test' });
  const app = express();
  app.use(createChapterRouter(createChapterService(store), auth));
  app.use(express.json({ limit: '16kb' }));
  const { storyRouter, adminStoryRouter } = createStoryRouters(createStoryService(storyStore), auth);
  app.use('/api/stories', storyRouter); app.use('/api/admin/stories', adminStoryRouter);
  app.use(notFoundHandler); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
    const request: Request = async (path, method = 'GET', body, actor = 'guest') => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(actor === 'guest' ? {} : { Authorization: `Bearer ${tokens[actor]}` }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: response.status, body: await response.json() };
    };
    const story = async (type: 'NOVEL' | 'COMIC' = 'NOVEL', publish = true) => {
      const result = await request('/api/stories', 'POST', { title: 'Test Story', authorName: 'Author', type,
        description: 'Description', coverUrl: 'https://example.test/cover.png', genreIds: [absent] }, 'admin');
      assert.equal(result.status, 201); const row = result.body.data;
      if (publish) assert.equal((await request(`/api/stories/${row.id}/publish`, 'PATCH', {}, 'admin')).status, 200);
      return row;
    };
    const chapter = async (storyId: string, body: object = { chapterNumber: 1, title: 'First chapter' }) => {
      const result = await request(`/api/admin/stories/${storyId}/chapters`, 'POST', body, 'admin');
      assert.equal(result.status, 201); return result.body.data;
    };
    const publish = async (id: string) => {
      const result = await request(`/api/admin/chapters/${id}/publish`, 'PATCH', {}, 'admin'); assert.equal(result.status, 200); return result.body.data;
    };
    const pages = async (id: string, values: object[] = [image(1)]) => {
      const result = await request(`/api/admin/chapters/${id}/pages`, 'PUT', { pages: values }, 'admin'); assert.equal(result.status, 200); return result.body.data;
    };
    await run({ request, story, chapter, publish, pages, store, storyStore, authStore, adminId: admin.id });
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); });
  }
}

test('ADMIN reads full draft/published NOVEL/COMIC chapters; public visibility and permissions stay intact', async () => fixture(async ({ story, chapter, pages, publish, request, authStore, adminId }) => {
  const novel = await story('NOVEL', false);
  const n = await chapter(novel.id, { chapterNumber: 1, title: 'Draft', content: 'Line 1\nLine 2' });
  const path = `/api/admin/chapters/${n.id}`;
  const r = await request(path, 'GET', undefined, 'admin');
  assert.equal(r.status, 200); assert.equal(r.body.data.content, 'Line 1\nLine 2');
  assert.equal(r.body.data.type, 'NOVEL'); assert.equal(r.body.data.publishStatus, 'DRAFT');
  assert(!('passwordHash' in r.body.data));
  assert.equal((await request(`/api/chapters/${n.id}`)).status, 404);
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, 'GET', undefined, 'user')).status, 403);
  assert.equal((await request('/api/admin/chapters/bad', 'GET', undefined, 'admin')).status, 400);
  assert.equal((await request(`/api/admin/chapters/${randomUUID()}`, 'GET', undefined, 'admin')).status, 404);
  const comic = await story('COMIC'); const c = await chapter(comic.id);
  await pages(c.id, [image(2), image(1)]);
  const detail = await request(`/api/admin/chapters/${c.id}`, 'GET', undefined, 'admin');
  assert.deepEqual(detail.body.data.pages.map((p: any) => p.pageNumber), [1, 2]);
  assert.equal(detail.body.data.pages[0].storagePublicId, 'private-storage-1');
  await publish(c.id);
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'GET', undefined, 'admin')).body.data.publishStatus, 'PUBLISHED');
  authStore.users.get(adminId)!.status = 'BANNED';
  assert.equal((await request(path, 'GET', undefined, 'admin')).status, 401);
}));

test('chapter list is empty for a published story without chapters', async () => fixture(async ({ story, request }) => {
  const s = await story(); const r = await request(`/api/stories/${s.id}/chapters`);
  assert.equal(r.status, 200); assert.deepEqual(r.body.data, []);
  assert.deepEqual(r.body.pagination, { page: 1, limit: 20, total: 0, totalPages: 0 });
}));

test('ADMIN creates DRAFT chapters, honors title/number/content and public list omits content', async () => fixture(async ({ story, chapter, request, publish }) => {
  const s = await story();
  const c = await chapter(s.id, { chapterNumber: 2, title: ' Two ', content: 'Novel body' });
  assert.equal(c.title, 'Two'); assert.equal(c.publishStatus, 'DRAFT'); assert.equal(c.content, 'Novel body');
  assert.equal((await request(`/api/stories/${s.id}/chapters`)).body.data.length, 0);
  await publish(c.id);
  const rows = (await request(`/api/stories/${s.id}/chapters`)).body.data;
  assert.equal(rows.length, 1); assert(!('content' in rows[0])); assert(!('pages' in rows[0]));
}));

test('public list only contains published chapters sorted by number with pagination; ADMIN sees drafts', async () => fixture(async ({ story, chapter, publish, request }) => {
  const s = await story();
  const third = await chapter(s.id, { chapterNumber: 3, title: 'Third', content: 'Text 3' }); await publish(third.id);
  await chapter(s.id, { chapterNumber: 2, title: 'Draft' });
  const first = await chapter(s.id, { chapterNumber: 1, title: 'First', content: 'Text 1' }); await publish(first.id);
  const list = await request(`/api/stories/${s.id}/chapters?page=1&limit=1`);
  assert.equal(list.body.data[0].id, first.id); assert.equal(list.body.pagination.total, 2); assert.equal(list.body.pagination.totalPages, 2);
  assert.equal((await request(`/api/stories/${s.id}/chapters?page=2&limit=1`)).body.data[0].id, third.id);
  assert.deepEqual((await request(`/api/stories/${s.id}/chapters?page=3&limit=1`)).body.data, []);
  const admin = await request(`/api/admin/stories/${s.id}/chapters`, 'GET', undefined, 'admin');
  assert.equal(admin.status, 200); assert.deepEqual(admin.body.data.map((c: any) => c.chapterNumber), [1, 2, 3]);
  assert(admin.body.data.every((c: any) => !('content' in c)));
}));

test('draft stories/chapters are hidden and a chapter cannot publish before its parent', async () => fixture(async ({ story, chapter, request, store, storyStore }) => {
  const s = await story('NOVEL', false); const c = await chapter(s.id, { chapterNumber: 1, title: 'Draft', content: 'Valid text' });
  assert.equal((await request(`/api/stories/${s.id}/chapters`)).status, 404);
  assert.equal((await request(`/api/chapters/${c.id}`)).status, 404);
  assert.equal((await request(`/api/admin/chapters/${c.id}/publish`, 'PATCH', {}, 'admin')).status, 409);
  // Simulate an inconsistent legacy row; still never exposed under a draft story.
  store.chapters.get(c.id)!.publishStatus = 'PUBLISHED';
  assert.equal((await request(`/api/chapters/${c.id}`)).status, 404);
  storyStore.stories.get(s.id)!.publishStatus = 'PUBLISHED';
  store.chapters.get(c.id)!.publishStatus = 'DRAFT';
  assert.equal((await request(`/api/chapters/${c.id}`)).status, 404);
}));

test('NOVEL reader returns text; COMIC reader returns ordered public image fields only', async () => fixture(async ({ story, chapter, publish, pages, request }) => {
  const novel = await story(); const nc = await chapter(novel.id, { chapterNumber: 1, title: 'Novel', content: 'The novel text' }); await publish(nc.id);
  const nr = await request(`/api/chapters/${nc.id}`); assert.equal(nr.status, 200); assert.equal(nr.body.data.content, 'The novel text'); assert(!('pages' in nr.body.data));
  const comic = await story('COMIC'); const cc = await chapter(comic.id); await pages(cc.id, [image(3), image(1), image(2)]); await publish(cc.id);
  const cr = await request(`/api/chapters/${cc.id}`); assert.equal(cr.status, 200); assert(!('content' in cr.body.data));
  assert.deepEqual(cr.body.data.pages.map((p: any) => p.pageNumber), [1, 2, 3]);
  assert(cr.body.data.pages.every((p: any) => Object.keys(p).sort().join(',') === 'imageUrl,pageNumber'));
  assert(!JSON.stringify(cr.body).includes('private-storage')); assert(!('publishStatus' in cr.body.data));
}));

test('USER and Guest cannot call any chapter administration endpoint', async () => fixture(async ({ story, chapter, request, store }) => {
  const s = await story(); const c = await chapter(s.id);
  for (const actor of ['user', 'guest'] as const) {
    const expected = actor === 'user' ? 403 : 401;
    for (const [method, path, body] of [
      ['POST', `/api/admin/stories/${s.id}/chapters`, { chapterNumber: 2, title: 'x' }],
      ['GET', `/api/admin/stories/${s.id}/chapters`, undefined],
      ['PATCH', `/api/admin/chapters/${c.id}`, { title: 'x' }],
      ['PUT', `/api/admin/chapters/${c.id}/pages`, { pages: [] }],
      ['PATCH', `/api/admin/chapters/${c.id}/publish`, {}],
    ] as const) assert.equal((await request(path, method, body, actor)).status, expected);
  }
  assert.equal(store.chapters.size, 1);
}));

test('duplicate chapter numbers conflict within one story, but are allowed across stories', async () => fixture(async ({ story, chapter, request, store }) => {
  const s = await story(); await chapter(s.id);
  assert.equal((await request(`/api/admin/stories/${s.id}/chapters`, 'POST', { chapterNumber: 1, title: 'Duplicate' }, 'admin')).status, 409);
  const c = await chapter(s.id, { chapterNumber: 2, title: 'Second' });
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { chapterNumber: 1 }, 'admin')).status, 409);
  assert.equal(store.chapters.get(c.id)!.chapterNumber, 2);
  await chapter((await story()).id);
}));

test('storyId/publishStatus/role/createdBy cannot be mass assigned', async () => fixture(async ({ story, chapter, request }) => {
  const s = await story(); const c = await chapter(s.id);
  for (const field of ['storyId', 'publishStatus', 'role', 'createdBy']) {
    assert.equal((await request(`/api/admin/stories/${s.id}/chapters`, 'POST', { chapterNumber: 2, title: 'Bad', [field]: absent }, 'admin')).status, 400);
    assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { [field]: absent }, 'admin')).status, 400);
  }
  assert.equal((await request(`/api/admin/chapters/${c.id}/publish`, 'PATCH', { role: 'ADMIN' }, 'admin')).status, 400);
}));

test('NOVEL cannot publish null/blank text or receive image pages', async () => fixture(async ({ story, chapter, request, publish, store }) => {
  const c = await chapter((await story()).id);
  for (const content of [null, '', ' \n\t ']) {
    assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { content }, 'admin')).status, 200);
    assert.equal((await request(`/api/admin/chapters/${c.id}/publish`, 'PATCH', {}, 'admin')).status, 400);
    assert.equal(store.chapters.get(c.id)!.publishStatus, 'DRAFT');
  }
  assert.equal((await request(`/api/admin/chapters/${c.id}/pages`, 'PUT', { pages: [image(1)] }, 'admin')).status, 400);
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { content: 'Now valid' }, 'admin')).status, 200); await publish(c.id);
}));

test('COMIC rejects text even null, cannot publish without pages, can clear pages while draft', async () => fixture(async ({ story, chapter, request, pages, store }) => {
  const s = await story('COMIC');
  for (const content of ['text', '', null]) assert.equal((await request(`/api/admin/stories/${s.id}/chapters`, 'POST', { chapterNumber: 1, title: 'Bad', content }, 'admin')).status, 400);
  const c = await chapter(s.id);
  assert.equal((await request(`/api/admin/chapters/${c.id}/publish`, 'PATCH', {}, 'admin')).status, 400);
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { content: 'bad' }, 'admin')).status, 400);
  await pages(c.id); await pages(c.id, []); assert.deepEqual(store.chapters.get(c.id)!.pages, []);
}));

test('page replacement supports reorder and rollback after deleting old rows', async () => fixture(async ({ story, chapter, pages, request, store }) => {
  const c = await chapter((await story('COMIC')).id); await pages(c.id, [image(1), image(2)]);
  const before = structuredClone(store.chapters.get(c.id)); store.failPageInsert = true;
  const failed = await request(`/api/admin/chapters/${c.id}/pages`, 'PUT', { pages: [image(3)] }, 'admin');
  assert.equal(failed.status, 500); assert.deepEqual(store.chapters.get(c.id), before);
  assert.deepEqual(failed.body, { success: false, message: 'Internal server error', error: { code: 'INTERNAL_SERVER_ERROR' } });
  const replaced = await pages(c.id, [image(5), image(2)]); assert.deepEqual(replaced.pages.map((p: any) => p.pageNumber), [2, 5]);
  assert.equal(store.chapters.get(c.id)!.pages.length, 2);
}));

test('published NOVEL cannot lose valid text; published COMIC cannot lose all images', async () => fixture(async ({ story, chapter, pages, publish, request, store }) => {
  const n = await chapter((await story()).id, { chapterNumber: 1, title: 'Novel', content: 'Keep this' }); await publish(n.id);
  const before = structuredClone(store.chapters.get(n.id));
  for (const content of [null, '', '\n ']) {
    assert.equal((await request(`/api/admin/chapters/${n.id}`, 'PATCH', { title: 'Must rollback', content }, 'admin')).status, 400);
    assert.deepEqual(store.chapters.get(n.id), before);
  }
  const c = await chapter((await story('COMIC')).id); await pages(c.id); await publish(c.id);
  assert.equal((await request(`/api/admin/chapters/${c.id}/pages`, 'PUT', { pages: [] }, 'admin')).status, 400);
  assert.equal(store.chapters.get(c.id)!.pages.length, 1);
  await pages(c.id, [image(2)]); assert.equal((await request(`/api/chapters/${c.id}`)).body.data.pages[0].pageNumber, 2);
}));

test('page validation rejects duplicates, invalid URL/numbers, unknown fields and over 200 pages', async () => fixture(async ({ story, chapter, request, store }) => {
  const c = await chapter((await story('COMIC')).id);
  for (const body of [
    { pages: [image(1), image(1)] }, { pages: [{ ...image(1), pageNumber: 0 }] },
    { pages: [{ ...image(1), pageNumber: 1.5 }] }, { pages: [{ ...image(1), imageUrl: 'javascript:bad' }] },
    { pages: [{ ...image(1), imageUrl: 'not-url' }] }, { pages: [{ ...image(1), chapterId: randomUUID() }] },
    { pages: Array.from({ length: 201 }, (_, i) => image(i + 1)) }, { pages: [], role: 'ADMIN' },
  ]) assert.equal((await request(`/api/admin/chapters/${c.id}/pages`, 'PUT', body, 'admin')).status, 400);
  assert.deepEqual(store.chapters.get(c.id)!.pages, []);
}));

test('chapter input validation rejects invalid numbers, title, null bytes and empty PATCH', async () => fixture(async ({ story, chapter, request }) => {
  const s = await story(); const c = await chapter(s.id);
  for (const body of [
    { chapterNumber: 0, title: 'x' }, { chapterNumber: -1, title: 'x' }, { chapterNumber: 1.2, title: 'x' },
    { chapterNumber: '2', title: 'x' }, { chapterNumber: 2147483648, title: 'x' }, { chapterNumber: 2, title: '  ' },
    { chapterNumber: 2, title: 'x'.repeat(201) }, { chapterNumber: 2, title: 'x', content: 'a\0b' },
  ]) assert.equal((await request(`/api/admin/stories/${s.id}/chapters`, 'POST', body, 'admin')).status, 400);
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', {}, 'admin')).status, 400);
}));

test('chapter body limit supports novel text above 16kb but caps length and payload bytes', async () => fixture(async ({ story, chapter, request }) => {
  const c = await chapter((await story()).id, { chapterNumber: 1, title: 'Long', content: 'x'.repeat(20000) });
  assert.equal(c.content.length, 20000);
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { content: 'x'.repeat(200001) }, 'admin')).status, 400);
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { content: 'x'.repeat(1024 * 1024 + 1) }, 'admin')).status, 413);
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { content: 'x'.repeat(1024 * 1024 + 1) }, 'guest')).status, 401);
}));

test('missing UUIDs/records and invalid pagination return safe errors', async () => fixture(async ({ request }) => {
  assert.equal((await request('/api/chapters/invalid')).status, 400);
  assert.equal((await request('/api/stories/invalid/chapters')).status, 400);
  assert.equal((await request(`/api/chapters/${absent}`)).status, 404);
  assert.equal((await request(`/api/stories/${absent}/chapters`)).status, 404);
  assert.equal((await request(`/api/admin/chapters/${absent}`, 'PATCH', { title: 'x' }, 'admin')).status, 404);
  assert.equal((await request(`/api/admin/chapters/${absent}/publish`, 'PATCH', {}, 'admin')).status, 404);
  for (const query of ['page=0', 'limit=101', 'page=1.5', 'page=1&page=2', 'page[x]=1', 'unknown=x', 'page=2147483647&limit=100']) {
    assert.equal((await request(`/api/stories/${absent}/chapters?${query}`)).status, 400);
  }
}));

test('all chapter writes preserve Story type lock and parent metadata remains public', async () => fixture(async ({ story, chapter, request }) => {
  const s = await story(); await chapter(s.id);
  assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', { type: 'COMIC' }, 'admin')).status, 409);
  assert.equal((await request(`/api/stories/${s.id}`)).status, 200);
}));

test('concurrent chapter creation vs Story type edit cannot produce a text COMIC', async () => fixture(async ({ story, request, store, storyStore }) => {
  const s = await story();
  const results = await Promise.all([
    request(`/api/admin/stories/${s.id}/chapters`, 'POST', { chapterNumber: 1, title: 'Novel', content: 'Text' }, 'admin'),
    request(`/api/stories/${s.id}`, 'PATCH', { type: 'COMIC' }, 'admin'),
  ]);
  if (storyStore.stories.get(s.id)!.type === 'COMIC') {
    assert.equal(store.chapters.size, 0); assert.deepEqual(results.map(r => r.status), [400, 200]);
  } else {
    assert.equal(store.chapters.size, 1); assert.deepEqual(results.map(r => r.status), [201, 409]);
  }
}));

test('concurrent publish vs emptying comic pages leaves only a valid published result', async () => fixture(async ({ story, chapter, pages, request, store }) => {
  const c = await chapter((await story('COMIC')).id); await pages(c.id);
  const result = await Promise.all([
    request(`/api/admin/chapters/${c.id}/publish`, 'PATCH', {}, 'admin'),
    request(`/api/admin/chapters/${c.id}/pages`, 'PUT', { pages: [] }, 'admin'),
  ]);
  assert(result.some(r => r.status === 400));
  const state = store.chapters.get(c.id)!; assert(state.publishStatus !== 'PUBLISHED' || state.pages.length > 0);
}));

test('unique chapter creation race yields one 201 and one 409', async () => fixture(async ({ story, request, store }) => {
  const s = await story();
  const r = await Promise.all([1, 2].map(() => request(`/api/admin/stories/${s.id}/chapters`, 'POST', { chapterNumber: 1, title: 'Same' }, 'admin')));
  assert.deepEqual(r.map(x => x.status).sort(), [201, 409]); assert.equal(store.chapters.size, 1);
}));

test('transaction conflict retries; exhaustion does not leave partial chapter/page writes', async () => fixture(async ({ story, chapter, store, storyStore, request, pages }) => {
  const s = await story('COMIC'); storyStore.commitFailures.push('P2034'); const c = await chapter(s.id);
  assert.equal(store.chapters.size, 1); await pages(c.id);
  const before = structuredClone(store.chapters.get(c.id)); storyStore.commitFailures.push(...Array(5).fill('P2034'));
  assert.equal((await request(`/api/admin/chapters/${c.id}/pages`, 'PUT', { pages: [image(2)] }, 'admin')).status, 409);
  assert.deepEqual(store.chapters.get(c.id), before);
}));

test('publish is idempotent and publicly hides corrupted text/page data', async () => fixture(async ({ story, chapter, publish, request, store }) => {
  const c = await chapter((await story()).id, { chapterNumber: 1, title: 'Valid', content: 'Text' }); await publish(c.id); await publish(c.id);
  store.chapters.get(c.id)!.content = '  '; assert.equal((await request(`/api/chapters/${c.id}`)).status, 404);
}));

test('version validation rejects malformed timestamps, version-only PATCH and version on create', async () => fixture(async ({ story, chapter, request, store }) => {
  const s = await story('COMIC'); const c = await chapter(s.id); const before = structuredClone(store.chapters.get(c.id));
  for (const expectedUpdatedAt of [null, 42, '', 'not-a-date', '2026-02-30T00:00:00Z', '2026-01-01']) {
    for (const [suffix, method, fields] of [['', 'PATCH', { title: 'Must not save' }], ['/pages', 'PUT', { pages: [image(1)] }], ['/publish', 'PATCH', {}]] as const) {
      assert.equal((await request(`/api/admin/chapters/${c.id}${suffix}`, method, { ...fields, expectedUpdatedAt }, 'admin')).status, 400);
    }
  }
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { expectedUpdatedAt: c.updatedAt }, 'admin')).status, 400);
  assert.equal((await request(`/api/admin/stories/${s.id}/chapters`, 'POST', { chapterNumber: 2, title: 'Rejected', expectedUpdatedAt: c.updatedAt }, 'admin')).status, 400);
  assert.deepEqual(store.chapters.get(c.id), before);
}));

test('stale version blocks every write before touching chapter/pages/parent; current version is accepted', async () => fixture(async ({ story, chapter, request, store, storyStore }) => {
  const s = await story('COMIC'); const c = await chapter(s.id);
  const first = await request(`/api/admin/chapters/${c.id}`, 'PATCH', { title: 'Current title', expectedUpdatedAt: c.updatedAt }, 'admin');
  assert.equal(first.status, 200); assert(new Date(first.body.data.updatedAt).getTime() > new Date(c.updatedAt).getTime());
  assert(!('expectedUpdatedAt' in first.body.data));
  const before = structuredClone(store.chapters.get(c.id)); const parent = structuredClone(storyStore.stories.get(s.id));
  for (const [suffix, method, fields] of [['', 'PATCH', { title: 'Stale title' }], ['/pages', 'PUT', { pages: [image(1)] }], ['/publish', 'PATCH', {}]] as const) {
    const r = await request(`/api/admin/chapters/${c.id}${suffix}`, method, { ...fields, expectedUpdatedAt: c.updatedAt }, 'admin');
    assert.equal(r.status, 409); assert.equal(r.body.error.code, 'CHAPTER_STALE');
    assert.deepEqual(store.chapters.get(c.id), before); assert.deepEqual(storyStore.stories.get(s.id), parent);
  }
  // Legacy callers still work, but their writes invalidate an existing client version too.
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { title: 'Legacy edit' }, 'admin')).status, 200);
  assert.equal((await request(`/api/admin/chapters/${c.id}`, 'PATCH', { title: 'Old snapshot', expectedUpdatedAt: first.body.data.updatedAt }, 'admin')).status, 409);
}));

test('page replacement and publish accept matching versions, advance them and preserve legacy idempotency', async () => fixture(async ({ story, chapter, request, store }) => {
  const c = await chapter((await story('COMIC')).id);
  const replaced = await request(`/api/admin/chapters/${c.id}/pages`, 'PUT', { pages: [image(2), image(1)], expectedUpdatedAt: c.updatedAt }, 'admin');
  assert.equal(replaced.status, 200); assert(new Date(replaced.body.data.updatedAt).getTime() > new Date(c.updatedAt).getTime());
  const before = structuredClone(store.chapters.get(c.id));
  assert.equal((await request(`/api/admin/chapters/${c.id}/pages`, 'PUT', { pages: [], expectedUpdatedAt: c.updatedAt }, 'admin')).status, 409);
  assert.deepEqual(store.chapters.get(c.id), before);
  const published = await request(`/api/admin/chapters/${c.id}/publish`, 'PATCH', { expectedUpdatedAt: replaced.body.data.updatedAt }, 'admin');
  assert.equal(published.status, 200); assert.equal(published.body.data.publishStatus, 'PUBLISHED');
  assert(new Date(published.body.data.updatedAt).getTime() > new Date(replaced.body.data.updatedAt).getTime());
  assert.equal((await request(`/api/admin/chapters/${c.id}/publish`, 'PATCH', { expectedUpdatedAt: replaced.body.data.updatedAt }, 'admin')).status, 409);
  assert.equal((await request(`/api/admin/chapters/${c.id}/publish`, 'PATCH', {}, 'admin')).status, 200);
  assert.equal((await request(`/api/admin/chapters/${c.id}/publish`, 'PATCH', { expectedUpdatedAt: published.body.data.updatedAt }, 'admin')).status, 200);
}));

test('concurrent writers sharing a version have one winner and never overwrite it', async () => fixture(async ({ story, chapter, request, store }) => {
  const c = await chapter((await story()).id);
  const results = await Promise.all(['Writer A', 'Writer B'].map((title) => request(`/api/admin/chapters/${c.id}`, 'PATCH', { title, expectedUpdatedAt: c.updatedAt }, 'admin')));
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  const winner = results.find((r) => r.status === 200)!; assert.equal(store.chapters.get(c.id)!.title, winner.body.data.title);
  assert.equal(results.find((r) => r.status === 409)!.body.error.code, 'CHAPTER_STALE');
}));

test('metadata and page replacement share the same version boundary', async () => fixture(async ({ story, chapter, pages, request, store }) => {
  const c = await chapter((await story('COMIC')).id); const initial = await pages(c.id);
  const before = structuredClone(store.chapters.get(c.id)!);
  const [metadata, pageWrite] = await Promise.all([
    request(`/api/admin/chapters/${c.id}`, 'PATCH', { title: 'New metadata', expectedUpdatedAt: initial.updatedAt }, 'admin'),
    request(`/api/admin/chapters/${c.id}/pages`, 'PUT', { pages: [image(7)], expectedUpdatedAt: initial.updatedAt }, 'admin'),
  ]);
  assert.deepEqual([metadata.status, pageWrite.status].sort(), [200, 409]);
  const after = store.chapters.get(c.id)!;
  if (metadata.status === 200) assert.deepEqual(after.pages, before.pages);
  else assert.equal(after.title, before.title);
}));

test('version advances with clock rollback and after a transaction retry', async () => fixture(async ({ story, chapter, request, store, storyStore }) => {
  const c = await chapter((await story()).id);
  const future = new Date('2100-01-01T00:00:00.000Z'); store.chapters.get(c.id)!.updatedAt = future;
  storyStore.commitFailures.push('P2034');
  const result = await request(`/api/admin/chapters/${c.id}`, 'PATCH', { title: 'Retried edit', expectedUpdatedAt: future.toISOString() }, 'admin');
  assert.equal(result.status, 200); assert.equal(new Date(result.body.data.updatedAt).getTime(), future.getTime() + 1);
  const stale = await request(`/api/admin/chapters/${c.id}`, 'PATCH', { title: 'Must not overwrite', expectedUpdatedAt: future.toISOString() }, 'admin');
  assert.equal(stale.status, 409); assert.equal(store.chapters.get(c.id)!.title, 'Retried edit');
}));

test('versioned page insertion failure rolls back pages and version', async () => fixture(async ({ story, chapter, pages, request, store }) => {
  const c = await chapter((await story('COMIC')).id); const initial = await pages(c.id);
  const before = structuredClone(store.chapters.get(c.id)); store.failPageInsert = true;
  const result = await request(`/api/admin/chapters/${c.id}/pages`, 'PUT', { pages: [image(2)], expectedUpdatedAt: initial.updatedAt }, 'admin');
  assert.equal(result.status, 500); assert.deepEqual(store.chapters.get(c.id), before);
}));

test('demoted or banned ADMIN cannot use existing tokens for chapter writes', async () => fixture(async ({ story, request, authStore, adminId }) => {
  const s = await story(); const admin = authStore.users.get(adminId)!;
  admin.role = 'USER'; assert.equal((await request(`/api/admin/stories/${s.id}/chapters`, 'POST', { chapterNumber: 1, title: 'x' }, 'admin')).status, 403);
  admin.role = 'ADMIN'; admin.status = 'BANNED';
  assert.equal((await request(`/api/admin/stories/${s.id}/chapters`, 'POST', { chapterNumber: 1, title: 'x' }, 'admin')).status, 401);
}));


test('VIP flag defaults to free/10, ADMIN controls it and public reader fails closed without grants',()=>fixture(async({story,chapter,publish,request})=>{
 const parent=await story();const current=await chapter(parent.id,{chapterNumber:1,title:'VIP sample',content:'Private novel body'});assert.equal(current.isVip,false);assert.equal(current.coinPrice,10);await publish(current.id);
 const patch=await request(`/api/admin/chapters/${current.id}`,'PATCH',{isVip:true,coinPrice:10},'admin');assert.equal(patch.status,200);
 const list=await request(`/api/stories/${parent.id}/chapters`);assert.equal(list.body.data[0].isVip,true);assert(!('content'in list.body.data[0]));
 for(const actor of ['guest','user'] as const){const r=await request(`/api/chapters/${current.id}`,'GET',undefined,actor);assert.equal(r.status,402);assert.equal(r.body.error.code,'CHAPTER_LOCKED');assert(!JSON.stringify(r.body).includes('Private novel body'));}
 assert.equal((await request(`/api/admin/chapters/${current.id}`,'GET',undefined,'admin')).status,200);
 assert.equal((await request(`/api/admin/chapters/${current.id}`,'PATCH',{isVip:false},'user')).status,403);
 assert.equal((await request(`/api/admin/chapters/${current.id}`,'PATCH',{isVip:false},'admin')).status,200);assert.equal((await request(`/api/chapters/${current.id}`)).status,200);
 for(const coinPrice of [0,-1,10.1,100001])assert.equal((await request(`/api/admin/chapters/${current.id}`,'PATCH',{isVip:true,coinPrice},'admin')).status,400);
}));
