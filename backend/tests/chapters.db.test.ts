import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import app from '../src/app';
import { disconnectPrisma, getPrismaClient } from '../src/config/prisma';

test('Chapters read-only PostgreSQL smoke test on an empty database', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
    const db = getPrismaClient();
    const counts = () => Promise.all([db.story.count(), db.chapter.count(), db.chapterPage.count()]);
    const before = await counts(); assert.deepEqual(before, [0, 0, 0], 'This test expects empty story/chapter tables and never clears data.');
    for (const path of ['/api/stories/00000000-0000-4000-8000-000000000001/chapters', '/api/chapters/00000000-0000-4000-8000-000000000001']) {
      const response: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}${path}`);
      assert.equal(response.status, 404); assert.equal((await response.json()).success, false);
    }
    assert.deepEqual(await counts(), before);
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); });
    await disconnectPrisma();
  }
});
