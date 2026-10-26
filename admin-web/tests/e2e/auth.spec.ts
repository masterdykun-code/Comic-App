import { expect, test, type Page } from '@playwright/test';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) =>
    new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.fallback(),
  );
});
const user = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'qa_admin',
  displayName: 'QA Admin',
  email: 'admin@example.test',
  role: 'ADMIN',
  status: 'ACTIVE',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
async function mockApi(page: Page, role = 'ADMIN') {
  // Mock every API request; never log in to the actual backend in automation.
  await page.route('http://localhost:4000/api/**', async (route) => {
    const url = new URL(route.request().url());
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (url.pathname.endsWith('/auth/me'))
      return route.fulfill({ json: { success: true, data: { ...user, role } }, headers });
    if (url.pathname.endsWith('/auth/login') || url.pathname.endsWith('/auth/refresh'))
      return route.fulfill({
        json: {
          success: true,
          data: {
            user: { ...user, role },
            accessToken: 'synthetic.access.token',
            refreshToken: 'x'.repeat(64),
            tokenType: 'Bearer',
            expiresIn: 900,
          },
        },
        headers,
      });
    if (url.pathname.endsWith('/auth/logout'))
      return route.fulfill({ json: { success: true }, headers });
    return route.abort();
  });
}
async function login(page: Page) {
  await page.getByLabel('Địa chỉ email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-password-123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
}
test('desktop ADMIN flow, screenshots, no storage, reload and logout', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  await mockApi(page);
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/login$/);
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
  await login(page);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.getByText('admin@example.test')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Stories', exact: true })).toHaveAttribute(
    'href',
    '/stories',
  );
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.screenshot({ path: 'test-results/dashboard-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.reload();
  await expect(page).toHaveURL(/\/login$/);
});
test('USER is blocked without creating an ADMIN layout', async ({ page }) => {
  await mockApi(page, 'USER');
  await page.goto('/login');
  await login(page);
  await expect(page.getByRole('alert')).toContainText('không có quyền');
  await expect(page).toHaveURL(/\/login$/);
});
test('mobile layout has no overflow and keyboard-accessible drawer', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.goto('/login');
  await login(page);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.getByRole('button', { name: 'Mở điều hướng' }).click();
  await expect(page.getByRole('button', { name: 'Đóng điều hướng' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Mở điều hướng' })).toBeFocused();
  await expect(page.getByRole('navigation', { name: 'Điều hướng chính' })).not.toBeVisible();
  await page.getByRole('button', { name: 'Mở điều hướng' }).click();
  await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mở điều hướng' })).toBeFocused();
  await page.screenshot({ path: 'test-results/dashboard-mobile.png', fullPage: true });
});
