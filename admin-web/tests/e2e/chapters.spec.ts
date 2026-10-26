/// <reference types="node" />
import { Buffer } from 'node:buffer';
import { expect, test, type Page } from '@playwright/test';
import { chapterId, storyId, testChapter, testComic, testStory } from '../chapter-fixtures';
test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', (route) =>
    new URL(route.request().url()).pathname.startsWith('/api/') ? route.abort() : route.fallback(),
  );
});

const root = `/stories/${storyId}/chapters`;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
async function fixture(page: Page, type: 'NOVEL' | 'COMIC' = 'NOVEL') {
  const profile = {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'qa_admin',
    displayName: 'QA Admin',
    email: 'admin@example.test',
    role: 'ADMIN',
    status: 'ACTIVE',
    avatarUrl: null,
    createdAt: testStory.createdAt,
    updatedAt: testStory.updatedAt,
  };
  let chapter = structuredClone(type === 'NOVEL' ? testChapter : testComic);
  let tick = 0;
  const writes: string[] = [];
  const uploads: number[] = [];

  const next = () => new Date(Date.UTC(2026, 2, 1, 0, 0, ++tick)).toISOString();
  await page.route('http://localhost:4000/api/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const headers = {
      'access-control-allow-origin': new URL(page.url()).origin,
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,PATCH,PUT,OPTIONS',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
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
    if (path === '/api/genres') return respond([]);

    if (path === `/api/admin/stories/${storyId}`) return respond({ ...testStory, type });
    if (path === `/api/admin/stories/${storyId}/chapters` && method === 'GET')
      return route.fulfill({
        headers,
        json: {
          success: true,
          data: [chapter],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      });
    if (path === `/api/admin/stories/${storyId}/chapters` && method === 'POST') {
      writes.push('create');
      const body = request.postDataJSON();
      expect(body).not.toHaveProperty('publishStatus');
      expect(body).not.toHaveProperty('storyId');
      if (type === 'COMIC') expect(body).not.toHaveProperty('content');
      chapter = { ...chapter, ...body, pages: [], updatedAt: next(), publishStatus: 'DRAFT' };
      return respond(chapter, 201);
    }
    if (path === `/api/admin/chapters/${chapterId}` && method === 'GET') return respond(chapter);
    if (path === `/api/admin/chapters/${chapterId}` && method === 'PATCH') {
      writes.push('update');
      const { expectedUpdatedAt, ...body } = request.postDataJSON();
      expect(expectedUpdatedAt).toBe(chapter.updatedAt);
      chapter = { ...chapter, ...body, updatedAt: next() };
      return respond(chapter);
    }
    if (path === `/api/admin/chapters/${chapterId}/pages` && method === 'PUT') {
      writes.push('pages');
      expect(request.postDataJSON().expectedUpdatedAt).toBe(chapter.updatedAt);
      chapter = { ...chapter, pages: request.postDataJSON().pages, updatedAt: next() };
      return respond(chapter);
    }
    if (path === `/api/admin/chapters/${chapterId}/publish`) {
      writes.push('publish');
      expect(request.postDataJSON()).toEqual({ expectedUpdatedAt: chapter.updatedAt });
      chapter = { ...chapter, publishStatus: 'PUBLISHED', updatedAt: next() };
      return respond(chapter);
    }
    if (path === '/api/admin/uploads/chapter-pages') {
      const body = request.postDataBuffer()!.toString('latin1');
      const count = (body.match(/name="files";/g) ?? []).length;
      uploads.push(count);
      return respond(
        Array.from({ length: count }, (_, order) => ({
          secureUrl: `https://images.example.test/upload-${uploads.length}-${order}.png`,
          publicId: `mock-${uploads.length}-${order}`,
          order: order + 1,
        })).reverse(),
        201,
      );
    }
    return route.abort(); // Never pass API requests through to the real backend.
  });
  await page.route('https://images.example.test/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: png }),
  );
  await page.goto('/login');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill(profile.email);
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-password-123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  // Navigate inside the authenticated tab; reloading intentionally loses memory-only auth.
  await page.evaluate((path) => {
    history.pushState(null, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, root);
  await expect(page.getByRole('heading', { name: 'Quản lý chương' })).toBeVisible();
  return { writes, uploads };
}
test('NOVEL draft/edit/plain-text detail, departure guard and confirmed publishing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const { writes } = await fixture(page);
  await page.screenshot({ path: 'test-results/chapters-list-desktop.png', fullPage: true });
  await page.getByRole('link', { name: 'Thêm chương' }).click();
  await page.getByLabel('Tên chương', { exact: true }).fill('Một chương NOVEL mới');
  await page
    .getByLabel('Nội dung chương', { exact: true })
    .fill('Dòng đầu\n\nDòng cuối <b>văn bản</b>');
  await page.getByRole('link', { name: 'Hủy', exact: true }).click();
  const leave = page.getByRole('dialog', { name: 'Rời trang chương?' });
  await expect(leave).toBeVisible();
  await leave.getByRole('button', { name: 'Quay lại' }).click();
  await expect(page.getByLabel('Tên chương', { exact: true })).toHaveValue('Một chương NOVEL mới');
  await page.screenshot({ path: 'test-results/chapter-novel-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Tạo chương nháp' }).click();
  await expect(page.getByRole('heading', { name: 'Một chương NOVEL mới' })).toBeVisible();
  expect(writes).toEqual(['create']);
  const text = page.locator('.chapters-novel');
  await expect(text).toHaveText('Dòng đầu\n\nDòng cuối <b>văn bản</b>');
  expect(await text.evaluate((element) => getComputedStyle(element).whiteSpace)).toBe('pre-wrap');
  await expect(text.locator('b')).toHaveCount(0);
  await page.getByRole('link', { name: 'Chỉnh sửa chương' }).click();
  await page.getByLabel('Nội dung chương', { exact: true }).fill('Nội dung đã sửa\nGiữ xuống dòng');
  await page.getByRole('button', { name: 'Lưu thông tin chương' }).click();
  await expect(page.getByText('Đã lưu thông tin chương.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Xem nội dung đã lưu' }).click();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  expect(writes).toEqual(['create', 'update']);
  await page.getByRole('button', { name: 'Xác nhận xuất bản' }).click();
  await expect(page.getByText('Đã xuất bản', { exact: true })).toBeVisible();
  expect(writes).toEqual(['create', 'update', 'publish']);
});
test('COMIC uses separate confirmed upload batches, keeps old pages and confirms full replacement', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1080 });
  const { writes, uploads } = await fixture(page, 'COMIC');
  await page.getByRole('link', { name: 'Chỉnh sửa', exact: true }).click();
  await page.getByLabel('Chọn ảnh trang truyện').setInputFiles(
    Array.from({ length: 21 }, (_, n) => ({
      name: `page-${n}.png`,
      mimeType: 'image/png',
      buffer: png,
    })),
  );
  expect(uploads).toHaveLength(0);
  await page.getByRole('button', { name: /Xác nhận tải batch tiếp theo/ }).click();
  expect(uploads).toHaveLength(0);
  await page.getByRole('button', { name: 'Tải 20 ảnh trong batch này' }).click();
  await expect(
    page.getByRole('button', { name: 'Xác nhận tải batch tiếp theo (1 ảnh)' }),
  ).toBeVisible();
  expect(uploads).toEqual([20]);
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: /Xác nhận tải batch tiếp theo/ }).click();
  await page.getByRole('button', { name: 'Tải 1 ảnh trong batch này' }).click();
  await expect(page.getByRole('button', { name: 'Lưu danh sách trang' })).toBeEnabled();
  expect(uploads).toEqual([20, 1]);
  await expect(page.getByAltText('Trang 1', { exact: true })).toHaveAttribute(
    'src',
    testComic.pages[0]!.imageUrl,
  );
  await expect(page.getByAltText('Trang 3', { exact: true })).toHaveAttribute(
    'src',
    'https://images.example.test/upload-1-0.png',
  );
  await page.getByRole('button', { name: 'Đưa trang 2 lên' }).click();
  await expect(page.getByAltText('Trang 1', { exact: true })).toHaveAttribute(
    'src',
    testComic.pages[1]!.imageUrl,
  );
  await page.screenshot({ path: 'test-results/chapter-comic-editor.png', fullPage: true });
  await page.getByRole('button', { name: 'Lưu danh sách trang' }).click();
  expect(writes).toEqual([]);
  await page.getByRole('button', { name: 'Xác nhận lưu danh sách trang' }).click();
  await expect(page.getByText('Đã lưu toàn bộ danh sách trang.')).toBeVisible();
  expect(writes).toEqual(['pages']);
});

