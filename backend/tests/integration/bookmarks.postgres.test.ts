import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import express from 'express';
import { configureIntegration } from './environment';

test('Bookmark PostgreSQL/HTTP: fixtures only, constraints, concurrency, restore and reading isolation', async (t) => {
  configureIntegration();
  const { getPrismaClient, disconnectPrisma } =
    await import('../../src/config/prisma.js');
  const { createBookmarkService } =
    await import('../../src/services/bookmark.service.js');
  const { createBookmarkRouter } =
    await import('../../src/routes/bookmark.routes.js');
  const { authService } = await import('../../src/services/auth.service.js');
  const { hashPassword } = await import('../../src/utils/password.js');
  const { errorHandler } =
    await import('../../src/middlewares/error-handler.js');
  const db = getPrismaClient(),
    actors = [randomUUID(), randomUUID(), randomUUID()],
    stories = [randomUUID(), randomUUID()],
    chapters = [randomUUID(), randomUUID(), randomUUID()],
    suffix = randomUUID().replaceAll('-', '');
  let server: import('node:http').Server | undefined;
  const identity = async () => {
    const r = await db.$queryRaw<
      Array<{ db: string; schema: string }>
    >`SELECT current_database() AS db,current_schema() AS schema`;
    assert.equal(r[0]?.db, 'webnovel_test_db');
    assert.equal(r[0]?.schema, 'public');
  };
  const readingCounts = async () => [
    await db.readingProgress.count(),
    await db.readingHistory.count(),
    await db.favorite.count(),
  ];
  let before: number[] = [];
  try {
    await identity();
    before = await readingCounts();
    const password = randomBytes(24).toString('hex'),
      passwordHash = await hashPassword(password);
    await db.user.createMany({
      data: actors.map((id, i) => ({
        id,
        username: `u08_${suffix.slice(0, 16)}_${i}`,
        email: `${suffix}-${i}@example.test`,
        displayName: 'U08 fixture',
        passwordHash,
        role: i === 0 ? ('ADMIN' as const) : ('USER' as const),
      })),
    });
    await db.story.createMany({
      data: stories.map((id, i) => ({
        id,
        title: `U08 fixture ${i}`,
        slug: `u08-${suffix}-${i}`,
        type: i === 0 ? ('NOVEL' as const) : ('COMIC' as const),
        authorName: 'QA',
        description: 'Temporary fixture',
        coverUrl: 'https://fixture.invalid/cover.png',
        createdBy: actors[0]!,
        publishStatus: 'PUBLISHED' as const,
      })),
    });
    await db.chapter.createMany({
      data: chapters.map((id, i) => ({
        id,
        storyId: stories[i < 2 ? 0 : 1]!,
        chapterNumber: i === 1 ? 2 : 1,
        title: `Fixture chapter ${i}`,
        content: i < 2 ? 'Dòng đầu.\n\nDòng tiếp theo tiếng Việt.' : null,
        publishStatus: 'PUBLISHED' as const,
      })),
    });
    await db.chapterPage.createMany({
      data: [1, 3].map((pageNumber) => ({
        chapterId: chapters[2]!,
        pageNumber,
        imageUrl: `https://fixture.invalid/${pageNumber}.png`,
      })),
    });
    const login = await authService.login(`${suffix}-1@example.test`, password);
    const other = await authService.login(`${suffix}-2@example.test`, password);
    const app = express();
    app.use(express.json());
    app.use('/api/me/bookmarks', createBookmarkRouter());
    app.use(errorHandler);
    server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    assert(address && typeof address !== 'string');
    const port = address.port;
    async function request(
      path = '',
      method = 'GET',
      body?: unknown,
      token = login.accessToken,
    ) {
      return new Promise<{ status: number; body: any }>((resolve, reject) => {
        const req = httpRequest(
          {
            hostname: '127.0.0.1',
            port,
            path: '/api/me/bookmarks' + path,
            method,
            headers: {
              ...(token ? { Authorization: 'Bearer ' + token } : {}),
              ...(body ? { 'Content-Type': 'application/json' } : {}),
            },
          },
          (res) => {
            let raw = '';
            res.on('data', (b) => (raw += b));
            res.on('end', () =>
              resolve({ status: res.statusCode!, body: JSON.parse(raw) }),
            );
          },
        );
        req.on('error', reject);
        req.end(body ? JSON.stringify(body) : undefined);
      });
    }
    let novelBookmark = '',
      comicBookmark = '';
    await t.test(
      'authenticated HTTP creates NOVEL and COMIC and enforces owner/Guest',
      async () => {
        assert.equal((await request('', 'GET', undefined, '')).status, 401);
        const n = await request('', 'POST', {
          storyId: stories[0],
          chapterId: chapters[0],
          textOffset: 12,
        });
        assert.equal(n.status, 201);
        novelBookmark = n.body.data.id;
        const c = await request('', 'POST', {
          storyId: stories[1],
          chapterId: chapters[2],
          pageNumber: 3,
        });
        assert.equal(c.status, 201);
        comicBookmark = c.body.data.id;
        assert.equal((await request()).body.data.length, 2);
        assert.equal(
          (
            await request(
              '/' + novelBookmark,
              'GET',
              undefined,
              other.accessToken,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              '/' + novelBookmark,
              'DELETE',
              undefined,
              other.accessToken,
            )
          ).status,
          404,
        );
        assert.equal(
          (await request('/' + comicBookmark)).body.data.pageNumber,
          3,
        );
      },
    );
    await t.test(
      'multiple real connections serialize duplicate creates and do not overwrite the saved position',
      async () => {
        const service = createBookmarkService();
        const rows = await Promise.all([
          service.add(actors[1]!, {
            storyId: stories[0]!,
            chapterId: chapters[1]!,
            textOffset: 3,
          }),
          service.add(actors[1]!, {
            storyId: stories[0]!,
            chapterId: chapters[1]!,
            textOffset: 6,
          }),
        ]);
        assert.equal(rows.filter((r) => r.created).length, 1);
        assert.equal(
          await db.bookmark.count({
            where: { userId: actors[1]!, chapterId: chapters[1]! },
          }),
          1,
        );
        const again = await service.add(actors[1]!, {
          storyId: stories[0]!,
          chapterId: chapters[1]!,
          textOffset: 20,
        });
        assert.equal(again.created, false);
        assert([3, 6].includes(again.data.textOffset!));
      },
    );
    await t.test(
      'database unique, composite FK and CHECK constraints reject invalid rows',
      async () => {
        const base = {
          userId: actors[2]!,
          storyId: stories[0]!,
          chapterId: chapters[0]!,
          chapterUpdatedAt: new Date(),
          textOffset: 0,
          pageNumber: null,
        };
        await assert.rejects(
          db.bookmark.create({ data: { ...base, storyId: stories[1]! } }),
        );
        for (const change of [
          { textOffset: -1 },
          { textOffset: null },
          { pageNumber: 1 },
          { textOffset: null, pageNumber: 0 },
        ])
          await assert.rejects(
            db.bookmark.create({ data: { ...base, ...change } }),
          );
        await db.bookmark.create({ data: base });
        await assert.rejects(db.bookmark.create({ data: base }));
        assert.equal(
          await db.bookmark.count({ where: { userId: actors[2]! } }),
          1,
        );
      },
    );
    await t.test('rollback does not leave an extra bookmark', async () => {
      const count = await db.bookmark.count();
      await assert.rejects(
        db.$transaction(async (tx) => {
          await tx.bookmark.create({
            data: {
              userId: actors[2]!,
              storyId: stories[0]!,
              chapterId: chapters[1]!,
              textOffset: 0,
              chapterUpdatedAt: new Date(),
            },
          });
          throw Error('Forced rollback');
        }),
      );
      assert.equal(await db.bookmark.count(), count);
    });
    await t.test(
      'resolve clamps edited text and does not change stored bookmark; drafts stay hidden',
      async () => {
        await db.chapter.update({
          where: { id: chapters[0]! },
          data: { content: 'Ngắn.' },
        });
        const r = await request('/' + novelBookmark);
        assert.equal(r.body.data.textOffset, 5);
        assert.equal(r.body.data.positionAdjusted, true);
        assert.equal(
          (
            await db.bookmark.findUniqueOrThrow({
              where: { id: novelBookmark },
            })
          ).textOffset,
          12,
        );
        await db.chapter.update({
          where: { id: chapters[0]! },
          data: { publishStatus: 'DRAFT' },
        });
        const list = await request();
        const hidden = list.body.data.find(
          (r: { id: string }) => r.id === novelBookmark,
        );
        assert.equal(hidden.chapter, null);
        assert.equal(hidden.story, null);
        assert.equal((await request('/' + novelBookmark)).status, 404);
        assert.equal(
          (await request('/' + novelBookmark, 'DELETE')).status,
          200,
        );
      },
    );
    await t.test(
      'CRUD does not create or alter automatic progress/history/favorites',
      async () => {
        assert.deepEqual(await readingCounts(), before);
      },
    );
  } finally {
    if (server) {
      const s = server;
      await new Promise<void>((resolve) => {
        s.close(() => resolve());
        s.closeAllConnections();
      });
    }
    await identity();
    await db.$transaction(async (tx) => {
      await tx.bookmark.deleteMany({ where: { userId: { in: actors } } });
      await tx.refreshToken.deleteMany({
        where: { session: { userId: { in: actors } } },
      });
      await tx.authSession.deleteMany({ where: { userId: { in: actors } } });
      await tx.chapterPage.deleteMany({
        where: {
          chapterId: { in: chapters },
          chapter: { story: { createdBy: actors[0]! } },
        },
      });
      await tx.chapter.deleteMany({
        where: { id: { in: chapters }, story: { createdBy: actors[0]! } },
      });
      await tx.story.deleteMany({
        where: { id: { in: stories }, createdBy: actors[0]! },
      });
      await tx.user.deleteMany({
        where: {
          id: { in: actors },
          email: { endsWith: '@example.test' },
          username: { startsWith: `u08_${suffix.slice(0, 16)}` },
        },
      });
    });
    assert.equal(await db.user.count({ where: { id: { in: actors } } }), 0);
    if (before.length) assert.deepEqual(await readingCounts(), before);
    await disconnectPrisma();
  }
});
