import { spawn, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import https from 'node:https';
import { parse } from 'dotenv';
import { Client } from 'pg';
import sharp from 'sharp';
import { configureIntegration, assertTestDatabase, APP_TABLES } from '../integration/environment';
import { assertEmpty, preflight, verifySchema } from '../integration/database';
import { createFixtures, cleanupFixtures, assertPrismaTest } from './fixtures';

const apiPort = 4185; const webPort = 5195;
async function vacant(port: number) {
  const socket = createServer(); await new Promise<void>((done, fail) => { socket.once('error', fail); socket.listen(port, '127.0.0.1', done); });
  await new Promise<void>((done) => socket.close(() => done()));
}
async function primaryFingerprint() {
  const raw = parse(readFileSync(resolve('.env'))).DATABASE_URL;
  const url = new URL(raw);
  if (decodeURIComponent(url.pathname) !== '/webnovel_db' || !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) throw new Error('Primary read-only snapshot configuration refused');
  const client = new Client({ connectionString: raw, connectionTimeoutMillis: 5000 });
  try {
    await client.connect(); await client.query('SET default_transaction_read_only = on'); await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const name = (await client.query('SELECT current_database() AS name')).rows[0].name;
    if (name !== 'webnovel_db') throw new Error('Primary read-only snapshot identity mismatch');
    const fingerprints: unknown[] = [];
    for (const table of [...APP_TABLES, '_prisma_migrations']) {
      fingerprints.push((await client.query(`SELECT count(*)::text AS n, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) AS digest FROM public."${table}" t`)).rows[0]);
    }
    await client.query('COMMIT'); return JSON.stringify(fingerprints);
  } finally { await client.end(); }
}
async function waitReady(child: ChildProcess, url: string) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('E2E frontend process exited');
    try { if ((await fetch(url, { signal: AbortSignal.timeout(500) })).ok) return; } catch { /* bounded startup polling */ }
    await new Promise((done) => setTimeout(done, 100));
  }
  throw new Error('E2E frontend readiness timeout');
}
async function stop(child?: ChildProcess) {
  if (!child || child.exitCode !== null) return;
  child.kill(); await Promise.race([once(child, 'exit'), new Promise((done) => setTimeout(done, 3000))]);
}
async function main() {
  const url = configureIntegration();
  const runId = randomBytes(8).toString('hex'); process.env.E2E_RUN_ID = runId;
  const guard = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  let locked = false; let fixturesStarted = false; let appServer: import('node:http').Server | undefined;
  let vite: ChildProcess | undefined; let browser: ChildProcess | undefined;
  let db: Awaited<ReturnType<typeof import('../../src/config/prisma')['getPrismaClient']>> | undefined;
  let disconnect: (() => Promise<void>) | undefined; let before: string | undefined;
  let externalCalls = 0; let mockUploads = 0;
  try {
    await guard.connect(); await assertTestDatabase(guard);
    locked = (await guard.query('SELECT pg_try_advisory_lock(1464746330,13) AS locked')).rows[0].locked;
    if (!locked) throw new Error('Test database is in use by another runner');
    await preflight(guard); await verifySchema(guard); await assertEmpty(guard);
    await vacant(apiPort); await vacant(webPort); before = await primaryFingerprint();
    console.log('PASS: verified empty webnovel_test_db/public; migrations unchanged; ports 4185/5195 available.');
    const prisma: typeof import('../../src/config/prisma') = require('../../src/config/prisma'); db = prisma.getPrismaClient(); disconnect = prisma.disconnectPrisma;
    await assertPrismaTest(db); fixturesStarted = true;
    const fixtures = await createFixtures(db, runId);
    // No SDK/network fallback: only this test process replaces the external storage boundary.
    const { v2: cloudinary } = await import('cloudinary');
    cloudinary.uploader.upload_stream = (() => { externalCalls++; throw new Error('Real Cloudinary disabled'); }) as typeof cloudinary.uploader.upload_stream;
    https.request = (() => { externalCalls++; throw new Error('External HTTPS disabled in E2E backend'); }) as typeof https.request;
    const { cloudinaryStorage }: typeof import('../../src/config/cloudinary') = require('../../src/config/cloudinary');
    cloudinaryStorage.assertReady = () => {};
    cloudinaryStorage.upload = async (path, folder, id) => {
      const image = await sharp(path).metadata(); if (image.format !== 'png') throw new Error('Expected generated PNG fixture');
      mockUploads++;
      return { secureUrl: `https://e2e-images.invalid/${id}.png`, publicId: `e2e/${runId}/${folder.split('/').at(-1)}/${id}` };
    };
    const { default: app }: typeof import('../../src/app') = require('../../src/app');
    appServer = app.listen(apiPort, '127.0.0.1'); await once(appServer, 'listening');
    const web = resolve('../admin-web');
    const childEnv = { ...process.env, E2E_PASSWORD: fixtures.password, E2E_ADMIN_EMAIL: fixtures.admin.email, E2E_USER_EMAIL: fixtures.user.email, E2E_API_URL: `http://127.0.0.1:${apiPort}/api`, E2E_APP_URL: `http://127.0.0.1:${webPort}`, VITE_API_BASE_URL: `http://127.0.0.1:${apiPort}/api` };
    vite = spawn(process.execPath, [resolve(web, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(webPort), '--strictPort', '--mode', 'integration'], { cwd: web, env: childEnv, stdio: 'ignore', windowsHide: true });
    await waitReady(vite, childEnv.E2E_APP_URL);
    browser = spawn(process.execPath, [resolve(web, 'node_modules/@playwright/test/cli.js'), 'test', '--config', 'playwright.integration.config.ts'], { cwd: web, env: childEnv, stdio: ['ignore','pipe','ignore'], windowsHide: true });
    browser.stdout!.on('data', (chunk) => { for (const line of String(chunk).split(/\r?\n/)) if (/^(PASS |FAIL |SUMMARY )/.test(line)) console.log(line); });
    const [exit] = await once(browser, 'exit'); if (exit !== 0) throw new Error('Integrated browser scenarios failed');
    if (mockUploads < 3 || externalCalls !== 0) throw new Error('Storage isolation verification failed');
    console.log(`PASS: real multipart through Backend; mock storage uploads=${mockUploads}; real Cloudinary/external HTTPS calls=0.`);
    const status = spawn(process.execPath, [resolve('node_modules/prisma/build/index.js'), 'migrate', 'status'], { cwd: process.cwd(), env: process.env, stdio: 'ignore', windowsHide: true });
    if ((await once(status, 'exit'))[0] !== 0) throw new Error('Test migration status failed');
    console.log('PASS: migration status on webnovel_test_db is up to date.');
  } finally {
    await stop(browser); await stop(vite);
    if (appServer) { appServer.closeAllConnections(); await new Promise<void>((done) => appServer!.close(() => done())); }
    try {
      if (fixturesStarted && db) { await cleanupFixtures(db, guard, runId); console.log('PASS: only current E2E fixtures removed; all 15 test tables empty.'); }
    } finally {
      await disconnect?.();
      if (locked) await guard.query('SELECT pg_advisory_unlock(1464746330,13)').catch(() => {});
      await guard.end();
      if (before !== undefined) {
        if (before !== await primaryFingerprint()) throw new Error('Primary fingerprint changed during run; investigate concurrent activity');
        console.log('PASS: webnovel_db row counts and full-row digests unchanged (read-only snapshots).');
      }
    }
  }
}
main().catch(() => { console.error('FAIL: guarded E2E runner stopped; raw errors/secrets suppressed. Inspect safe scenario results. No reset performed.'); process.exitCode = 1; });
