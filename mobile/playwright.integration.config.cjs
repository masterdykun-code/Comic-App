/* global __dirname */
const path = require('node:path');
const { createRequire } = require('node:module');
const { defineConfig } = createRequire(path.resolve(__dirname, '../admin-web/package.json'))(
  '@playwright/test',
);
if (
  !/^[a-f0-9]{16}$/.test(process.env.MOBILE_E2E_RUN_ID ?? '') ||
  process.env.MOBILE_E2E_API !== 'http://127.0.0.1:4186/api' ||
  process.env.MOBILE_E2E_WEB !== 'http://127.0.0.1:5196' ||
  !process.env.MOBILE_E2E_FIXTURES ||
  !process.env.MOBILE_E2E_PASSWORD
)
  throw new Error('Use npm run test:e2e:integration guarded runner.');
module.exports = defineConfig({
  testDir: './e2e/integration',
  outputDir: './test-results/postgres',
  workers: 1,
  fullyParallel: false,
  retries: 0,
  timeout: 90000,
  preserveOutput: 'never',
  reporter: './e2e/safe-reporter.cjs',
  use: {
    baseURL: process.env.MOBILE_E2E_WEB,
    browserName: 'chromium',
    viewport: { width: 393, height: 852 },
    hasTouch: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
});
