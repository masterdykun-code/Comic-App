import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import express from 'express';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { MemoryReadingStore } from './helpers/memory-reading.store';
import { createAuthService } from '../src/services/auth.service';
import { createBookmarkService } from '../src/services/bookmark.service';
import { createBookmarkRouter } from '../src/routes/bookmark.routes';
import { errorHandler } from '../src/middlewares/error-handler';
import { hashPassword } from '../src/utils/password';
import type { BookmarkRow, BookmarkStore } from '../src/types/bookmark.types';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
async function setup() {
  const authStore = new MemoryAuthStore(),
    auth = createAuthService(authStore),
    reading = new MemoryReadingStore(authStore);
  const tokens: Record<string, string> = {},
    users: Record<string, string> = {};
  for (const name of ['reader', 'other']) {
    const user = await authStore.createUser({
      username: name,
      email: `${name}@example.test`,
      displayName: name,
      passwordHash: await hashPassword('Fixture-only-password'),
    });
    users[name] = user.id;
    tokens[name] = (
      await auth.login(user.email, 'Fixture-only-password')
    ).accessToken;
  }
  const novel = randomUUID(),
    comic = randomUUID(),
    nc = randomUUID(),
    cc = randomUUID();
  for (const [id, type] of [
    [novel, 'NOVEL'],
    [comic, 'COMIC'],
  ] as const)
    reading.stories.set(id, {
      id,
      type,
      title: `Fixture ${type}`,
      slug: id,
      authorName: 'QA',
      coverUrl: '',
      publishStatus: 'PUBLISHED',
    });
  for (const [id, storyId] of [
    [nc, novel],
    [cc, comic],
  ])
    reading.chapters.set(id!, {
      id: id!,
      storyId: storyId!,
      chapterNumber: 1,
      title: 'QA chapter',
      isVip: false, coinPrice: 10, publishStatus: 'PUBLISHED',
      content: storyId === novel ? 'Xin chào.\n\nMột đoạn tiếng Việt.' : null,
      createdAt: new Date(),
      updatedAt: new Date(),
      pages:
        storyId === comic
          ? [1, 3].map((pageNumber) => ({
              id: randomUUID(),
              chapterId: id!,
              pageNumber,
              imageUrl: `https://example.test/${pageNumber}.png`,
              storagePublicId: null,
              createdAt: new Date(),
            }))
          : [],
    });
  let rows: BookmarkRow[] = [];
  const store: BookmarkStore = {
    transaction(owner, mode, work) {
      return reading.transaction(owner, mode, async (tx) => {
        const before = structuredClone(rows);
        const refresh = (r: BookmarkRow): BookmarkRow => ({
          ...r,
          story: reading.stories.get(r.storyId)!,
          chapter: reading.chapters.get(r.chapterId)!,
        });
        try {
          return await work({
            activeUser: tx.activeUser,
            story: tx.story,
            chapter: tx.chapter,
            find: async (u, id) => {
              const r = rows.find((r) => r.userId === u && r.id === id);
              return r ? refresh(r) : null;
            },
            existing: async (u, chapterId) => {
              const r = rows.find(
                (r) => r.userId === u && r.chapterId === chapterId,
              );
              return r ? refresh(r) : null;
            },
            list: async (u, q) => {
              const list = rows.filter((r) => r.userId === u).map(refresh);
              return {
                data: list.slice((q.page - 1) * q.limit, q.page * q.limit),
                total: list.length,
              };
            },
            create: async (u, input, chapterUpdatedAt) => {
              const row: BookmarkRow = {
                id: randomUUID(),
                userId: u,
                ...input,
                chapterUpdatedAt,
                createdAt: new Date(),
                story: reading.stories.get(input.storyId)!,
                chapter: reading.chapters.get(input.chapterId)!,
              };
              rows.push(row);
              return row;
            },
            remove: async (u, id) => {
              const before = rows.length;
              rows = rows.filter((r) => !(r.id === id && r.userId === u));
              return before - rows.length;
            },
          });
        } catch (e) {
          rows = before;
          throw e;
        }
      });
    },
  };
  const service = createBookmarkService(store),
    app = express();
  app.use(express.json({ limit: '16kb' }));
  app.use('/api/me/bookmarks', createBookmarkRouter(service, auth));
  app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const port = address.port;
  // node:http avoids Undici's browser-style forbidden-port list on Windows ephemeral ports.
  async function request(
    path = '',
    method = 'GET',
    body?: unknown,
    actor = 'reader',
  ) {
    const { request } = await import('node:http');
    return new Promise<{
      status: number;
      body: any;
      cache: string | undefined;
    }>((resolve, reject) => {
      const req = request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/api/me/bookmarks' + path,
          method,
          headers: {
            ...(tokens[actor]
              ? { Authorization: 'Bearer ' + tokens[actor] }
              : {}),
            ...(body ? { 'Content-Type': 'application/json' } : {}),
          },
        },
        (res) => {
          let raw = '';
          res.on('data', (b) => (raw += b));
          res.on('end', () =>
            resolve({
              status: res.statusCode!,
              body: JSON.parse(raw),
              cache: res.headers['cache-control'],
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body ? JSON.stringify(body) : undefined);
    });
  }
  return {
    authStore,
    reading,
    users,
    service,
    request,
    novel,
    comic,
    nc,
    cc,
    rows: () => rows,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  };
}
async function fixture(
  work: (s: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const s = await setup();
  try {
    await work(s);
  } finally {
    await s.close();
  }
}

test('Bookmark supports NOVEL/COMIC and multiple stories; CRUD does not touch progress/history/favorites', () =>
  fixture(async (s) => {
    const n = await s.request('', 'POST', {
      storyId: s.novel,
      chapterId: s.nc,
      textOffset: 9,
    });
    assert.equal(n.status, 201);
    assert.equal(n.body.created, true);
    const c = await s.request('', 'POST', {
      storyId: s.comic,
      chapterId: s.cc,
      pageNumber: 3,
    });
    assert.equal(c.status, 201);
    const list = await s.request();
    assert.equal(list.body.data.length, 2);
    assert.equal(list.cache, 'no-store');
    assert.equal(
      (await s.request('/' + c.body.data.id)).body.data.pageNumber,
      3,
    );
    assert.equal(
      (await s.request('/' + n.body.data.id)).body.data.textOffset,
      9,
    );
    assert.equal((await s.request('/' + n.body.data.id, 'DELETE')).status, 200);
    assert.equal((await s.request('/' + n.body.data.id, 'DELETE')).status, 404);
    assert.deepEqual(
      [
        s.reading.progressRows.length,
        s.reading.historyRows.length,
        s.reading.favoriteRows.length,
      ],
      [0, 0, 0],
    );
    assert.equal(s.reading.stories.size, 2);
  }));
test('duplicate/concurrent bookmark creates one row and preserves the first position', () =>
  fixture(async (s) => {
    const input = { storyId: s.novel, chapterId: s.nc, textOffset: 5 };
    const results = await Promise.all([
      s.request('', 'POST', input),
      s.request('', 'POST', input),
    ]);
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 201]);
    assert.equal(s.rows().length, 1);
    const again = await s.request('', 'POST', { ...input, textOffset: 12 });
    assert.equal(again.body.data.textOffset, 5);
  }));
test('Guest is denied; ownership, BANNED and sensitive-field filtering are enforced', () =>
  fixture(async (s) => {
    for (const [path, method] of [
      ['', 'GET'],
      ['', 'POST'],
      ['/' + s.nc, 'GET'],
      ['/' + s.nc, 'DELETE'],
    ])
      assert.equal(
        (await s.request(path, method, undefined, 'guest')).status,
        401,
      );
    const added = await s.request('', 'POST', {
      storyId: s.novel,
      chapterId: s.nc,
    });
    const id = added.body.data.id;
    assert.equal(
      (await s.request('/' + id, 'GET', undefined, 'other')).status,
      404,
    );
    assert.equal(
      (await s.request('/' + id, 'DELETE', undefined, 'other')).status,
      404,
    );
    assert.equal(
      (await s.request('', 'GET', undefined, 'other')).body.data.length,
      0,
    );
    assert(!JSON.stringify(added.body).includes('userId'));
    assert(!JSON.stringify(added.body).includes('passwordHash'));
    s.authStore.users.get(s.users.reader!)!.status = 'BANNED';
    assert.equal((await s.request()).status, 401);
  }));
test('validation rejects wrong UUID, pagination, mass assignment, type/position and mismatched story chapter', () =>
  fixture(async (s) => {
    for (const body of [
      { storyId: 'bad', chapterId: s.nc },
      { storyId: s.novel, chapterId: s.nc, textOffset: -1 },
      { storyId: s.novel, chapterId: s.nc, textOffset: 999999 },
      { storyId: s.novel, chapterId: s.nc, pageNumber: 1 },
      { storyId: s.comic, chapterId: s.cc, textOffset: 2 },
      { storyId: s.comic, chapterId: s.cc, pageNumber: 2 },
      { storyId: s.novel, chapterId: s.nc, userId: s.users.other },
    ])
      assert.equal((await s.request('', 'POST', body)).status, 400);
    assert.equal(
      (await s.request('', 'POST', { storyId: s.comic, chapterId: s.nc }))
        .status,
      404,
    );
    for (const path of ['?page=0', '?limit=101', '?userId=x', '/bad-id'])
      assert.equal((await s.request(path)).status, 400);
  }));
test('hidden content stays unavailable without leaking draft metadata; stale positions normalize without writes', () =>
  fixture(async (s) => {
    const n = await s.request('', 'POST', {
      storyId: s.novel,
      chapterId: s.nc,
      textOffset: 20,
    });
    const c = await s.request('', 'POST', {
      storyId: s.comic,
      chapterId: s.cc,
      pageNumber: 3,
    });
    const nc = s.reading.chapters.get(s.nc)!;
    nc.content = 'Short';
    nc.updatedAt = new Date(nc.updatedAt.getTime() + 10);
    const resolved = await s.request('/' + n.body.data.id);
    assert.equal(resolved.body.data.textOffset, 5);
    assert.equal(resolved.body.data.positionAdjusted, true);
    assert.equal(s.rows()[0]!.textOffset, 20);
    s.reading.chapters.get(s.cc)!.pages = s.reading.chapters
      .get(s.cc)!
      .pages.slice(0, 1);
    assert.equal(
      (await s.request('/' + c.body.data.id)).body.data.pageNumber,
      1,
    );
    nc.publishStatus = 'DRAFT';
    const list = await s.request();
    assert.equal(list.body.data[0].available, false);
    assert.equal(list.body.data[0].chapter, null);
    assert.equal(list.body.data[0].story, null);
    assert.equal((await s.request('/' + n.body.data.id)).status, 404);
    assert.equal((await s.request('/' + n.body.data.id, 'DELETE')).status, 200);
  }));
test('internal database failures stay sanitized', () =>
  fixture(async (s) => {
    s.reading.failCode = 'XX_PRIVATE';
    const r = await s.request();
    assert.equal(r.status, 500);
    assert(!JSON.stringify(r.body).includes('PRIVATE'));
  }));