test('tablet chapter editor has no overflow, Back is guarded and invalid publication is blocked', async ({
  page,
}) => {
  await page.setViewportSize({ width: 820, height: 1180 });
  const { writes } = await fixture(page, 'COMIC');
  await page.getByRole('link', { name: 'Thêm chương' }).click();
  await page.getByLabel('Tên chương', { exact: true }).fill('Nháp COMIC');
  await page.getByRole('button', { name: 'Tạo chương nháp' }).click();
  await expect(page.getByRole('heading', { name: 'Trang ảnh COMIC' })).toBeVisible();
  await page.getByLabel('Tên chương', { exact: true }).fill('Chưa lưu');
  await page.goBack();
  const dialog = page.getByRole('dialog', { name: 'Rời trang chương?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Quay lại' }).click();
  await expect(page.getByLabel('Tên chương', { exact: true })).toHaveValue('Chưa lưu');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/chapter-comic-tablet.png', fullPage: true });
  await page.getByRole('link', { name: 'Xem nội dung đã lưu' }).click();
  await page.getByRole('button', { name: 'Bỏ thay đổi và rời trang' }).click();
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Xác nhận xuất bản' })).toBeDisabled();
  expect(writes).toEqual(['create']);
});

for (const type of ['NOVEL', 'COMIC'] as const)
  test(`ADMIN confirms VIP and free switch for ${type} (mock only)`, async ({ page }) => {
    const state = await fixture(page, type);
    await page.getByRole('link', { name: 'Chi tiết', exact: true }).click();
    await page.getByLabel('Chế độ chương').selectOption('VIP');
    await expect(page.getByLabel('Giá mở khóa (Coin)')).toHaveValue('10');
    await page.getByRole('button', { name: 'Lưu quyền đọc' }).click();
    await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
    expect(state.writes).toEqual([]);
    await page.getByRole('button', { name: 'Lưu quyền đọc' }).click();
    await page.getByRole('button', { name: 'Xác nhận quyền đọc' }).click();
    await expect(page.getByText('VIP · 10 Coin', { exact: true })).toBeVisible();
    await page.screenshot({
      path: `test-results/vip-${type.toLowerCase()}-settings.png`,
      fullPage: true,
    });
    await page.getByLabel('Chế độ chương').selectOption('FREE');
    await page.getByRole('button', { name: 'Lưu quyền đọc' }).click();
    await page.getByRole('button', { name: 'Xác nhận quyền đọc' }).click();
    await expect(page.getByText('Miễn phí cho mọi độc giả')).toBeVisible();
    expect(state.writes).toEqual(['update', 'update']);
  });
