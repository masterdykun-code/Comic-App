import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import test from 'node:test';
import express from 'express';
import type { Request, Response } from 'express';
import { validateStoryQuery } from '../src/middlewares/story.validation';
import { createStoryRouters } from '../src/routes/story.routes';
import { createStoryService } from '../src/services/story.service';
import { createAuthService } from '../src/services/auth.service';
import { errorHandler, notFoundHandler } from '../src/middlewares/error-handler';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { MemoryStoryStore } from './helpers/memory-story.store';

process.env.JWT_SECRET = randomBytes(48).toString('hex');

test('story query defaults apply independently on public and admin validation', () => {
  for (const admin of [false, true]) {
    for (const [query, expected] of [
      [{}, { page: 1, limit: 20, sort: 'newest' }],
      [{ page: '2' }, { page: 2, limit: 20, sort: 'newest' }],
      [{ limit: '4', sort: 'title' }, { page: 1, limit: 4, sort: 'title' }],
      [{ page: '1', limit: '12', sort: 'newest' }, { page: 1, limit: 12, sort: 'newest' }],
    ] as const) {
      const res = { locals: {} } as Response;
      let nextCalled = false;
      validateStoryQuery(admin)({ query } as unknown as Request, res, () => { nextCalled = true; });
      assert.equal(nextCalled, true);
      assert.deepEqual(res.locals.storyQuery, expected);
    }
  }
});
const id1 = '00000000-0000-4000-8000-000000000001';
const id2 = '00000000-0000-4000-8000-000000000002';
const draft = { title: 'Hành Trình Đọc', type: 'NOVEL', authorName: 'Author' };
const complete = { ...draft, description: 'A complete description', coverUrl: 'https://example.test/cover.png', genreIds: [id1] };

async function fixture(run: (f: {
  store: MemoryStoryStore; authStore: MemoryAuthStore; adminId: string;
  request: (path: string, method?: string, body?: unknown, actor?: 'admin' | 'user' | 'guest') => Promise<{ status: number; body: any }>;
  create: (body?: object) => Promise<any>;
  publish: (id: string) => Promise<any>;
}) => Promise<void>) {
  const authStore = new MemoryAuthStore();
  const auth = createAuthService(authStore);
  // Only in-memory identities, no PostgreSQL client and no real ADMIN account.
  const admin = await auth.register({ username: 'test_admin', email: 'admin@example.test', password: 'Test-password-123' });
  authStore.users.get(admin.id)!.role = 'ADMIN';
  await auth.register({ username: 'test_user', email: 'user@example.test', password: 'Test-password-123' });
  const adminToken = (await auth.login('admin@example.test', 'Test-password-123')).accessToken;
  const userToken = (await auth.login('user@example.test', 'Test-password-123')).accessToken;
  const store = new MemoryStoryStore(authStore);
  store.genres.set(id1, { id: id1, name: 'Adventure', slug: 'adventure' });
  store.genres.set(id2, { id: id2, name: 'Fantasy', slug: 'fantasy' });
  const service = createStoryService(store);
  const { storyRouter, adminStoryRouter } = createStoryRouters(service, auth);
  const app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/stories', storyRouter);
  app.use('/api/admin/stories', adminStoryRouter);
  app.use(notFoundHandler); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address(); assert(address && typeof address !== 'string');
    const request = async (path: string, method = 'GET', body?: unknown, actor: 'admin' | 'user' | 'guest' = 'guest') => {
      const response = await fetch(`http://127.0.0.1:${address.port}${path}`, {
        method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
          ...(actor !== 'guest' ? { Authorization: `Bearer ${actor === 'admin' ? adminToken : userToken}` } : {}) },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      return { status: response.status, body: await response.json() };
    };
    const create = async (body: object = complete) => {
      const r = await request('/api/stories', 'POST', body, 'admin'); assert.equal(r.status, 201); return r.body.data;
    };
    const publish = async (id: string) => {
      const r = await request(`/api/stories/${id}/publish`, 'PATCH', {}, 'admin'); assert.equal(r.status, 200); return r.body.data;
    };
    await run({ store, authStore, adminId: admin.id, request, create, publish });
  } finally {
    await new Promise<void>((resolve, reject) => { server.close((e) => e ? reject(e) : resolve()); server.closeAllConnections(); });
  }
}

