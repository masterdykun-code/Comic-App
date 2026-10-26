import { expect, test, type Page } from '@playwright/test';
import { genre, rootComment, replyComment } from '../catalog-fixtures';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) =>
    new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.fallback(),
  );
});
const admin = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'qa_admin',
  email: 'admin@example.test',
  displayName: 'QA Admin',
  role: 'ADMIN',
  status: 'ACTIVE',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};

// Every API request is intercepted. No real account, PostgreSQL or Cloudinary is used.
async function fixture(page: Page, path: '/genres' | '/comments') {
  let genres = [structuredClone(genre)];
  let comments = structuredClone([rootComment, replyComment]);
  const writes: string[] = [];
  await page.route('http://localhost:4000/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const method = request.method();
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const send = (data: unknown, status = 200) =>
      route.fulfill({ headers, status, json: { success: true, data } });
    if (url.pathname === '/api/auth/login')
      return send({
        user: admin,
        accessToken: 'synthetic.access.token',
        refreshToken: 'x'.repeat(64),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
    if (url.pathname === '/api/auth/me') return send(admin);
    if (url.pathname === '/api/genres' && method === 'GET') return send(genres);
    if (url.pathname === '/api/admin/genres' && method === 'POST') {
      writes.push('create');
      const row = { ...request.postDataJSON(), id: '30000000-0000-4000-8000-000000000002' };
      genres.push(row);
      return send(row, 201);
    }
    if (url.pathname.startsWith('/api/admin/genres/') && method === 'PATCH') {
      writes.push('edit');
      const id = url.pathname.split('/').at(-1)!;
      const row = { id, ...request.postDataJSON() };
      genres = genres.map((g) => (g.id === id ? row : g));
      return send(row);
    }
    if (url.pathname.startsWith('/api/admin/genres/') && method === 'DELETE') {
      writes.push('delete');
      const id = url.pathname.split('/').at(-1)!;
      if (id === genre.id)
        return route.fulfill({
          headers,
          status: 409,
          json: { success: false, error: { code: 'GENRE_IN_USE' } },
        });
      genres = genres.filter((g) => g.id !== id);
      return send({ id, removed: true });
    }
    if (url.pathname === '/api/admin/comments' && method === 'GET') {
      const rows = comments.filter(
        (c) =>
          (!url.searchParams.get('status') || c.status === url.searchParams.get('status')) &&
          (!url.searchParams.get('parentId') || c.parentId === url.searchParams.get('parentId')),
      );
      return route.fulfill({
        headers,
        json: {
          success: true,
          data: rows,
          pagination: { page: 1, limit: 20, total: rows.length, totalPages: 1 },
        },
      });
    }
    if (url.pathname.endsWith('/moderate') && method === 'PATCH') {
      writes.push('moderate');
      const id = url.pathname.split('/').at(-2)!;
      const { status } = request.postDataJSON();
      comments = comments.map((c) =>
        c.id === id
          ? { ...c, status }
          : c.parent?.id === id
            ? { ...c, parent: { ...c.parent, status } }
            : c,
      );
      return send({ id, storyId: rootComment.storyId, status, updatedAt: rootComment.updatedAt });
    }
    return route.abort();
  });
  await page.goto('/login');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill(admin.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-password-123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const menu = page.getByRole('button', { name: 'Mở điều hướng' });
  if (await menu.isVisible()) await menu.click();
  await page
    .getByRole('link', { name: path === '/genres' ? 'Genres' : 'Comments', exact: true })
    .click();
  return writes;
}

test('Genres create/edit/delete require confirmation; linked deletion stays a conflict', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const writes = await fixture(page, '/genres');
  await expect(page.getByText(genre.name, { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/genres-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Thêm thể loại', exact: true }).click();
  await page.getByLabel('Tên thể loại', { exact: true }).fill('Khoa học');
  await page.getByRole('button', { name: 'Tạo slug từ tên' }).click();
  await page.getByRole('button', { name: 'Tạo thể loại', exact: true }).click();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Xác nhận tạo thể loại' }).click();
  await expect(page.getByText('Khoa học', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Sửa Khoa học', exact: true }).click();
  await page.getByLabel('Tên thể loại', { exact: true }).fill('Khoa học mới');
  await page.getByRole('button', { name: 'Lưu thể loại', exact: true }).click();
  expect(writes).toEqual(['create']);
  await page.getByRole('button', { name: 'Xác nhận lưu thể loại' }).click();
  await expect(page.getByText('Khoa học mới', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Xóa Khoa học mới', exact: true }).click();
  await page.getByRole('button', { name: 'Quay lại' }).click();
  expect(writes).toEqual(['create', 'edit']);
  await page.getByRole('button', { name: 'Xóa Khoa học mới', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận xóa thể loại' }).click();
  await expect(page.getByText('Khoa học mới', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `Xóa ${genre.name}`, exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận xóa thể loại' }).click();
  await expect(page.getByRole('alert')).toContainText('đang được truyện sử dụng');
  await expect(page.getByText(genre.name, { exact: true })).toBeVisible();
  expect(writes).toEqual(['create', 'edit', 'delete', 'delete']);
});

test('Comments filter, reply context and confirmed Hide/Show work on tablet without overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const writes = await fixture(page, '/comments');
  await expect(page.getByText(/Một câu chuyện thú vị/)).toBeVisible();
  await expect(page.getByText(/Phản hồi @qa_reader/)).toBeVisible();
  expect(
    await page
      .locator('.comments-content')
      .first()
      .evaluate((el) => getComputedStyle(el).whiteSpace),
  ).toBe('pre-wrap');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/comments-tablet.png', fullPage: true });
  await page.getByRole('button', { name: `Ẩn bình luận ${rootComment.id}` }).click();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Quay lại' }).click();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: `Ẩn bình luận ${rootComment.id}` }).click();
  await page.getByRole('button', { name: 'Xác nhận ẩn bình luận' }).click();
  await expect(
    page.getByRole('button', { name: `Hiện bình luận ${rootComment.id}` }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Trạng thái bình luận', exact: true })
    .selectOption('HIDDEN');
  await page.getByRole('button', { name: 'Áp dụng bộ lọc' }).click();
  await expect(page).toHaveURL(/status=HIDDEN/);
  await page.getByRole('button', { name: `Hiện bình luận ${rootComment.id}` }).click();
  await page.getByRole('button', { name: 'Xác nhận hiện bình luận' }).click();
  await expect(page.getByText(/Một câu chuyện thú vị/)).toHaveCount(0);
  expect(writes).toEqual(['moderate', 'moderate']);
  await expect(page.getByRole('button', { name: /Xóa bình luận/ })).toHaveCount(0);
});
