import { defineConfig } from '@playwright/test';
if (
  !/^[a-f0-9]{16}$/.test(process.env.E2E_RUN_ID ?? '') ||
  process.env.E2E_APP_URL !== 'http://127.0.0.1:5195' ||
  process.env.E2E_API_URL !== 'http://127.0.0.1:4185/api'
) {
  throw new Error('Use the guarded backend npm run test:admin-e2e runner.');
}
export default defineConfig({
  testDir: './tests/integration',
  outputDir: './test-results/integration',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60000,
  reporter: './tests/integration/safe-reporter.cjs',
  use: {
    baseURL: process.env.E2E_APP_URL,
    browserName: 'chromium',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
    viewport: { width: 1440, height: 1080 },
  },
  // The guarded runner owns both processes; never reuse the existing 4000/5173 services.
});
