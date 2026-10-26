/// <reference types="node" />
import { expect, test, type Page } from '@playwright/test';
import { Buffer } from 'node:buffer';

const id = '20000000-0000-4000-8000-000000000001';
const genre = { id: '30000000-0000-4000-8000-000000000001', name: 'Phiêu lưu', slug: 'phieu-luu' };
const profile = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'qa_admin',
  displayName: 'QA Admin',
  email: 'admin@example.test',
  role: 'ADMIN',
  status: 'ACTIVE',
  avatarUrl: null,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const initial = {
  id,
  title: 'Câu chuyện kiểm thử',
  slug: 'cau-chuyen',
  type: 'NOVEL',
  authorName: 'QA Author',
  description: 'Nội dung mô tả kiểm thử.',
  coverUrl: '',
  genres: [genre],
  status: 'ONGOING',
  publishStatus: 'DRAFT',
  chapterCount: 0,
  createdBy: profile.id,
  createdAt: profile.createdAt,
  updatedAt: profile.updatedAt,
};
test.beforeEach(async ({ page }) => {
  // Fail closed if local API configuration differs from the mocked hostname below.
  await page.route('**/api/**', (route) =>
    new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.fallback(),
  );
});
async function fixture(page: Page, published = false) {
  let story = { ...initial, publishStatus: published ? 'PUBLISHED' : 'DRAFT' };
  let deleted = false;
  const uploads: string[] = [];
  const writes: string[] = [];
  // Every API request is intercepted. Never reach PostgreSQL or Cloudinary.
  await page.route('http://localhost:4000/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const respond = (data: unknown, status = 200) =>
      route.fulfill({ status, headers, json: { success: true, data } });
    if (path === '/api/auth/login' || path === '/api/auth/refresh')
      return respond({
        user: profile,
        accessToken: 'synthetic.access.token',
        refreshToken: 'x'.repeat(64),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
    if (path === '/api/auth/me') return respond(profile);
    if (path === '/api/auth/logout') return respond({});
    if (path === '/api/genres') return respond([genre]);
    if (path === '/api/admin/stories')
      return route.fulfill({
        headers,
        json: {
          success: true,
          data: deleted ? [] : [story],
          pagination: { page: 1, limit: 20, total: deleted ? 0 : 1, totalPages: deleted ? 0 : 1 },
        },
      });
    if (path === `/api/admin/stories/${id}/unpublish` && request.method() === 'PATCH') {
      writes.push('hide');
      story = { ...story, publishStatus: 'DRAFT' };
      return respond(story);
    }
    if (path === `/api/admin/stories/${id}` && request.method() === 'DELETE') {
      expect(request.postDataJSON()).toEqual({ confirm: true, expectedUpdatedAt: story.updatedAt });
      writes.push('delete');
      deleted = true;
      return respond({ deleted: true });
    }
    if (path === `/api/admin/stories/${id}`) return respond(story);
    if (path === '/api/admin/uploads/cover') {
      uploads.push(request.method());
      return respond(
        { secureUrl: 'https://images.example.test/mock-cover.png', publicId: 'mock-cover' },
        201,
      );
    }
    if (path === '/api/stories' && request.method() === 'POST') {
      const body = request.postDataJSON();
      writes.push('create');
      expect(body).not.toHaveProperty('publishStatus');
      expect(body).not.toHaveProperty('createdBy');
      story = {
        ...story,
        ...body,
        genres: body.genreIds.length ? [genre] : [],
        publishStatus: 'DRAFT',
      };
      return respond(story, 201);
    }
    if (path === `/api/stories/${id}` && request.method() === 'PATCH') {
      writes.push('edit');
      story = { ...story, ...request.postDataJSON() };
      return respond(story);
    }
    if (path === `/api/stories/${id}/publish` && request.method() === 'PATCH') {
      writes.push('publish');
      expect(request.postDataJSON()).toEqual({});
      story = { ...story, publishStatus: 'PUBLISHED' };
      return respond(story);
    }
    return route.abort();
  });
  // Intercept image rendering too; no external media requests in automated tests.
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({
      contentType: 'image/png',
      body: Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
        'base64',
      ),
    }),
  );
  await page.goto('/login');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill(profile.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-password-123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return { uploads, writes };
}
test('Stories desktop create, confirmed mock cover upload, edit and publish', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const { uploads, writes } = await fixture(page);
  await page.getByRole('link', { name: 'Stories', exact: true }).click();
  await expect(page.getByRole('link', { name: initial.title, exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/stories-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Tạo truyện mới' }).click();
  await page.getByLabel('Tên truyện').fill('Bình minh mới');
  await expect(page.getByLabel('Tên truyện')).toHaveValue('Bình minh mới');
  await page.getByLabel('Tác giả').fill('Tác giả QA');
  await expect(page.getByLabel('Tên truyện')).toHaveValue('Bình minh mới');
  await page.getByLabel('Loại truyện').selectOption('COMIC');
  await expect(page.getByLabel('Tên truyện')).toHaveValue('Bình minh mới');
  await page.getByLabel('Mô tả').fill('Mô tả truyện kiểm thử.');
  await expect(page.getByLabel('Tên truyện')).toHaveValue('Bình minh mới');
  await page.getByLabel(genre.name).check();
  await expect(page.getByLabel('Tên truyện')).toHaveValue('Bình minh mới');
  await page.getByLabel('Chọn ảnh bìa').setInputFiles({
    name: 'mock-cover.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  expect(uploads).toHaveLength(0);
  await page.getByRole('button', { name: 'Xác nhận tải ảnh lên' }).click();
  const uploadDialog = page.getByRole('dialog', { name: 'Tải ảnh lên Cloudinary?' });
  await expect(uploadDialog).toBeVisible();
  expect(uploads).toHaveLength(0);
  await uploadDialog.getByRole('button', { name: 'Tải lên Cloudinary', exact: true }).click();
  await expect(page.getByLabel('URL ảnh bìa')).toHaveValue(
    'https://images.example.test/mock-cover.png',
  );
  expect(uploads).toHaveLength(1);
  await page.screenshot({ path: 'test-results/stories-create-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
  await expect(page.getByRole('heading', { name: 'Bình minh mới' })).toBeVisible();
  expect(writes).toEqual(['create']);
  await page.getByRole('link', { name: 'Chỉnh sửa', exact: true }).click();
  await page.getByLabel('Tên truyện').fill('Bình minh đã sửa');
  await page.getByRole('button', { name: 'Lưu thay đổi' }).click();
  await expect(page.getByRole('heading', { name: 'Bình minh đã sửa' })).toBeVisible();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  expect(writes).toEqual(['create', 'edit']);
  const dialog = page.getByRole('dialog', { name: 'Xuất bản truyện?' });
  await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape');
  expect(writes).toEqual(['create', 'edit']);
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận xuất bản' }).click();
  await expect(page.getByText('Đã xuất bản', { exact: true })).toBeVisible();
  expect(writes).toEqual(['create', 'edit', 'publish']);
  await page.screenshot({ path: 'test-results/stories-detail-desktop.png', fullPage: true });
});
test('tablet Stories and editor stay within viewport; dialog traps focus', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  await fixture(page);
  await page.getByRole('button', { name: 'Mở điều hướng' }).click();
  await page.getByRole('link', { name: 'Stories', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quản lý truyện' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/stories-tablet.png', fullPage: true });
  await page.getByRole('link', { name: 'Tạo truyện mới' }).click();
  await page.getByLabel('Tên truyện').fill('Chưa lưu');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Hủy', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  for (let index = 0; index < 5; index++) {
    await page.keyboard.press('Tab');
    expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
  }
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await page.screenshot({ path: 'test-results/stories-form-tablet.png', fullPage: true });
});

test('published story hide, re-publish and permanent delete require explicit confirmation (mock only)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { writes, uploads } = await fixture(page, true);
  await page.getByRole('link', { name: 'Stories', exact: true }).click();
  await page.getByRole('button', { name: `Xóa truyện ${initial.title}`, exact: true }).click();
  const deletion = page.getByRole('dialog', { name: 'Xóa vĩnh viễn truyện?' });
  await expect(deletion).toContainText('không thể hoàn tác');
  expect(await deletion.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await deletion.getByRole('alert').evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(
    true,
  );
  const bounds = await deletion.boundingBox();
  expect(bounds).not.toBeNull();
  expect(Math.abs(bounds!.x + bounds!.width / 2 - 720)).toBeLessThan(3);
  expect(writes).toEqual([]);
  await page.screenshot({ path: 'test-results/story-delete-confirmation.png', fullPage: true });
  await deletion.getByRole('button', { name: 'Quay lại', exact: true }).click();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: `Ẩn truyện ${initial.title}`, exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận ẩn truyện', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Ẩn truyện ${initial.title}`, exact: true }),
  ).toHaveCount(0);
  expect(writes).toEqual(['hide']);
  await page.getByRole('link', { name: initial.title, exact: true }).click();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận xuất bản', exact: true }).click();
  await expect(
    page.getByRole('button', { name: `Ẩn truyện ${initial.title}`, exact: true }),
  ).toBeVisible();
  expect(writes).toEqual(['hide', 'publish']);
  await page.getByRole('button', { name: `Xóa truyện ${initial.title}`, exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận xóa vĩnh viễn', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Quản lý truyện', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: initial.title, exact: true })).toHaveCount(0);
  expect(writes).toEqual(['hide', 'publish', 'delete']);
  expect(uploads).toEqual([]);
});
