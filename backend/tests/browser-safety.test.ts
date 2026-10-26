import assert from 'node:assert/strict';
import test from 'node:test';
import type { PrismaClient } from '../src/generated/prisma/client';
import type { Client } from 'pg';
import { assertPrismaTest, cleanupFixtures, runPrefix } from './browser/fixtures';

test('E2E run namespace refuses missing, guessed or path-like identities', () => {
  for (const value of ['', 'default', '../test', 'a'.repeat(32), 'G'.repeat(16)]) assert.throws(() => runPrefix(value));
  assert.equal(runPrefix('a'.repeat(16)), 'e2e_aaaaaaaaaaaaaaaa_');
});
test('E2E Prisma write guard refuses main database and non-public schema', async () => {
  for (const identity of [{ name: 'webnovel_db', schema: 'public' }, { name: 'webnovel_test_db', schema: 'foreign' }]) {
    const db = { $queryRaw: async () => [identity] };
    await assert.rejects(assertPrismaTest(db as unknown as PrismaClient), /target refused/);
  }
});
test('E2E cleanup stops before deletion when foreign users or genres exist', async () => {
  const runId = 'a'.repeat(16); const prefix = runPrefix(runId); let deletes = 0;
  const guard = { query: async () => ({ rows: [{ name: 'webnovel_test_db', schema: 'public' }] }) };
  for (const foreign of ['user', 'genre']) {
    const tx = {
      user: { findMany: async () => foreign === 'user' ? [{ id: 'foreign', username: 'real', email: 'real@example.invalid' }] : [{ id: 'owned', username: `${prefix}admin`, email: `${prefix}admin@example.invalid` }], deleteMany: async () => { deletes++; } },
      story: { findMany: async () => [] }, genre: { findMany: async () => [{ id: 'foreign', name: 'Unknown data' }] },
    };
    const db = { $queryRaw: async () => [{ name: 'webnovel_test_db', schema: 'public' }], $transaction: async (work: (tx: unknown) => Promise<void>) => work(tx) };
    await assert.rejects(cleanupFixtures(db as unknown as PrismaClient, guard as unknown as Client, runId), /cleanup refused/);
  }
  assert.equal(deletes, 0);
});
