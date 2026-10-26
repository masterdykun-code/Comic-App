import { test, expect, type Page } from '@playwright/test';
const id = '20000000-0000-4000-8000-000000000099';
async function fixture(page: Page, duplicate = false) {
  let previews = 0,
    imports = 0;
  await page.route(
    (url) => url.pathname.startsWith('/api/'),
    async (route) => {
      const request = route.request(),
        url = new URL(request.url());
      const headers = {
        'access-control-allow-origin': new URL(page.url()).origin,
        'access-control-allow-headers': 'content-type,authorization',
        'access-control-allow-methods': 'GET,POST,DELETE,OPTIONS',
      };
      if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
      const send = (data: unknown, status = 200) =>
        route.fulfill({ status, headers, json: { success: true, data } });
      const user = {
        id: '10000000-0000-4000-8000-000000000001',
        username: 'epub_admin',
        email: 'admin@example.test',
        displayName: 'QA Admin',
        role: 'ADMIN',
        status: 'ACTIVE',
        avatarUrl: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      if (url.pathname === '/api/auth/login' || url.pathname === '/api/auth/refresh')
        return send({
          user,
          accessToken: 'synthetic.access.token',
          refreshToken: 'r'.repeat(64),
          tokenType: 'Bearer',
          expiresIn: 900,
        });
      if (url.pathname === '/api/auth/me') return send(user);
      if (url.pathname === '/api/genres') return send([]);
      if (url.pathname === '/api/admin/stories')
        return route.fulfill({
          headers,
          json: {
            success: true,
            data: [],
            pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
          },
        });
      if (url.pathname === '/api/admin/epub-imports/preview') {
        previews++;
        expect(request.headers()['content-type']).toContain('multipart/form-data');
        return send({
          previewId: id,
          expiresAt: '2026-10-20T15:00:00Z',
          title: 'Tiểu thuyết EPUB QA',
          authorName: 'Tác giả QA',
          chapterCount: 2,
          duplicate,
          warnings: ['Chỉ nhập bản nháp.'],
          sample: 'Đoạn đầu tiếng Việt.\n\nĐoạn thứ hai.',
          coverDataUrl: null,
          chapters: [
            { chapterNumber: 1, title: 'Chương một', characters: 100 },
            { chapterNumber: 2, title: 'Chương hai', characters: 200 },
          ],
        });
      }
      if (url.pathname === `/api/admin/epub-imports/${id}/confirm`) {
        imports++;
        const input = request.postDataJSON();
        expect(input).not.toHaveProperty('chapters');
        expect(input).not.toHaveProperty('publishStatus');
        return send({ id, chapterCount: 2 }, 201);
      }
      return route.abort();
    },
  );
  await page.goto('/login');
  await page.getByLabel('Địa chỉ email', { exact: true }).fill('admin@example.test');
  await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-password-123');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('link', { name: 'Stories', exact: true }).click();
  await page.getByRole('link', { name: 'Nhập EPUB', exact: true }).click();
  return { counts: () => ({ previews, imports }) };
}
test('ADMIN selects EPUB, reviews chapters then imports drafts once (API mocked, no real DB)', async ({
  page,
}) => {
  const f = await fixture(page);
  await page.getByLabel('File EPUB').setInputFiles({
    name: 'qa.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from('Synthetic fixture; parser tested separately'),
  });
  await page.getByRole('button', { name: 'Đọc và xem trước EPUB' }).click();
  await expect(page.getByRole('heading', { name: 'Xem trước · 2 chương' })).toBeVisible();
  expect(f.counts()).toEqual({ previews: 1, imports: 0 });
  await page.getByText('Danh sách 2 chương theo thứ tự EPUB').click();
  await expect(page.getByText('Chương hai')).toBeVisible();
  await page.getByText('Nội dung mẫu chương đầu').click();
  await expect(page.getByText('Đoạn đầu tiếng Việt.', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/epub-preview-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Nhập sách nháp và 2 chương' }).click();
  await expect(page.getByRole('link', { name: 'Mở sách vừa nhập' })).toHaveAttribute(
    'href',
    `/stories/${id}`,
  );
  expect(f.counts()).toEqual({ previews: 1, imports: 1 });
});
test('duplicate EPUB is blocked before confirm', async ({ page }) => {
  const f = await fixture(page, true);
  await page.getByLabel('File EPUB').setInputFiles({
    name: 'qa.epub',
    mimeType: 'application/epub+zip',
    buffer: Buffer.from('Synthetic duplicate'),
  });
  await page.getByRole('button', { name: 'Đọc và xem trước EPUB' }).click();
  await expect(page.getByRole('button', { name: 'Nhập sách nháp và 2 chương' })).toBeDisabled();
  expect(f.counts()).toEqual({ previews: 1, imports: 0 });
});