test('ADMIN detail reads drafts and published metadata while public detail stays private', async () => fixture(async ({ request, create, publish, store, authStore, adminId }) => {
  const s = await create(); store.stories.get(s.id)!.chapterCount = 3;
  const path = `/api/admin/stories/${s.id}`;
  const r = await request(path, 'GET', undefined, 'admin');
  assert.equal(r.status, 200); assert.equal(r.body.data.publishStatus, 'DRAFT');
  assert.equal(r.body.data.chapterCount, 3); assert.equal(r.body.data.createdBy, adminId);
  assert(!('passwordHash' in r.body.data));
  assert.equal((await request(`/api/stories/${s.id}`)).status, 404);
  assert.equal((await request(path)).status, 401);
  assert.equal((await request(path, 'GET', undefined, 'user')).status, 403);
  assert.equal((await request('/api/admin/stories/invalid', 'GET', undefined, 'admin')).status, 400);
  assert.equal((await request(`/api/admin/stories/${randomUUID()}`, 'GET', undefined, 'admin')).status, 404);
  await publish(s.id);
  assert.equal((await request(path, 'GET', undefined, 'admin')).body.data.publishStatus, 'PUBLISHED');
  authStore.users.get(adminId)!.status = 'BANNED';
  assert.equal((await request(path, 'GET', undefined, 'admin')).status, 401);
}));

test('empty public story list has default pagination', async () => fixture(async ({ request }) => {
  const r = await request('/api/stories'); assert.equal(r.status, 200);
  assert.deepEqual(r.body.data, []);
  assert.deepEqual(r.body.pagination, { page: 1, limit: 20, total: 0, totalPages: 0 });
}));

test('ADMIN creates draft with owner from live auth; optional metadata defaults are safe', async () => fixture(async ({ create, adminId, store }) => {
  const s = await create(draft);
  assert.equal(s.createdBy, adminId); assert.equal(s.publishStatus, 'DRAFT');
  assert.equal(s.description, ''); assert.equal(s.coverUrl, ''); assert.deepEqual(s.genres, []);
  assert.equal(s.slug, 'hanh-trinh-doc'); assert.equal(store.stories.size, 1);
}));

test('USER and guest cannot write or view admin stories', async () => fixture(async ({ request, create }) => {
  const s = await create();
  for (const actor of ['user', 'guest'] as const) {
    const expected = actor === 'user' ? 403 : 401;
    assert.equal((await request('/api/stories', 'POST', complete, actor)).status, expected);
    assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', { title: 'Changed' }, actor)).status, expected);
    assert.equal((await request(`/api/stories/${s.id}/publish`, 'PATCH', {}, actor)).status, expected);
    assert.equal((await request('/api/admin/stories', 'GET', undefined, actor)).status, expected);
  }
}));

test('mass assignment and forged createdBy are rejected on create/update/publish', async () => fixture(async ({ request, create, store }) => {
  for (const field of ['createdBy', 'role', 'publishStatus', 'id', 'slug']) {
    assert.equal((await request('/api/stories', 'POST', { ...complete, [field]: field === 'createdBy' ? randomUUID() : 'ADMIN' }, 'admin')).status, 400);
  }
  assert.equal(store.stories.size, 0);
  const s = await create();
  for (const field of ['createdBy', 'role', 'publishStatus', 'slug']) {
    assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', { [field]: 'x' }, 'admin')).status, 400);
  }
  assert.equal((await request(`/api/stories/${s.id}/publish`, 'PATCH', { publishStatus: 'PUBLISHED' }, 'admin')).status, 400);
}));

