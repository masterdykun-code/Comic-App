/* global __dirname */
// Browser UI smoke only. Every API request is mocked; no real account is used.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { chromium, expect } = createRequire(path.resolve(__dirname, '../../admin-web/package.json'))(
  '@playwright/test',
);
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const user = {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'qa_reader',
    email: 'qa@example.invalid',
    displayName: 'Bạn đọc kiểm thử',
    avatarUrl: null,
    role: 'USER',
    status: 'ACTIVE',
    createdAt: '2026-10-24T00:00:00Z',
    updatedAt: '2026-10-24T00:00:00Z',
  };
  const output = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  let changes = 0,
    unknown = 0,
    errors = 0;
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
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (p === '/api/auth/login')
      return route.fulfill({
        headers,
        json: {
          success: true,
          data: {
            user,
            accessToken: 'synthetic.access.signature',
            refreshToken: 'a'.repeat(64),
            tokenType: 'Bearer',
            expiresIn: 900,
          },
        },
      });
    if (p === '/api/auth/me')
      return route.fulfill({ headers, json: { success: true, data: user } });
    if (p === '/api/auth/change-password') {
      changes++;
      return route.fulfill(
        changes === 1
          ? {
              status: 403,
              headers,
              json: { success: false, error: { code: 'CURRENT_PASSWORD_INCORRECT' } },
            }
          : { status: 200, headers, json: { success: true, data: { sessionsRevoked: true } } },
      );
    }
    unknown++;
    return route.abort();
  });
  try {
    await page.goto('http://localhost:8084/login?next=%2Fprofile', { timeout: 120000 });
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-only-password');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.getByRole('button', { name: 'Đổi mật khẩu', exact: true }).click();
    const fill = async () => {
      await page.getByLabel('Mật khẩu hiện tại', { exact: true }).fill('Synthetic-current-value');
      await page.getByLabel('Mật khẩu mới', { exact: true }).fill('Synthetic-next-value');
      await page.getByLabel('Xác nhận mật khẩu mới', { exact: true }).fill('Synthetic-next-value');
    };
    await fill();
    await page
      .getByRole('button', { name: 'Lưu mật khẩu mới', exact: true })
      .scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'u10-password-form.png'), fullPage: true });
    await page.getByRole('button', { name: 'Lưu mật khẩu mới', exact: true }).click();
    await expect(page.getByText('Mật khẩu hiện tại chưa đúng.', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Mật khẩu hiện tại', { exact: true })).toHaveValue('');
    await fill();
    await page.getByRole('button', { name: 'Lưu mật khẩu mới', exact: true }).click();
    await expect(
      page.getByText('Đổi mật khẩu thành công. Vui lòng đăng nhập lại.', { exact: true }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Đổi mật khẩu', exact: true })).toHaveCount(0);
    await page.screenshot({ path: path.join(output, 'u10-password-success.png'), fullPage: true });
    if (changes !== 2 || unknown || errors) throw Error('Unexpected smoke counters');
    console.log(
      JSON.stringify({
        result: 'PASS',
        explicitMockSubmissions: changes,
        unknownRequests: unknown,
        renderErrors: errors,
        nativeDeviceTested: false,
      }),
    );
  } finally {
    await browser.close();
  }
}
main().catch(() => {
  console.error('Password browser smoke failed; no real account was used.');
  process.exitCode = 1;
});
