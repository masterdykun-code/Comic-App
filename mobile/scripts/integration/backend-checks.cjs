const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const {
  backendRoot,
  Client,
  configureIntegration,
  preflight,
  verifySchema,
  assertEmpty,
  primaryFingerprint,
} = require('./safety.cjs');
async function check(label, args, forward = false) {
  const child = spawn(process.execPath, args, {
    cwd: backendRoot,
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let pending = '';
  child.stdout.on('data', (chunk) => {
    pending += String(chunk);
    const lines = pending.split(/\r?\n/);
    pending = lines.pop();
    if (forward)
      for (const line of lines)
        if (/^(PASS |FAIL |SUMMARY |.*: PASS$)/.test(line)) console.log(line);
  });
  child.stderr.on('data', () => {});
  const [code] = await once(child, 'exit');
  console.log(`${code === 0 ? 'PASS' : 'FAIL'} ${label}`);
  if (code !== 0) throw new Error('Backend verification stopped');
}
(async () => {
  process.chdir(backendRoot);
  const url = configureIntegration();
  const client = new Client({
    connectionString: url,
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 5000,
  });
  let before;
  try {
    await client.connect();
    await preflight(client);
    await verifySchema(client);
    await assertEmpty(client);
    before = await primaryFingerprint();
    const npm = process.env.npm_execpath;
    if (!npm || !path.isAbsolute(npm)) throw new Error('Use npm run verify:backend');
    await check('Backend typecheck', [npm, 'run', 'typecheck']);
    await check('Backend build', [npm, 'run', 'build']);
    const tsx = path.join(backendRoot, 'node_modules/tsx/dist/cli.mjs');
    const runner = path.join(backendRoot, 'tests/integration/run.ts');
    await check('Test migration preflight/deploy', [tsx, runner, 'prepare'], true);
    const selected = JSON.parse(
      fs.readFileSync(path.join(backendRoot, 'package.json'), 'utf8'),
    ).scripts.test.match(/tests\/[A-Za-z0-9./-]+\.test\.ts/g);
    if (!selected?.length) throw new Error('Backend test selection unavailable');
    const locked = (await client.query('SELECT pg_try_advisory_lock(1464746330,13) AS locked'))
      .rows[0].locked;
    if (!locked) throw new Error('Another test runner is active');
    try {
      await assertEmpty(client);
      // Bound file-level parallelism; concurrency tests inside each file stay unchanged.
      await check(
        'All Backend regression files (serial)',
        [
          tsx,
          '--test',
          '--test-concurrency=1',
          '--test-reporter=./tests/integration/safe-reporter.cjs',
          ...selected,
        ],
        true,
      );
      await assertEmpty(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(1464746330,13)');
    }
    // This existing runner owns the lock for real PostgreSQL writes and scoped cleanup.
    await check('Backend PostgreSQL integration/migration checks', [tsx, runner, 'test'], true);
    await assertEmpty(client);
  } finally {
    await client.end();
    if (before !== undefined) {
      if (before !== (await primaryFingerprint()))
        throw new Error('Primary read-only snapshot changed');
      console.log('PASS backend checks left webnovel_db unchanged (read-only fingerprints).');
    }
  }
})().catch(() => {
  console.error('FAIL backend checks stopped; raw output/credentials suppressed.');
  process.exitCode = 1;
});