test('drafts return public 404 and are excluded from every public list filter', async () => fixture(async ({ request, create }) => {
  const s = await create();
  assert.equal((await request(`/api/stories/${s.id}`)).status, 404);
  for (const query of ['', '?search=Hành&type=NOVEL', `?genreId=${id1}`]) assert.deepEqual((await request('/api/stories' + query)).body.data, []);
  assert.equal((await request('/api/stories?publishStatus=DRAFT')).status, 400);
  const admin = await request('/api/admin/stories?publishStatus=DRAFT', 'GET', undefined, 'admin');
  assert.equal(admin.status, 200); assert.equal(admin.body.data.length, 1);
}));

test('publish exposes metadata and genres only, is idempotent and leaves chapters unchanged', async () => fixture(async ({ request, create, publish, store }) => {
  const s = await create(); store.stories.get(s.id)!.chapterCount = 2;
  assert.equal((await publish(s.id)).publishStatus, 'PUBLISHED');
  await publish(s.id);
  assert.equal(store.stories.get(s.id)!.chapterCount, 2);
  const r = await request(`/api/stories/${s.id}`); assert.equal(r.status, 200);
  assert.equal(r.body.data.title, complete.title); assert.equal(r.body.data.genres[0].id, id1);
  for (const key of ['createdBy', 'chapters', 'chapterCount', 'passwordHash', 'content']) assert(!(key in r.body.data));
}));

test('publication validates complete metadata; invalid published updates roll back', async () => fixture(async ({ request, create, publish, store }) => {
  const incomplete = await create(draft);
  assert.equal((await request(`/api/stories/${incomplete.id}/publish`, 'PATCH', {}, 'admin')).status, 400);
  assert.equal(store.stories.get(incomplete.id)!.publishStatus, 'DRAFT');
  const s = await create(); await publish(s.id);
  const before = structuredClone(store.stories.get(s.id));
  for (const body of [{ genreIds: [] }, { coverUrl: '' }, { description: '' }]) {
    assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', body, 'admin')).status, 400);
    assert.deepEqual(store.stories.get(s.id), before);
  }
}));

test('search, type, genre and status filters combine; pagination counts only published matches', async () => fixture(async ({ request, create, publish }) => {
  const a = await create({ ...complete, title: 'Alpha Novel', status: 'COMPLETED' }); await publish(a.id);
  const b = await create({ ...complete, title: 'Alpha Comic', type: 'COMIC', genreIds: [id2] }); await publish(b.id);
  await create({ ...complete, title: 'Alpha Draft' });
  const r = await request(`/api/stories?search=ALPHA&type=NOVEL&genreId=${id1}&status=COMPLETED&page=1&limit=1`);
  assert.equal(r.status, 200); assert.deepEqual(r.body.data.map((s: any) => s.id), [a.id]);
  assert.deepEqual(r.body.pagination, { page: 1, limit: 1, total: 1, totalPages: 1 });
  const empty = await request(`/api/stories?type=NOVEL&genreId=${id2}`);
  assert.deepEqual(empty.body.data, []); assert.equal(empty.body.pagination.total, 0);
  const pastEnd = await request('/api/stories?page=3&limit=1');
  assert.deepEqual(pastEnd.body.data, []); assert.equal(pastEnd.body.pagination.total, 2);
}));

test('newest, updated, title sorting are stable across page boundaries', async () => fixture(async ({ request, create, publish, store }) => {
  const a = await create({ ...complete, title: 'Same' }); await publish(a.id);
  const b = await create({ ...complete, title: 'Same' }); await publish(b.id);
  for (const row of store.stories.values()) { row.createdAt = new Date(1000); row.updatedAt = new Date(2000); }
  const ids = [a.id, b.id].sort();
  for (const sort of ['newest', 'updated', 'title']) {
    const p1 = await request(`/api/stories?sort=${sort}&page=1&limit=1`);
    const p2 = await request(`/api/stories?sort=${sort}&page=2&limit=1`);
    assert.deepEqual([p1.body.data[0].id, p2.body.data[0].id], ids);
    assert.equal(p1.body.pagination.totalPages, 2);
  }
  store.stories.get(a.id)!.createdAt = new Date(5000);
  store.stories.get(b.id)!.updatedAt = new Date(6000);
  assert.equal((await request('/api/stories?sort=newest')).body.data[0].id, a.id);
  assert.equal((await request('/api/stories?sort=updated')).body.data[0].id, b.id);
}));

