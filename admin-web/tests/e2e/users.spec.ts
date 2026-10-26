import { expect, test } from '@playwright/test';
const admin = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'qa_admin',
  email: 'admin@example.test',
  displayName: 'QA Admin',
  avatarUrl: null,
  role: 'ADMIN',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const reader = {
  ...admin,
  id: '20000000-0000-4000-8000-000000000001',
  username: 'reader',
  email: 'reader@example.test',
  displayName: 'Bạn đọc thử',
  role: 'USER',
};
test('Dashboard and USER management: search, detail, confirm/cancel ban and unban', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  let row = { ...reader },
    writes = 0;
  const unexpected: string[] = [];
  // Fail closed for all API hosts, preserving Vite source-module URLs containing /api/.
  await page.route('**/api/**', (route) =>
    new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.fallback(),
  );
  await page.route('http://localhost:4000/api/**', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      headers = {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-headers': 'content-type,authorization',
        'access-control-allow-methods': 'GET,POST,PATCH,OPTIONS',
      };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const send = (data: unknown) => route.fulfill({ headers, json: { success: true, data } });
    if (url.pathname === '/api/auth/login')
      return send({
        user: admin,
        accessToken: 'synthetic.access.token',
        refreshToken: 'x'.repeat(64),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
    if (url.pathname === '/api/auth/me') return send(admin);
    if (url.pathname === '/api/admin/dashboard')
      return send({
        users: {
          total: 1,
          active: row.status === 'ACTIVE' ? 1 : 0,
          banned: row.status === 'BANNED' ? 1 : 0,
        },
        stories: { total: 25, novels: 15, comics: 10, published: 25 },
        totalChapters: 1300,
        readingEvents: 57,
        readingMetric: 'STORED_AUTHENTICATED_HISTORY',
        popularStories: [
          {
            id: '30000000-0000-4000-8000-000000000001',
            title: 'Truyện nổi bật',
            type: 'COMIC',
            publishStatus: 'PUBLISHED',
            readCount: 57,
          },
        ],
      });
    if (url.pathname === '/api/admin/users')
      return route.fulfill({
        headers,
        json: {
          success: true,
          data: [row],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      });
    if (url.pathname === `/api/admin/users/${row.id}`) return send(row);
    if (url.pathname === `/api/admin/users/${row.id}/status` && req.method() === 'PATCH') {
      const body = req.postDataJSON();
      expect(body.confirm).toBe(true);
      expect(body.expectedUpdatedAt).toBe(row.updatedAt);
      writes++;
      row = { ...row, status: body.status, updatedAt: `2026-02-0${writes}T00:00:00Z` };
      return send(row);
    }
    unexpected.push(url.pathname);
    return route.abort();
  });
  await page.goto('/login');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill(admin.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-only-123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page.getByText('Truyện nổi bật', { exact: true })).toBeVisible();
  await expect(page.getByText('1.300', { exact: true })).toBeVisible();
  await expect(page.getByText(/không tính khách/)).toBeVisible();
  await page.screenshot({ path: 'test-results/users-dashboard-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Users', exact: true }).click();
  await page.getByLabel('Tìm kiếm', { exact: true }).fill('reader@example.test');
  const search = page.waitForRequest(
    (r) => r.url().includes('/api/admin/users?') && r.url().includes('search=reader'),
  );
  await page.getByRole('button', { name: 'Tìm người dùng' }).click();
  await search;
  await page.getByRole('link', { name: 'Chi tiết', exact: true }).click();
  await page.getByRole('button', { name: 'Khóa tài khoản', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
  expect(writes).toBe(0);
  await page.getByRole('button', { name: 'Khóa tài khoản', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận khóa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mở khóa tài khoản', exact: true })).toBeVisible();
  expect(writes).toBe(1);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.getByRole('button', { name: 'Mở khóa tài khoản', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeInViewport();
  await page.screenshot({ path: 'test-results/users-confirm-tablet.png', fullPage: true });
  await page.getByRole('button', { name: 'Xác nhận mở khóa', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Khóa tài khoản', exact: true })).toBeVisible();
  expect(writes).toBe(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(unexpected).toEqual([]);
});
