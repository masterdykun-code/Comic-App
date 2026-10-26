/* global __dirname */
// Browser smoke test only. Every API request is mocked; no database/Cloudinary calls.
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const { chromium, expect } = createRequire(path.resolve(__dirname, '../../admin-web/package.json'))(
  '@playwright/test',
);
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const errors = [],
    warnings = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (e) => {
    if (
      e.type() === 'error' &&
      /Unexpected text node|must be rendered|Maximum update depth/.test(e.text())
    )
      warnings.push('RENDER_ERROR');
  });
  const sid = '20000000-0000-4000-8000-000000000001',
    cid = '30000000-0000-4000-8000-000000000001',
    bid = '40000000-0000-4000-8000-000000000001';
  const date = '2026-10-24T00:00:00Z';
  const user = {
    id: '10000000-0000-4000-8000-000000000001',
    username: 'qa_reader',
    email: 'qa@example.invalid',
    displayName: 'Bạn đọc kiểm thử',
    role: 'USER',
    status: 'ACTIVE',
    avatarUrl: null,
    createdAt: date,
    updatedAt: date,
  };
  const story = {
    id: sid,
    title: 'Những ngày xanh',
    slug: 'nhung-ngay-xanh',
    type: 'NOVEL',
    authorName: 'Tác giả kiểm thử',
    coverUrl: null,
  };
  const chapter = {
    id: cid,
    storyId: sid,
    chapterNumber: 3,
    title: 'Một đoạn chuyện đáng nhớ',
    updatedAt: date,
    createdAt: date,
  };
  const row = {
    id: bid,
    storyId: sid,
    chapterId: cid,
    textOffset: 0,
    pageNumber: null,
    available: true,
    createdAt: date,
    story,
    chapter: { id: cid, chapterNumber: 3, title: chapter.title },
  };
  let rows = [row],
    deleted = 0,
    adds = 0,
    progressWrites = 0,
    unknown = 0;
  await page.route('**/*', async (route) => {
    const r = route.request(),
      u = new URL(r.url()),
      p = u.pathname;
    if (!p.startsWith('/api/')) {
      if (u.origin === 'http://localhost:8084') return route.continue();
      unknown++;
      return route.abort();
    }
    const h = {
      'access-control-allow-origin': 'http://localhost:8084',
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    };
    const send = (data, status = 200) =>
      route.fulfill({ status, headers: h, json: { success: true, data } });
    if (r.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: h });
    if (p === '/api/auth/login' || p === '/api/auth/refresh')
      return send({
        user,
        accessToken: 'synthetic.access.signature',
        refreshToken: 'a'.repeat(64),
        tokenType: 'Bearer',
        expiresIn: 900,
      });
    if (p === '/api/auth/me') return send(user);
    if (p === '/api/me/bookmarks' && r.method() === 'GET')
      return route.fulfill({
        headers: h,
        json: {
          success: true,
          data: rows,
          pagination: { page: 1, limit: 20, total: rows.length, totalPages: rows.length ? 1 : 0 },
        },
      });
    if (p === '/api/me/bookmarks' && r.method() === 'POST') {
      adds++;
      return route.fulfill({ headers: h, json: { success: true, data: row, created: false } });
    }
    if (p === '/api/me/bookmarks/' + bid) {
      if (r.method() === 'DELETE') {
        deleted++;
        rows = [];
        return send({ removed: true });
      }
      return send({ ...row, positionAdjusted: false });
    }
    if (p === '/api/chapters/' + cid)
      return send({
        ...chapter,
        type: 'NOVEL',
        publishStatus: 'PUBLISHED',
        content:
          'Dòng đầu của câu chuyện.\n\nMột đoạn văn được đánh dấu để lần sau có thể tìm lại dễ dàng.',
      });
    if (p === '/api/stories/' + sid + '/chapters')
      return route.fulfill({
        headers: h,
        json: {
          success: true,
          data: [chapter],
          pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
        },
      });
    if (p === '/api/me/reading-progress/' + sid) {
      if (r.method() === 'PUT') progressWrites++;
      return route.fulfill({
        headers: h,
        json: {
          success: true,
          data: {
            storyId: sid,
            chapterId: cid,
            textOffset: 0,
            pageNumber: null,
            scrollOffset: null,
            progressPercent: 0,
          },
          version: date,
        },
      });
    }
    if (p === '/api/me/reading-history')
      return route.fulfill({ headers: h, json: { success: true, recorded: true } });
    unknown++;
    return route.abort();
  });
  const output = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  try {
    await page.goto('http://localhost:8084/login?next=%2Fbookmarks', { timeout: 120000 });
    await page.getByLabel('Email', { exact: true }).fill(user.email);
    await page.getByLabel('Mật khẩu', { exact: true }).fill('Synthetic-only-password');
    await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
    await page.getByText(story.title, { exact: true }).waitFor({ timeout: 120000 });
    await page.screenshot({ path: path.join(output, 'u08-bookmarks-list.png') });
    await page.getByRole('button', { name: 'Đọc dấu trang ' + chapter.title, exact: true }).click();
    await page.getByRole('button', { name: 'Đánh dấu chương', exact: true }).waitFor();
    await page.getByText(chapter.title, { exact: true }).waitFor();
    await page.screenshot({ path: path.join(output, 'u08-bookmark-reader.png') });
    await page.getByRole('button', { name: 'Đánh dấu chương', exact: true }).click();
    await expect(
      page.getByText('Chương này đã có dấu trang; vị trí cũ được giữ nguyên.', { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
    await page.getByRole('button', { name: 'Xóa dấu trang ' + chapter.title, exact: true }).click();
    await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
    await page.getByText('Chưa có dấu trang', { exact: true }).waitFor();
    if (
      errors.length ||
      warnings.length ||
      unknown ||
      progressWrites ||
      deleted !== 1 ||
      adds !== 1
    )
      throw Error('Unexpected request/render counters');
    console.log(
      JSON.stringify({
        result: 'PASS',
        viewport: '393x852',
        mockBookmarkPosts: adds,
        mockDeletes: deleted,
        progressWrites,
        unmockedRequests: unknown,
        pageErrors: errors.length,
        renderWarnings: warnings.length,
        nativeDeviceTested: false,
      }),
    );
  } catch (e) {
    await page.screenshot({ path: path.join(output, 'u08-browser-failure.png') });
    throw e;
  } finally {
    await browser.close();
  }
}
main().catch(() => {
  console.error('Bookmark browser smoke failed; inspect test-results.');
  process.exitCode = 1;
});