test('same title including concurrent creates gets unique slugs, and title edit keeps slug', async () => fixture(async ({ create, request, store }) => {
  const [a, b] = await Promise.all([create(), create()]);
  assert.notEqual(a.slug, b.slug); assert.equal(store.stories.size, 2);
  const updated = await request(`/api/stories/${a.id}`, 'PATCH', { title: 'New Title' }, 'admin');
  assert.equal(updated.status, 200); assert.equal(updated.body.data.slug, a.slug);
}));

test('unknown genres and duplicate UUIDs are rejected without partial writes', async () => fixture(async ({ request, store, create }) => {
  assert.equal((await request('/api/stories', 'POST', { ...complete, genreIds: [randomUUID()] }, 'admin')).status, 400);
  assert.equal((await request('/api/stories', 'POST', { ...complete, genreIds: [id1, id1] }, 'admin')).status, 400);
  assert.equal(store.stories.size, 0);
  const s = await create();
  const before = structuredClone(store.stories.get(s.id));
  assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', { title: 'Must not save', genreIds: [randomUUID()] }, 'admin')).status, 400);
  assert.deepEqual(store.stories.get(s.id), before);
}));

test('genre replacement is atomic, omission preserves links, explicit [] clears a draft', async () => fixture(async ({ create, request, store }) => {
  const s = await create();
  let r = await request(`/api/stories/${s.id}`, 'PATCH', { title: 'Changed' }, 'admin');
  assert.equal(r.status, 200); assert.deepEqual(r.body.data.genres.map((g: any) => g.id), [id1]);
  r = await request(`/api/stories/${s.id}`, 'PATCH', { genreIds: [id2] }, 'admin');
  assert.equal(r.status, 200); assert.deepEqual(r.body.data.genres.map((g: any) => g.id), [id2]);
  store.commitFailures.push('SIMULATED_FAILURE');
  const failed = await request(`/api/stories/${s.id}`, 'PATCH', { title: 'Rollback', genreIds: [id1] }, 'admin');
  assert.equal(failed.status, 500); assert.equal(store.stories.get(s.id)!.title, 'Changed');
  assert.deepEqual(store.stories.get(s.id)!.genres.map(g => g.id), [id2]);
  assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', { genreIds: [] }, 'admin')).status, 200);
  assert.deepEqual(store.stories.get(s.id)!.genres, []);
}));

test('type changes allowed before chapters, blocked after any chapter exists', async () => fixture(async ({ create, request, store }) => {
  const s = await create();
  assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', { type: 'COMIC' }, 'admin')).status, 200);
  store.stories.get(s.id)!.chapterCount = 1;
  assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', { type: 'NOVEL' }, 'admin')).status, 409);
  assert.equal(store.stories.get(s.id)!.type, 'COMIC');
  assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', { type: 'COMIC' }, 'admin')).status, 200);
}));

test('missing stories and malformed UUIDs have correct status', async () => fixture(async ({ request }) => {
  for (const path of ['/api/stories/invalid', '/api/stories/invalid/publish']) {
    const r = await request(path, path.endsWith('publish') ? 'PATCH' : 'GET', undefined, 'admin'); assert.equal(r.status, 400);
  }
  for (const [method, suffix] of [['GET', ''], ['PATCH', ''], ['PATCH', '/publish']]) {
    assert.equal((await request(`/api/stories/${id1}${suffix}`, method, method === 'PATCH' ? (suffix ? {} : { title: 'x' }) : undefined, 'admin')).status, 404);
  }
}));

test('invalid query parameters are rejected and valid maximum pagination accepted', async () => fixture(async ({ request }) => {
  for (const query of ['page=0', 'page=-1', 'page=1.5', 'page=', 'limit=101', 'limit=0', 'limit=abc', 'page=1&page=2', 'page[x]=1', 'type=OTHER', 'status=DRAFT', 'genreId=bad', 'sort=random', 'search=', 'unknown=x', 'page=2147483647&limit=100']) {
    assert.equal((await request('/api/stories?' + query)).status, 400, query);
  }
  assert.equal((await request('/api/stories?limit=100')).status, 200);
}));

