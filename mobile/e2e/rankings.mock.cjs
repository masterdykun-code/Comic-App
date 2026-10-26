/* global __dirname */
// Mobile Web UI smoke, not an Android device test. All API traffic is intercepted.
const path = require('node:path'),
  fs = require('node:fs');
const { createRequire } = require('node:module');
const { chromium, expect } = createRequire(path.resolve(__dirname, '../../admin-web/package.json'))(
  '@playwright/test',
);
async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 393, height: 852 } });
  const base = 'http://localhost:8086',
    output = path.resolve(__dirname, '../test-results');
  fs.mkdirSync(output, { recursive: true });
  const passed = [],
    errors = [];
  let unexpected = 0,
    writes = 0,
    empty = false,
    failOnce = false;
  const stories = [
    {
      id: '20000000-0000-4000-8000-000000000001',
      title: 'Những ngày xanh',
      authorName: 'Tác giả kiểm thử A',
      type: 'NOVEL',
      coverUrl: null,
      updatedAt: '2026-10-23T00:00:00Z',
      readCount: 30,
      averageScore: 4.5,
      ratingCount: 2,
    },
    {
      id: '20000000-0000-4000-8000-000000000002',
      title: 'Trang tranh đầu tiên',
      authorName: 'Tác giả kiểm thử B',
      type: 'COMIC',
      coverUrl: null,
      updatedAt: '2026-10-24T00:00:00Z',
      readCount: 20,
      averageScore: 4.9,
      ratingCount: 3,
    },
  ];
  page.on('pageerror', () => errors.push('PAGE_ERROR'));
  await page.route('**/*', async (route) => {
    const request = route.request(),
      url = new URL(request.url()),
      p = url.pathname;
    if (!p.startsWith('/api/')) {
      if (url.origin === base) return route.continue();
      unexpected++;
      return route.abort();
    }
    const headers = {
      'access-control-allow-origin': base,
      'access-control-allow-headers': 'content-type,authorization',
      'access-control-allow-methods': 'GET,OPTIONS',
    };
    if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (request.method() !== 'GET') {
      writes++;
      return route.abort();
    }
    const send = (data) => route.fulfill({ headers, json: { success: true, data } });
    if (p === '/api/stories/rankings') {
      if (failOnce) {
        failOnce = false;
        return route.fulfill({
          headers,
          status: 503,
          json: { success: false, error: { code: 'UNAVAILABLE' } },
        });
      }
      const kind = url.searchParams.get('kind') || 'reads',
        type = url.searchParams.get('type'),
        page = Number(url.searchParams.get('page') || 1),
        limit = 20;
      let rows = empty ? [] : stories.filter((s) => !type || s.type === type);
      rows = [...rows].sort((a, b) =>
        kind === 'reads'
          ? b.readCount - a.readCount
          : kind === 'rating'
            ? b.averageScore - a.averageScore
            : Date.parse(b.updatedAt) - Date.parse(a.updatedAt),
      );
      const total = rows.length;
      rows = rows.map((s, i) => ({ ...s, rank: i + 1 })).slice((page - 1) * limit, page * limit);
      return route.fulfill({
        headers,
        json: {
          success: true,
          data: rows,
          pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
          ranking: { kind, readMetric: 'STORED_AUTHENTICATED_HISTORY' },
        },
      });
    }
    if (p === '/api/stories' || /^\/api\/stories\/[^/]+\/chapters$/.test(p))
      return route.fulfill({
        headers,
        json: {
          success: true,
          data: [],
          pagination: {
            page: 1,
            limit: Number(url.searchParams.get('limit') || 20),
            total: 0,
            totalPages: 0,
          },
        },
      });
    if (p === '/api/genres') return send([]);
    const story = stories.find((s) => p === `/api/stories/${s.id}`);
    if (story)
      return send({
        ...story,
        slug: story.id,
        description: 'Nội dung mô tả kiểm thử giao diện.',
        status: 'ONGOING',
        genres: [],
        createdAt: story.updatedAt,
      });
    unexpected++;
    return route.abort();
  });
  try {
    await page.goto(base, { timeout: 120000 });
    await page.getByLabel('Bảng xếp hạng truyện', { exact: true }).click();
    await expect(page).toHaveURL(/\/rankings$/);
    passed.push('Home shortcut');
    const first = page.getByRole('button', { name: `Hạng 1: ${stories[0].title}`, exact: true });
    await expect(first).toBeVisible();
    await expect(page.getByText('30 lượt đọc ghi nhận', { exact: true })).toBeVisible();
    passed.push('Read ranking');
    await page.screenshot({ path: path.join(output, 'u01-rankings-overview.png') });
    await first.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(output, 'u01-rankings-reads.png') });
    await page.getByLabel('Bảng xếp hạng: Top đánh giá', { exact: true }).click();
    await expect(
      page.getByRole('button', { name: `Hạng 1: ${stories[1].title}`, exact: true }),
    ).toBeVisible();
    await expect(page.getByText('4,9/5 · 3 đánh giá', { exact: true })).toBeVisible();
    passed.push('Rating ranking');
    await page.getByLabel('Loại truyện: Tiểu thuyết', { exact: true }).click();
    await expect(page.getByText(stories[0].title, { exact: true })).toBeVisible();
    await expect(page.getByText(stories[1].title, { exact: true })).toHaveCount(0);
    await page.getByLabel('Loại truyện: Truyện tranh', { exact: true }).click();
    await expect(page.getByText(stories[1].title, { exact: true })).toBeVisible();
    passed.push('NOVEL and COMIC filters');
    await page.getByLabel('Bảng xếp hạng: Mới cập nhật', { exact: true }).click();
    await expect(page.getByText(/Cập nhật.*24\/10/)).toBeVisible();
    passed.push('Updated ranking');
    empty = true;
    await page.getByLabel('Bảng xếp hạng: Top lượt đọc', { exact: true }).click();
    await expect(page.getByText('Chưa có truyện trong bảng này', { exact: true })).toBeVisible();
    empty = false;
    failOnce = true;
    await page.getByLabel('Bảng xếp hạng: Top đánh giá', { exact: true }).click();
    await expect(page.getByRole('button', { name: 'Thử lại', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Thử lại', exact: true }).click();
    await expect(page.getByText(stories[1].title, { exact: true })).toBeVisible();
    passed.push('Empty and retry');
    if (!(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)))
      throw Error('Horizontal overflow');
    passed.push('393px layout');
    await page.getByRole('button', { name: `Hạng 1: ${stories[1].title}`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/story/${stories[1].id}$`));
    await expect(
      page.getByText('Nội dung mô tả kiểm thử giao diện.', { exact: true }),
    ).toBeVisible();
    passed.push('Story detail navigation');
    if (errors.length || unexpected || writes) throw Error('Unexpected request/render activity');
    console.log(
      JSON.stringify({
        result: 'PASS',
        checks: passed,
        unmockedRequests: unexpected,
        writes,
        pageErrors: errors.length,
        nativeDeviceTested: false,
      }),
    );
  } catch (error) {
    await page.screenshot({ path: path.join(output, 'u01-rankings-failure.png') });
    console.error(error instanceof Error ? error.message.split('\n')[0] : 'UI failure');
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}
main().catch(() => {
  console.error('Ranking browser smoke failed; private details suppressed.');
  process.exitCode = 1;
});
