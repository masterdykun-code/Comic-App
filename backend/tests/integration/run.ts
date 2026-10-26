import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { configureIntegration, assertTestDatabase } from './environment';
import { assertEmpty, preflight, verifySchema } from './database';

async function command(label: string, args: string[], tests = false) {
  const result = await new Promise<{ code: number | null; output: string }>((done) => {
    let output = '';
    const child = spawn(process.execPath, args, { cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore','pipe','pipe'] });
    child.stdout.on('data', (v) => { output += String(v); });
    child.stderr.on('data', () => { /* No raw driver/Prisma errors in logs. */ });
    child.on('error', () => done({ code: 1, output: '' }));
    child.on('close', (code) => done({ code, output }));
  });
  if (tests) {
    for (const line of result.output.split(/\r?\n/)) {
      if (/^(PASS |FAIL |SUMMARY )/.test(line)) console.log(line);
      if (/^ℹ (tests|pass|fail|cancelled|skipped) \d+$/.test(line)) console.log(line);
      if (/^✖ /.test(line)) console.log(line.replace(/eyJ[A-Za-z0-9_.-]+/g, '[TOKEN REDACTED]'));
    }
  }
  console.log(`${label}: ${result.code === 0 ? 'PASS' : 'FAIL (sensitive details suppressed)'}`);
  if (result.code !== 0) throw new Error(`${label} failed; no reset or automatic retry performed.`);
}
async function main() {
  const url = configureIntegration();
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  let locked = false;
  try {
    await client.connect(); await assertTestDatabase(client);
    locked = (await client.query('SELECT pg_try_advisory_lock(1464746330,13) AS locked')).rows[0].locked;
    if (!locked) throw new Error('Another integration runner holds the test database lock.');
    await preflight(client);
    await command('Migrate deploy on webnovel_test_db', [resolve('node_modules/prisma/build/index.js'), 'migrate', 'deploy']);
    await verifySchema(client); await assertEmpty(client);
    console.log('Verified webnovel_test_db: 15 application tables, migrations/checksums, enums, PK/FK/CHECK/index names and composite FKs. All application tables empty.');
    process.env.INTEGRATION_RUN_ID = randomUUID().replaceAll('-', '');
    const mode = process.argv[2] ?? 'full';
    if (!['full','prepare','test'].includes(mode)) throw new Error('Use full, prepare or test.');
    if (mode === 'full') {
      // Run all current regression tests against the TEST DB, including their read-only
      // PostgreSQL smoke tests, before any integration fixture is inserted.
      await command('Existing regression tests on test database', [resolve('node_modules/tsx/dist/cli.mjs'), '--test', '--test-reporter=./tests/integration/safe-reporter.cjs',
        'tests/auth.test.ts','tests/genres.test.ts','tests/stories.test.ts','tests/stories.db.test.ts','tests/chapters.test.ts','tests/chapters.db.test.ts','tests/uploads.test.ts','tests/admin-bootstrap.test.ts','tests/reading.test.ts','tests/reading.store.test.ts','tests/feedback.test.ts','tests/feedback.store.test.ts','tests/integration-safety.test.ts','tests/admin-catalog.test.ts','tests/admin-catalog.store.test.ts','tests/browser-safety.test.ts'], true);
      await assertEmpty(client);
    }
    if (mode !== 'prepare') {
      await command('PostgreSQL integration tests', [resolve('node_modules/tsx/dist/cli.mjs'), '--test', '--test-concurrency=1', '--test-reporter=./tests/integration/safe-reporter.cjs', 'tests/integration/postgres.test.ts'], true);
      await assertEmpty(client);
      console.log('Fixture cleanup verified: all 15 application tables empty.');
    }
    await command('Migration status on test database', [resolve('node_modules/prisma/build/index.js'), 'migrate', 'status']);
  } finally {
    if (locked) await client.query('SELECT pg_advisory_unlock(1464746330,13)').catch(() => {});
    await client.end();
  }
}
main().catch((e) => { console.error(e instanceof Error && /^(Create backend|Invalid integration|Integration URL|Only schema|Refusing operation|Unknown|Migration history|Database PK|Unique\/index|Composite|Enum|Test table|Unexpected application|Another integration|Use full|Migrate deploy|Existing regression|PostgreSQL integration|Migration status)/.test(e.message) ? e.message : 'Integration runner failed; raw error suppressed. No reset performed.'); process.exitCode = 1; });