test('invalid lengths, unsafe image URLs and empty update cannot mutate stories', async () => fixture(async ({ request, create, store }) => {
  for (const input of [{ ...draft, title: '' }, { ...draft, title: 'x'.repeat(201) }, { ...draft, authorName: 'x'.repeat(101) }, { ...draft, description: 'x'.repeat(10001) }, { ...draft, coverUrl: 'javascript:alert(1)' }, { ...draft, type: 'MANGA' }]) {
    assert.equal((await request('/api/stories', 'POST', input, 'admin')).status, 400);
  }
  assert.equal(store.stories.size, 0);
  const s = await create(); assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', {}, 'admin')).status, 400);
}));

test('ADMIN list filters drafts, search and status with pagination', async () => fixture(async ({ create, publish, request }) => {
  await create({ ...complete, title: 'Draft Novel', status: 'COMPLETED' });
  const b = await create({ ...complete, title: 'Live Comic', type: 'COMIC' }); await publish(b.id);
  const all = await request('/api/admin/stories', 'GET', undefined, 'admin'); assert.equal(all.body.pagination.total, 2);
  const r = await request('/api/admin/stories?search=Draft&publishStatus=DRAFT&status=COMPLETED&limit=1', 'GET', undefined, 'admin');
  assert.equal(r.status, 200); assert.equal(r.body.data.length, 1); assert.equal(r.body.data[0].publishStatus, 'DRAFT');
}));

test('serialization failures retry atomically and exhaustion returns sanitized 409', async () => fixture(async ({ create, store, request }) => {
  store.commitFailures.push('P2034');
  const s = await create(); assert.equal(store.stories.size, 1);
  store.commitFailures.push(...Array(5).fill('P2034'));
  const before = structuredClone(store.stories.get(s.id));
  const r = await request(`/api/stories/${s.id}`, 'PATCH', { title: 'Should rollback' }, 'admin');
  assert.equal(r.status, 409); assert.deepEqual(store.stories.get(s.id), before);
}));

test('ban/demotion blocks previously issued ADMIN tokens', async () => fixture(async ({ authStore, adminId, create, request }) => {
  const s = await create(); const admin = authStore.users.get(adminId)!;
  admin.role = 'USER'; assert.equal((await request(`/api/stories/${s.id}`, 'PATCH', { title: 'x' }, 'admin')).status, 403);
  admin.role = 'ADMIN'; admin.status = 'BANNED';
  assert.equal((await request('/api/stories', 'POST', complete, 'admin')).status, 401);
}));

