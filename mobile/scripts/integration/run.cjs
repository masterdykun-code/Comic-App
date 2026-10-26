const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const https = require('node:https');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { randomBytes } = require('node:crypto');
const {
  mobileRoot,
  backendRoot,
  backendRequire,
  Client,
  configureIntegration,
  assertTestDatabase,
  preflight,
  verifySchema,
  assertEmpty,
  primaryFingerprint,
} = require('./safety.cjs');
const { createContent, cleanup } = require('./fixtures.cjs');
const { assertPrismaTest } = backendRequire('./tests/browser/fixtures.ts');
const apiPort = 4186,
  webPort = 5196;
async function command(label, executable, args, cwd, env, forward = false) {
  const child = spawn(executable, args, {
    cwd,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  child.stdout.on('data', (part) => {
    output += String(part);
    if (forward) {
      const lines = output.split(/\r?\n/);
      output = lines.pop();
      for (const line of lines) if (/^(PASS |FAIL |SUMMARY )/.test(line)) console.log(line);
    }
  });
  child.stderr.on('data', () => {});
  const [code] = await once(child, 'exit');
  if (forward)
    for (const line of output.split(/\r?\n/))
      if (/^(PASS |FAIL |SUMMARY )/.test(line)) console.log(line);
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${label}`);
  if (code !== 0) throw new Error(label);
}
async function main() {
  process.chdir(backendRoot);
  const url = configureIntegration();
  const guard = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  const runId = randomBytes(8).toString('hex');
  const manifest = { storyIds: [], chapterIds: [], pageIds: [] };
  let locked = false,
    started = false,
    before,
    db,
    disconnect,
    api,
    web,
    externalCalls = 0;
  try {
    await guard.connect();
    await assertTestDatabase(guard);
    locked = (await guard.query('SELECT pg_try_advisory_lock(1464746330,13) AS locked')).rows[0]
      .locked;
    if (!locked) throw new Error('Another runner owns test database');
    await preflight(guard);
    await verifySchema(guard);
    await assertEmpty(guard);
    before = await primaryFingerprint();
    console.log(
      'PASS verified empty webnovel_test_db/public; schema/checksums match; primary snapshot read-only.',
    );
    const env = { ...process.env, EXPO_PUBLIC_API_BASE_URL: `http://127.0.0.1:${apiPort}/api` };
    // Binding ports before any fixture writes also prevents accidentally reusing dev servers.
    api = http.createServer();
    web = http.createServer();
    api.listen(apiPort, '127.0.0.1');
    await once(api, 'listening');
    web.listen(webPort, '127.0.0.1');
    await once(web, 'listening');
    await command(
      'Expo Web export for isolated real API',
      process.execPath,
      [
        path.join(mobileRoot, 'node_modules/expo/bin/cli'),
        'export',
        '--platform',
        'web',
        '--output-dir',
        'dist-integration',
        '--clear',
      ],
      mobileRoot,
      env,
    );
    const prisma = backendRequire('./src/config/prisma.ts');
    db = prisma.getPrismaClient();
    disconnect = prisma.disconnectPrisma;
    await assertPrismaTest(db);
    const { v2: cloudinary } = backendRequire('cloudinary');
    cloudinary.uploader.upload_stream = () => {
      externalCalls++;
      throw new Error('Real Cloudinary blocked');
    };
    https.request = () => {
      externalCalls++;
      throw new Error('External HTTPS blocked');
    };
    const { default: app } = backendRequire('./src/app.ts');
    const png = await backendRequire('sharp')({
      create: { width: 128, height: 384, channels: 3, background: '#16786b' },
    })
      .png()
      .toBuffer();
    api.on('request', async (req, res) => {
      try {
        if (req.url.startsWith('/__fixtures__/')) {
          if (req.url.endsWith('/missing.png')) {
            res.writeHead(404).end();
            return;
          }
          res.writeHead(200, { 'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*' });
          res.end(png);
          return;
        }
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) await assertPrismaTest(db);
        app(req, res);
      } catch {
        res.writeHead(503).end();
      }
    });
    const dist = path.join(mobileRoot, 'dist-integration');
    web.on('request', (req, res) => {
      let file = path.resolve(
        dist,
        '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname),
      );
      if (!file.startsWith(dist + path.sep) && file !== dist) {
        res.writeHead(403).end();
        return;
      }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory())
        file = path.join(file, 'index.html');
      if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
      if (!fs.existsSync(file)) file = path.join(dist, 'index.html');
      res.writeHead(200, {
        'Content-Type':
          {
            '.html': 'text/html',
            '.js': 'application/javascript',
            '.css': 'text/css',
            '.ttf': 'font/ttf',
            '.png': 'image/png',
          }[path.extname(file)] || 'application/octet-stream',
      });
      fs.createReadStream(file).pipe(res);
    });
    const health = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
    if (health.status !== 200) throw new Error('Isolated API health failed');
    await assertPrismaTest(db);
    await assertEmpty(guard);
    started = true;
    await createContent(db, runId, `http://127.0.0.1:${apiPort}/__fixtures__`, manifest);
    console.log(
      'PASS managed ADMIN/USER/catalog fixtures created only in verified test database; production app unchanged.',
    );
    const { password, ...metadata } = manifest;
    const childEnv = {
      ...env,
      PLAYWRIGHT_NO_COPY_PROMPT: '1',
      MOBILE_E2E_RUN_ID: runId,
      MOBILE_E2E_PASSWORD: password,
      MOBILE_E2E_FIXTURES: JSON.stringify(metadata),
      MOBILE_E2E_API: `http://127.0.0.1:${apiPort}/api`,
      MOBILE_E2E_WEB: `http://127.0.0.1:${webPort}`,
    };
    await command(
      'Real Chromium Mobile Web E2E and API integration',
      process.execPath,
      [
        path.resolve(backendRoot, '../admin-web/node_modules/@playwright/test/cli.js'),
        'test',
        '--config',
        'playwright.integration.config.cjs',
      ],
      mobileRoot,
      childEnv,
      true,
    );
    await assertPrismaTest(db);
    const reader = await db.user.findUnique({
      where: { id: manifest.user.id },
      select: { displayName: true, role: true, status: true },
    });
    const progress = await db.readingProgress.findUnique({
      where: { userId_storyId: { userId: manifest.user.id, storyId: manifest.novel.id } },
      select: { textOffset: true },
    });
    if (
      reader.role !== 'USER' ||
      reader.status !== 'ACTIVE' ||
      reader.displayName !== 'Mobile updated reader' ||
      progress?.textOffset !== 6400
    )
      throw new Error('Final PostgreSQL fixture assertions failed');
    console.log(
      'PASS final PostgreSQL state: USER role/status unchanged; Profile saved; stale reader did not overwrite textOffset=6400.',
    );
    if (externalCalls !== 0) throw new Error('External service boundary was called');
    console.log('PASS real Cloudinary calls=0; no internal API mocks.');
    await command(
      'Test Prisma migration status',
      process.execPath,
      [path.join(backendRoot, 'node_modules/prisma/build/index.js'), 'migrate', 'status'],
      backendRoot,
      process.env,
    );
  } finally {
    for (const server of [web, api])
      if (server?.listening) {
        server.closeAllConnections();
        await new Promise((resolve) => server.close(resolve));
      }
    try {
      if (started && db) {
        await cleanup(db, guard, runId, manifest);
        console.log('PASS only this run fixtures cleaned; all 15 test tables empty.');
      }
    } finally {
      await disconnect?.();
      if (locked) await guard.query('SELECT pg_advisory_unlock(1464746330,13)').catch(() => {});
      await guard.end();
      if (before !== undefined) {
        if (before !== (await primaryFingerprint()))
          throw new Error('Primary fingerprint changed; investigate concurrent use');
        console.log(
          'PASS webnovel_db counts/full-row digests unchanged; primary queries read-only.',
        );
      }
    }
  }
}
main().catch(() => {
  console.error(
    'FAIL guarded Mobile integration stopped; raw errors and credentials suppressed. No reset performed.',
  );
  process.exitCode = 1;
});
