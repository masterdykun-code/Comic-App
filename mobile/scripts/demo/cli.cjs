const { Buffer } = require('node:buffer');
const http = require('node:http');
const { randomBytes } = require('node:crypto');
const {
  backendRoot,
  backendRequire,
  Client,
  configureIntegration,
  verifySchema,
  preflight,
} = require('../integration/safety.cjs');
const { validateHost, identity, inventory, seed, cleanup, ids } = require('./core.cjs');
const { assertInteractive, safeFailure } = require('./terminal.cjs');
const port = 4001;
let phase = 'arguments';
async function main() {
  const [action, host, confirmation] = process.argv.slice(2);
  if (!['inspect', 'diagnose', 'seed', 'serve', 'cleanup'].includes(action))
    throw new Error('INVALID_COMMAND');
  if (['seed', 'cleanup'].includes(action) && confirmation !== '--confirm')
    throw new Error('CONFIRMATION_REQUIRED');
  if (action !== 'inspect') validateHost(host);
  process.chdir(backendRoot);
  const connectionString = configureIntegration();
  const db = new Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    ...(['inspect', 'diagnose'].includes(action)
      ? { options: '-c default_transaction_read_only=on' }
      : {}),
  });
  let server;
  try {
    phase = 'database-preflight';
    await db.connect();
    await identity(db);
    const lock = await db.query('SELECT pg_try_advisory_lock(1464746330,13) AS locked');
    if (!lock.rows[0].locked) throw new Error('TEST_DATABASE_BUSY');
    await verifySchema(db);
    const state = await inventory(db);
    // Existing integration preflight checks additional schemas, functions and triggers.
    // It requires an empty DB; for persisted demo data check these objects separately.
    if (!state.count) await preflight(db);
    else {
      const unexpected = await db.query(
        "SELECT (SELECT count(*) FROM pg_namespace WHERE nspname NOT IN ('public','information_schema') AND nspname NOT LIKE 'pg_%')+(SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON p.pronamespace=n.oid WHERE n.nspname='public')+(SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal) AS n",
      );
      if (Number(unexpected.rows[0].n)) throw new Error('UNKNOWN_SCHEMA_OBJECTS');
    }
    console.log(`Verified webnovel_test_db/public; ${state.count} managed rows; no foreign rows.`);
    if (action === 'inspect') return;
    if (action === 'diagnose') {
      phase = 'terminal-check';
      console.log('Terminal capabilities:', {
        stdinTTY: process.stdin.isTTY === true,
        stdoutTTY: process.stdout.isTTY === true,
        rawModeSupported: typeof process.stdin.setRawMode === 'function',
      });
      assertInteractive(process.stdin, process.stdout);
      phase = 'password-module-load';
      const { readHidden } = backendRequire('./src/utils/admin-terminal.ts');
      const { hashPassword } = backendRequire('./src/utils/password.ts');
      if (typeof readHidden !== 'function' || typeof hashPassword !== 'function')
        throw new Error('PASSWORD_MODULE_UNAVAILABLE');
      console.log(
        'PASS terminal and password modules. No password requested; no seed run; no data writes.',
      );
      return;
    }
    const base = `http://${host}:${port}`;
    if (state.complete && action !== 'cleanup') {
      const urls = await db.query(
        'SELECT cover_url AS url FROM stories WHERE id=ANY($1::uuid[]) UNION ALL SELECT image_url AS url FROM chapter_pages WHERE id=ANY($2::uuid[])',
        [ids.stories, ids.chapter_pages],
      );
      if (urls.rows.some((r) => !r.url.startsWith(base + '/__demo__/')))
        throw new Error('FIXTURE_LAN_CHANGED');
    }
    if (action === 'seed') {
      if (state.complete) {
        console.log('Seed already complete; 0 rows created; password unchanged.');
        return;
      }
      phase = 'terminal-check';
      assertInteractive(process.stdin, process.stdout);
      phase = 'password-module-load';
      const { readHidden } = backendRequire('./src/utils/admin-terminal.ts');
      const { hashPassword } = backendRequire('./src/utils/password.ts');
      phase = 'password-input';
      let password = await readHidden(
        process.stdin,
        process.stdout,
        'Demo USER password (8-128 characters, hidden): ',
      );
      phase = 'password-confirmation';
      let repeat = await readHidden(process.stdin, process.stdout, 'Confirm password (hidden): ');
      phase = 'password-validation';
      if (password.length < 8 || password.length > 128 || password !== repeat)
        throw new Error('INVALID_PASSWORD');
      phase = 'password-hash';
      const hashes = [
        await hashPassword(randomBytes(48).toString('base64url')),
        await hashPassword(password),
      ];
      password = '';
      repeat = '';
      phase = 'fixture-transaction';
      console.log('Seed result:', await seed(db, base, hashes));
      console.log(
        'USER email: android_demo_v1_user@example.invalid; use the password entered locally. ADMIN password random and discarded.',
      );
      return;
    }
    if (action === 'cleanup') {
      console.log('Cleanup result:', await cleanup(db));
      return;
    }
    if (!state.complete) throw new Error('SEED_REQUIRED');
    // Never load production .env or allow real upload, even if ambient credentials exist.
    const { v2: cloudinary } = backendRequire('cloudinary');
    cloudinary.uploader.upload_stream = () => {
      throw new Error('DEMO_EXTERNAL_UPLOAD_DISABLED');
    };
    const { default: app } = backendRequire('./src/app.ts');
    const sharp = backendRequire('sharp');
    const images = {};
    for (let i = 0; i <= 6; i++) {
      const svg = Buffer.from(
        `<svg width="480" height="720"><rect width="480" height="720" fill="${['#16786b', '#365aab', '#a65135'][i % 3]}"/><circle cx="240" cy="280" r="130" fill="#f8d77c"/><text x="240" y="540" text-anchor="middle" font-size="40" fill="white">DEMO ${i || 'COVER'}</text></svg>`,
      );
      images[i === 0 ? 'cover.png' : `page-${i}.png`] = await sharp(svg).png().toBuffer();
    }
    server = http.createServer(async (req, res) => {
      try {
        const origin = req.headers.origin;
        if (origin && origin !== `http://${host}:8082`) {
          res.writeHead(403).end();
          return;
        }
        // Restrict the existing app's permissive CORS in this demo-only wrapper.
        const setHeader = res.setHeader.bind(res);
        res.setHeader = (name, value) =>
          name.toLowerCase() === 'access-control-allow-origin'
            ? origin
              ? setHeader(name, origin)
              : res
            : setHeader(name, value);
        if (
          req.url.startsWith('/api/admin/uploads') ||
          req.url.split('?')[0] === '/api/auth/register'
        ) {
          res
            .writeHead(403, { 'Content-Type': 'application/json' })
            .end(JSON.stringify({ success: false, message: 'Disabled in Android demo' }));
          return;
        }
        const pathname = new URL(req.url, base).pathname;
        if (pathname.startsWith('/__demo__/')) {
          const image = images[pathname.slice('/__demo__/'.length)];
          if (!['GET', 'HEAD'].includes(req.method) || !image) {
            res.writeHead(404).end();
            return;
          }
          res
            .writeHead(200, {
              'Content-Type': 'image/png',
              'Content-Length': image.length,
              'Cache-Control': 'no-store',
            })
            .end(req.method === 'HEAD' ? undefined : image);
          return;
        }
        if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) await identity(db);
        app(req, res);
      } catch {
        if (!res.headersSent) res.writeHead(503);
        res.end();
      }
    });
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, '0.0.0.0', resolve);
    });
    console.log(`Demo API ${base}/api; database webnovel_test_db; Cloudinary disabled.`);
    console.log(
      'Ctrl+C stops server without removing fixtures. Never expose this demo port to the Internet.',
    );
    await new Promise((resolve) => {
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
      db.once('error', resolve);
    });
  } finally {
    if (server)
      await new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      });
    await backendRequire('./src/config/prisma.ts').disconnectPrisma();
    await db.end();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(safeFailure(error, phase));
    process.exitCode = 1;
  });
module.exports = { main };
