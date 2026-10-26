const {
  backendRoot,
  Client,
  configureIntegration,
  preflight,
  verifySchema,
  assertEmpty,
  primaryFingerprint,
} = require('./safety.cjs');
process.chdir(backendRoot);
(async () => {
  const url = configureIntegration();
  const client = new Client({
    connectionString: url,
    options: '-c default_transaction_read_only=on',
    connectionTimeoutMillis: 5000,
  });
  try {
    await client.connect();
    await preflight(client);
    await verifySchema(client);
    await assertEmpty(client);
    await primaryFingerprint();
    console.log(
      'PASS: local webnovel_test_db/public verified; all 15 tables empty; migrations/schema match. Primary read-only snapshot available. No fixtures written.',
    );
  } finally {
    await client.end();
  }
})().catch((e) => {
  const safe =
    /^(Test table|Unknown|Migration history|Refusing operation|Only |Integration URL)/.test(
      e.message,
    );
  console.error(
    safe
      ? e.message
      : 'FAIL: read-only integration preflight stopped; credentials suppressed. No writes performed.',
  );
  process.exitCode = 1;
});
