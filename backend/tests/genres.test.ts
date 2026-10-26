import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { Server } from 'node:http';
import test from 'node:test';
import express from 'express';
import app from '../src/app';
import { disconnectPrisma, getPrismaClient } from '../src/config/prisma';
import { errorHandler } from '../src/middlewares/error-handler';

const absentId = '00000000-0000-4000-8000-000000000001';

async function tableCounts() {
  const db = getPrismaClient();
  return Promise.all([
    db.user.count(), db.story.count(), db.genre.count(), db.storyGenre.count(),
    db.chapter.count(), db.chapterPage.count(), db.favorite.count(),
    db.readingProgress.count(), db.readingHistory.count(), db.rating.count(), db.comment.count(),
  ]);
}

function serverUrl(server: Server) {
  const address = server.address();
  assert(address && typeof address !== 'string');
  return `http://127.0.0.1:${address.port}`;
}

async function closeServer(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
    server.closeAllConnections();
  });
}

test('Genres HTTP integration against empty content tables (read only; existing users allowed)', { timeout: 30000 }, async (t) => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const baseUrl = serverUrl(server);
    const before = await tableCounts();
    // Existing accounts, including the first ADMIN, do not affect public Genres.
    // Keep users in the before/after snapshot to detect unintended writes.
    assert(before.slice(1).every((count) => count === 0), 'This suite expects empty content tables; it never seeds or clears data.');

    await t.test('empty genre list and trailing slash return 200 with []', async () => {
      for (const path of ['/api/genres', '/api/genres/']) {
        const response = await fetch(baseUrl + path);
        assert.equal(response.status, 200);
        assert.match(response.headers.get('content-type') ?? '', /application\/json/);
        assert.deepEqual(await response.json(), {
          success: true, message: 'Genres retrieved successfully', data: [],
        });
      }
    });

    await t.test('malformed UUID returns 400 for detail and stories', async () => {
      for (const path of ['/api/genres/not-a-uuid', '/api/genres/not-a-uuid/stories']) {
        const response = await fetch(baseUrl + path);
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.success, false);
        assert.equal(body.error.code, 'INVALID_UUID');
      }
    });

    await t.test('valid absent UUID returns 404 for detail and stories', async () => {
      for (const suffix of ['', '/stories', '/stories?page=2&limit=100&type=NOVEL', '/stories?type=COMIC']) {
        const response = await fetch(`${baseUrl}/api/genres/${absentId}${suffix}`);
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), {
          success: false, message: 'Genre not found', error: { code: 'GENRE_NOT_FOUND' },
        });
      }
    });

    const invalidQueries = [
      'page=0', 'page=-1', 'page=1.5', 'page=abc', 'page=', 'page=1e2',
      'page=9007199254740992', 'page=2147483647&limit=100', 'page=1&page=2',
      'page[x]=1', 'limit=0', 'limit=-1', 'limit=1.5', 'limit=101', 'limit=',
      'limit=abc', 'limit=20&limit=30', 'type=novel', 'type=OTHER', 'type=',
      'type=NOVEL&type=COMIC', 'type[x]=NOVEL',
    ];
    for (const query of invalidQueries) {
      await t.test(`invalid query returns 400: ${query}`, async () => {
        const response = await fetch(`${baseUrl}/api/genres/${absentId}/stories?${query}`);
        assert.equal(response.status, 400);
        const body = await response.json();
        assert.equal(body.success, false);
        assert.equal(body.error.code, 'INVALID_QUERY');
      });
    }

    await t.test('write methods are rejected on all genre endpoints', async () => {
      for (const method of ['POST', 'PATCH', 'PUT', 'DELETE']) {
        for (const path of ['/api/genres', `/api/genres/${absentId}`, `/api/genres/${absentId}/stories`]) {
          const response = await fetch(baseUrl + path, { method });
          assert.equal(response.status, 405);
          assert.equal((await response.json()).error.code, 'METHOD_NOT_ALLOWED');
        }
      }
    });

    await t.test('health response is unchanged', async () => {
      const response = await fetch(baseUrl + '/api/health');
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { success: true, message: 'WebNovel API is running' });
    });

    await t.test('unknown endpoint returns JSON 404', async () => {
      const response = await fetch(baseUrl + '/api/does-not-exist');
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error.code, 'NOT_FOUND');
    });

    await t.test('all business table counts remain unchanged', async () => {
      assert.deepEqual(await tableCounts(), before);
    });
  } finally {
    await closeServer(server);
    await disconnectPrisma();
  }
});

test('unknown async errors return sanitized JSON 500', async () => {
  // An isolated app tests the shared handler without adding a production endpoint.
  const failureApp = express();
  failureApp.get('/failure', async () => {
    throw new Error('PRIVATE_DRIVER_DETAIL_MUST_NOT_LEAK');
  });
  failureApp.use(errorHandler);
  const server = failureApp.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const response = await fetch(serverUrl(server) + '/failure');
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), {
      success: false, message: 'Internal server error', error: { code: 'INTERNAL_SERVER_ERROR' },
    });
  } finally {
    await closeServer(server);
  }
});
