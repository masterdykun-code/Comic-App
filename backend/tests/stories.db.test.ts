import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import app from '../src/app';
import { disconnectPrisma, getPrismaClient } from '../src/config/prisma';

test('public Stories uses PostgreSQL read-only on the existing empty database', async () => {
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening');
    const address = server.address(); assert(address && typeof address !== 'string');
    const db = getPrismaClient();
    const before = await db.story.count(); assert.equal(before, 0, 'Existing database must have no stories; this test never clears data.');
    for (const query of ['', '?search=Test&type=NOVEL&status=ONGOING&sort=title', '?page=2&limit=100&type=COMIC&sort=updated']) {
      const response: globalThis.Response = await fetch(`http://127.0.0.1:${address.port}/api/stories${query}`);
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.success, true); assert.deepEqual(body.data, []);
      assert.equal(body.pagination.total, 0); assert.equal(body.pagination.totalPages, 0);
    }
    assert.equal(await db.story.count(), before);
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); });
    await disconnectPrisma();
  }
});
