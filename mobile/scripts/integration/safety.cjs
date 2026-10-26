/* global __dirname */
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const mobileRoot = path.resolve(__dirname, '../..');
const backendRoot = path.resolve(mobileRoot, '../backend');
const backendRequire = createRequire(path.join(backendRoot, 'package.json'));
const { Client } = backendRequire('pg');
const environment = backendRequire('./tests/integration/environment.ts');
const database = backendRequire('./tests/integration/database.ts');
async function primaryFingerprint() {
  const raw = backendRequire('dotenv').parse(
    fs.readFileSync(path.join(backendRoot, '.env')),
  ).DATABASE_URL;
  const url = new URL(raw);
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    decodeURIComponent(url.pathname) !== '/webnovel_db' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new Error('Primary read-only identity refused');
  const client = new Client({
    connectionString: raw,
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    if ((await client.query('SELECT current_database() AS name')).rows[0].name !== 'webnovel_db')
      throw new Error('Primary identity mismatch');
    const rows = [];
    for (const table of [...environment.APP_TABLES, '_prisma_migrations'])
      rows.push(
        (
          await client.query(
            `SELECT count(*)::text AS n, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY md5(to_jsonb(t)::text)), '')) AS digest FROM public."${table}" t`,
          )
        ).rows[0],
      );
    await client.query('COMMIT');
    return JSON.stringify(rows);
  } finally {
    await client.end();
  }
}
module.exports = {
  mobileRoot,
  backendRoot,
  backendRequire,
  Client,
  ...environment,
  ...database,
  primaryFingerprint,
};