test('ADMIN can hide a published story and re-publish it without losing chapter publication states', async () => fixture(async ({store,create,publish,request}) => {
  const s=await publish((await create()).id),chapterId=randomUUID();
  store.chapters.set(chapterId,{id:chapterId,storyId:s.id,chapterNumber:1,title:'Preserved chapter',isVip:false,coinPrice:10,content:'Novel text',pages:[],publishStatus:'PUBLISHED',createdAt:new Date(),updatedAt:new Date()});
  const before=structuredClone(store.chapters);
  const hidden=await request(`/api/admin/stories/${s.id}/unpublish`,'PATCH',{},'admin');
  assert.equal(hidden.status,200);assert.equal(hidden.body.data.publishStatus,'DRAFT');
  assert.equal((await request(`/api/stories/${s.id}`)).status,404);
  assert.equal((await request('/api/stories')).body.pagination.total,0);
  assert.equal((await request('/api/admin/stories?publishStatus=DRAFT','GET',undefined,'admin')).body.pagination.total,1);
  assert.deepEqual(store.chapters,before);
  const again=await publish(s.id);assert.equal(again.publishStatus,'PUBLISHED');
  assert.equal((await request(`/api/stories/${s.id}`)).status,200);assert.deepEqual(store.chapters,before);
}));
for(const state of ['DRAFT','PUBLISHED'] as const)test(`explicitly confirmed ADMIN deletion works for ${state}; preserves other stories/genres`,async()=>fixture(async({store,create,publish,request})=>{
  const created=await create(),target=state==='PUBLISHED'?await publish(created.id):created;
  const other=await create({...complete,title:'Other story'}),otherSnapshot=structuredClone(store.stories.get(other.id));
  const r=await request(`/api/admin/stories/${target.id}`,'DELETE',{confirm:true,expectedUpdatedAt:target.updatedAt},'admin');
  assert.equal(r.status,200);assert.deepEqual(r.body.data,{deleted:true});
  assert.equal((await request(`/api/admin/stories/${target.id}`,'GET',undefined,'admin')).status,404);
  assert.equal((await request(`/api/admin/stories/${target.id}`,'DELETE',{confirm:true,expectedUpdatedAt:target.updatedAt},'admin')).status,404);
  assert.deepEqual(store.stories.get(other.id),otherSnapshot);assert.equal(store.genres.size,2);
}));
test('hide/delete require ACTIVE ADMIN before validation and never accept a Guest or USER',async()=>fixture(async({store,create,request,authStore,adminId})=>{
  const s=await create(),body={confirm:true,expectedUpdatedAt:s.updatedAt};
  for(const [path,method,input]of [[`/api/admin/stories/${s.id}`,'DELETE',body],[`/api/admin/stories/${s.id}/unpublish`,'PATCH',{}]] as const){
    assert.equal((await request(path,method,input)).status,401);
    assert.equal((await request(path,method,input,'user')).status,403);
  }
  authStore.users.get(adminId)!.status='BANNED';
  assert.equal((await request(`/api/admin/stories/${s.id}`,'DELETE',body,'admin')).status,401);
  assert(store.stories.has(s.id));
}));
test('delete validation requires confirmation and version; stale confirmation cannot delete',async()=>fixture(async({store,create,request})=>{
  const s=await create(),base={confirm:true,expectedUpdatedAt:s.updatedAt};
  for(const body of [{},{confirm:false,expectedUpdatedAt:s.updatedAt},{confirm:true},{...base,extra:'x'},{...base,expectedUpdatedAt:'bad'}])
    assert.equal((await request(`/api/admin/stories/${s.id}`,'DELETE',body,'admin')).status,400);
  assert.equal((await request(`/api/admin/stories/${s.id}?force=true`,'DELETE',base,'admin')).status,400);
  assert.equal((await request('/api/admin/stories/invalid','DELETE',base,'admin')).status,400);
  const r=await request(`/api/admin/stories/${s.id}`,'DELETE',{...base,expectedUpdatedAt:'2000-01-01T00:00:00.000Z'},'admin');
  assert.equal(r.status,409);assert.equal(r.body.error.code,'STORY_STALE');assert(store.stories.has(s.id));
}));
test('delete failures rollback and report FK/serialization conflicts without exposing internals',async()=>fixture(async({store,create,request})=>{
  const s=await create(),snapshot=structuredClone(store.stories),body={confirm:true,expectedUpdatedAt:s.updatedAt};
  for(const [code,status]of [['P2003',409],['P2034',409],['PRIVATE_FAILURE',500]] as const){
    store.commitFailures=Array(5).fill(code);
    const r=await request(`/api/admin/stories/${s.id}`,'DELETE',body,'admin');
    assert.equal(r.status,status);assert.deepEqual(store.stories,snapshot);assert(!JSON.stringify(r.body).includes('PRIVATE_FAILURE'));
  }
}));
test('unpublish is idempotent, rejects body fields and returns 404 for unknown stories',async()=>fixture(async({create,request})=>{
  const s=await create();
  for(let n=0;n<2;n++)assert.equal((await request(`/api/admin/stories/${s.id}/unpublish`,'PATCH',{},'admin')).status,200);
  assert.equal((await request(`/api/admin/stories/${s.id}/unpublish`,'PATCH',{publishStatus:'DRAFT'},'admin')).status,400);
  assert.equal((await request(`/api/admin/stories/${randomUUID()}/unpublish`,'PATCH',{},'admin')).status,404);
}));
