/* global __dirname */
// Browser smoke only: all API calls are mocked, no mail/database writes.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium, expect } = createRequire(path.resolve(__dirname, '../../admin-web/package.json'))(
  '@playwright/test',
);
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const output = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  let requests = 0,
    resets = 0,
    unknown = 0,
    errors = 0;
  let stage = 'load';
  page.on('pageerror', () => errors++);
  page.on('console', (event) => {
    if (
      event.type() === 'error' &&
      /Unexpected text node|must be rendered|Maximum update depth/.test(event.text())
    )
      errors++;
  });
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url()),
      p = url.pathname;
    if (!p.startsWith('/api/')) {
      if (url.origin === 'http://localhost:8084') return route.continue();
      return route.abort();
    }
    const headers = {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': '*',
      'access-control-allow-methods': 'POST,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (p === '/api/auth/forgot-password') {
      requests++;
      return route.fulfill({ status: 202, headers, json: { success: true } });
    }
    if (p === '/api/auth/reset-password') {
      resets++;
      return route.fulfill(
        resets === 1
          ? {
              status: 400,
              headers,
              json: { success: false, error: { code: 'INVALID_RESET_CODE' } },
            }
          : { status: 200, headers, json: { success: true, data: { sessionsRevoked: true } } },
      );
    }
    unknown++;
    return route.abort();
  });
  try {
    await page.goto('http://localhost:8084/login', { timeout: 120000 });
    stage = 'open recovery';
    await page.getByText('Quên mật khẩu?', { exact: true }).click();
    await page.getByLabel('Email khôi phục', { exact: true }).fill('reader@example.test');
    await page.getByRole('button', { name: 'Gửi mã xác minh', exact: true }).click();
    stage = 'fill verification';
    const fill = async () => {
      await page.getByLabel('Mã xác minh', { exact: true }).fill('123456');
      await page.getByLabel('Mật khẩu mới', { exact: true }).fill('Synthetic-next-password');
      await page
        .getByLabel('Xác nhận mật khẩu mới', { exact: true })
        .fill('Synthetic-next-password');
    };
    await fill();
    stage = 'submit wrong code';
    await page
      .getByRole('button', { name: 'Đặt lại mật khẩu', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'u09-recovery-code.png'), fullPage: true });
    await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
    await expect(
      page.getByText('Mã không đúng, đã hết hạn hoặc đã được sử dụng. Hãy kiểm tra mã mới nhất.', {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel('Mật khẩu mới', { exact: true })).toHaveValue('');
    stage = 'submit valid code';
    await fill();
    await page.getByRole('button', { name: 'Đặt lại mật khẩu', exact: true }).click();
    await expect(page.getByText('Đặt lại mật khẩu thành công', { exact: true })).toBeVisible();
    stage = 'return login';
    await page.screenshot({ path: path.join(output, 'u09-recovery-success.png'), fullPage: true });
    await page.getByRole('button', { name: 'Đăng nhập bằng mật khẩu mới', exact: true }).click();
    // Expo Router retains the original login screen below the stack; select the visible textbox.
    await expect(page.getByRole('textbox', { name: 'Email', exact: true })).toBeVisible();
    if (requests !== 1 || resets !== 2 || unknown || errors) throw Error('Unexpected counters');
    console.log(
      JSON.stringify({
        result: 'PASS',
        mockEmailRequests: requests,
        explicitMockResets: resets,
        unknownRequests: unknown,
        renderErrors: errors,
        nativeDeviceTested: false,
      }),
    );
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'u09-recovery-failure.png'), fullPage: true });
    console.log(
      JSON.stringify({
        failedStage: stage,
        requests,
        resets,
        unknown,
        errors,
        errorType: error.name,
      }),
    );
    throw error;
  } finally {
    await browser.close();
  }
}
main().catch(() => {
  console.error('Recovery browser smoke failed; no real email/account was used.');
  process.exitCode = 1;
});
