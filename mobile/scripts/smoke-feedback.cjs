/* global __dirname */
/* Run against a web export built with EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:4199/api.
 * Every API request is mocked. Unknown network destinations are blocked before dispatch.
 */
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createRequire } = require('node:module');
const { chromium, expect } = createRequire(path.resolve(__dirname, '../../admin-web/package.json'))(
  '@playwright/test',
);
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist-web');
const stamp = '2026-10-18T00:00:00.000Z';
const sid = '20000000-0000-4000-8000-000000000001';
const rid = '50000000-0000-4000-8000-000000000001';
const cid = '60000000-0000-4000-8000-000000000001';
const user = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'qa_reader',
  email: 'reader@example.invalid',
  displayName: 'Bạn đọc kiểm thử',
  avatarUrl: null,
  role: 'USER',
  status: 'ACTIVE',
  createdAt: stamp,
  updatedAt: stamp,
};
const author = () => ({ username: user.username, displayName: user.displayName, avatarUrl: null });
const story = {
  id: sid,
  title: 'Những ngày xanh',
  slug: 'nhung-ngay-xanh',
  type: 'NOVEL',
  authorName: 'Tác giả kiểm thử',
  description: 'Một hành trình mới.',
  coverUrl: null,
  status: 'ONGOING',
  genres: [],
  createdAt: stamp,
  updatedAt: stamp,
};
let ratings = [
  {
    id: rid,
    storyId: sid,
    score: 4,
    reviewText: 'Cảm nhận ban đầu',
    createdAt: stamp,
    updatedAt: stamp,
    user: author(),
  },
];
let comments = [
  {
    id: cid,
    storyId: sid,
    parentId: null,
    content: 'Bình luận ban đầu',
    createdAt: stamp,
    updatedAt: stamp,
    user: author(),
  },
  {
    id: '60000000-0000-4000-8000-000000000002',
    storyId: sid,
    parentId: cid,
    content: 'Phản hồi từ bạn đọc khác',
    createdAt: stamp,
    updatedAt: stamp,
    user: { username: 'another_reader', displayName: 'Người đọc khác', avatarUrl: null },
  },
];
let serial = 10,
  denyNextComment = true,
  browser,
  server;
const requests = [],
  errors = [],
  unexpected = [];
let phase = 'export/startup';
const list = (data, url) => {
  const page = Number(url.searchParams.get('page') || 1),
    limit = Number(url.searchParams.get('limit') || 20);
  return {
    success: true,
    data: data.slice((page - 1) * limit, page * limit),
    pagination: { page, limit, total: data.length, totalPages: Math.ceil(data.length / limit) },
  };
};
const fields = (input, keys) => {
  expect(Object.keys(input).sort()).toEqual(keys.sort());
};
const nextStamp = () => `2026-10-18T00:00:${String(serial++).padStart(2, '0')}.000Z`;
async function run() {
  if (!fs.existsSync(path.join(dist, 'index.html')))
    throw new Error('Export web first; see FEEDBACK-PROFILE.md.');
  server = http.createServer((req, res) => {
    let file = path.resolve(
      dist,
      '.' + decodeURIComponent(new URL(req.url, 'http://localhost').pathname),
    );
    if (!file.startsWith(dist + path.sep) && file !== dist) {
      res.writeHead(403).end();
      return;
    }
    if (fs.existsSync(file) && fs.statSync(file).isDirectory())
      file = path.join(file, 'index.html');
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file)) file = path.join(dist, 'index.html');
    res.writeHead(200, {
      'Content-Type':
        {
          '.html': 'text/html',
          '.js': 'application/javascript',
          '.css': 'text/css',
          '.ttf': 'font/ttf',
          '.png': 'image/png',
        }[path.extname(file)] || 'application/octet-stream',
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 393, height: 852 } });
  await context.route('**/*', async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname,
      method = req.method();
    if (url.origin === origin) return route.continue();
    if (url.origin !== 'http://127.0.0.1:4199' || !p.startsWith('/api/')) {
      unexpected.push(method + ' ' + p);
      return route.abort();
    }
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    };
    if (method === 'OPTIONS') return route.fulfill({ status: 204, headers });
    const protectedRequest =
      p === '/api/auth/me' ||
      p.startsWith('/api/me/') ||
      (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method) && !p.startsWith('/api/auth/'));
    if (protectedRequest && req.headers().authorization !== 'Bearer synthetic.access.signature') {
      unexpected.push('Missing fixture authorization');
      return route.abort();
    }
    requests.push({ method, path: p });
    let status = 200,
      body;
    if (method === 'GET' && p === '/api/stories') body = list([story], url);
    else if (method === 'GET' && p === '/api/genres') body = { success: true, data: [] };
    else if (method === 'GET' && p === `/api/stories/${sid}`) body = { success: true, data: story };
    else if (method === 'GET' && p === `/api/stories/${sid}/chapters`) body = list([], url);
    else if (method === 'GET' && p === '/api/me/favorites') body = list([], url);
    else if (method === 'GET' && p === `/api/stories/${sid}/ratings`) {
      const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      ratings.forEach((r) => distribution[r.score]++);
      body = {
        ...list(ratings, url),
        summary: {
          averageScore: ratings.length
            ? ratings.reduce((n, r) => n + r.score, 0) / ratings.length
            : null,
          totalRatings: ratings.length,
          distribution,
        },
      };
    } else if (method === 'GET' && p === `/api/stories/${sid}/comments`) {
      body = list(
        comments
          .filter((r) => r.parentId === null)
          .map((r) => {
            const replies = comments.filter((c) => c.parentId === r.id);
            return {
              ...r,
              replies: replies.slice(0, 20),
              repliesPagination: {
                page: 1,
                limit: 20,
                total: replies.length,
                totalPages: Math.ceil(replies.length / 20),
              },
            };
          }),
        url,
      );
    } else if (method === 'PUT' && p === `/api/stories/${sid}/my-rating`) {
      const input = req.postDataJSON();
      fields(input, ['score', 'reviewText']);
      ratings = [
        {
          id: rid,
          storyId: sid,
          ...input,
          user: author(),
          createdAt: stamp,
          updatedAt: nextStamp(),
        },
      ];
      body = { success: true, data: ratings[0] };
    } else if (method === 'DELETE' && p === `/api/stories/${sid}/my-rating`) {
      ratings = [];
      body = { success: true, data: { removed: true } };
    } else if (method === 'POST' && p === `/api/stories/${sid}/comments`) {
      const input = req.postDataJSON();
      fields(input, input.parentId ? ['content', 'parentId'] : ['content']);
      if (denyNextComment) {
        denyNextComment = false;
        status = 429;
        body = { success: false, error: { code: 'RATE_LIMITED' } };
      } else {
        const row = {
          id: `60000000-0000-4000-8000-${String(serial++).padStart(12, '0')}`,
          storyId: sid,
          parentId: input.parentId ?? null,
          content: input.content,
          user: author(),
          createdAt: stamp,
          updatedAt: stamp,
        };
        comments.unshift(row);
        status = 201;
        body = { success: true, data: row };
      }
    } else if (method === 'PATCH' && p.startsWith('/api/comments/')) {
      const input = req.postDataJSON();
      fields(input, ['content']);
      const row = comments.find((r) => p === `/api/comments/${r.id}`);
      expect(row.user.username).toBe(user.username);
      row.content = input.content;
      row.updatedAt = nextStamp();
      body = { success: true, data: row };
    } else if (method === 'DELETE' && p.startsWith('/api/comments/')) {
      const row = comments.find((r) => p === `/api/comments/${r.id}`);
      expect(row.user.username).toBe(user.username);
      if (comments.some((r) => r.parentId === row.id)) {
        status = 409;
        body = { success: false, error: { code: 'COMMENT_HAS_REPLIES' } };
      } else {
        comments = comments.filter((r) => r.id !== row.id);
        body = { success: true, data: { removed: true } };
      }
    } else if (method === 'POST' && p === '/api/auth/login')
      body = {
        success: true,
        data: {
          user,
          accessToken: 'synthetic.access.signature',
          refreshToken: 'r'.repeat(64),
          tokenType: 'Bearer',
          expiresIn: 900,
        },
      };
    else if (method === 'GET' && p === '/api/auth/me') body = { success: true, data: user };
    else if (method === 'PATCH' && p === '/api/auth/me') {
      const input = req.postDataJSON();
      fields(input, ['displayName', 'avatarUrl']);
      Object.assign(user, input, { updatedAt: nextStamp() });
      body = { success: true, data: user };
    } else if (method === 'POST' && p === '/api/auth/logout') body = { success: true };
    else {
      unexpected.push(method + ' ' + p);
      return route.abort();
    }
    return route.fulfill({
      status,
      contentType: 'application/json',
      headers,
      body: JSON.stringify(body),
    });
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(origin);
  phase = 'guest/login/return';
  await page.getByRole('button', { name: 'Xem Những ngày xanh', exact: true }).first().click();
  await page.getByRole('link', { name: 'Đánh giá và bình luận', exact: true }).click();
  await expect(page.getByText('4.00 / 5', { exact: true }).last()).toBeVisible();
  await expect(page.getByText('Phản hồi từ bạn đọc khác', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Gửi bình luận', exact: true })).toHaveCount(0);
  expect(requests.filter((r) => r.path === '/api/auth/me')).toHaveLength(0);
  await page.getByRole('link', { name: 'Đăng nhập để đánh giá', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(user.email);
  await page
    .getByRole('textbox', { name: 'Mật khẩu', exact: true })
    .fill('Synthetic-only-password');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/feedback/${sid}$`));
  await expect(
    page.getByRole('textbox', { name: 'Nhận xét (không bắt buộc)', exact: true }),
  ).toHaveValue('Cảm nhận ban đầu');
  await page.getByRole('radio', { name: '5 sao', exact: true }).click();
  await page.getByRole('button', { name: 'Cập nhật đánh giá', exact: true }).click();
  await expect(page.getByText('5.00 / 5', { exact: true }).last()).toBeVisible();
  phase = 'rating/update/delete/create';
  for (const width of [320, 393, 600]) {
    await page.setViewportSize({ width, height: 852 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    const stars = await page.getByRole('radio').all();
    expect(stars).toHaveLength(5);
    const bounds = await Promise.all(stars.map((star) => star.boundingBox()));
    expect(new Set(bounds.map((box) => Math.round(box.y))).size).toBe(1);
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.getByRole('button', { name: 'Xóa đánh giá của tôi', exact: true }).click();
  await page.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hủy', exact: true })).toHaveCount(0);
  expect(
    requests.filter((r) => r.method === 'DELETE' && r.path.endsWith('/my-rating')),
  ).toHaveLength(0);
  await page.getByRole('button', { name: 'Xóa đánh giá của tôi', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Gửi đánh giá', exact: true })).toBeVisible();
  await page.getByRole('radio', { name: '3 sao', exact: true }).click();
  await page.getByRole('button', { name: 'Gửi đánh giá', exact: true }).click();
  await expect(page.getByText('3.00 / 5', { exact: true }).last()).toBeVisible();
  phase = 'comments/rate-limit/create';
  await page
    .getByRole('textbox', { name: 'Nội dung bình luận', exact: true })
    .fill('Bình luận mới\nDòng thứ hai');
  await page.getByRole('button', { name: 'Gửi bình luận', exact: true }).click();
  await expect(
    page.getByText('Bạn thao tác quá nhanh. Vui lòng đợi một lúc.', { exact: true }).last(),
  ).toBeVisible();
  expect(requests.filter((r) => r.method === 'POST' && r.path.endsWith('/comments'))).toHaveLength(
    1,
  );
  await page.getByRole('button', { name: 'Gửi bình luận', exact: true }).click();
  await expect(page.getByText('Bình luận mới\nDòng thứ hai', { exact: true }).last()).toBeVisible();
  const ownRoot = () => page.getByText('Bình luận ban đầu', { exact: true }).last().locator('..');
  phase = 'comments/edit/delete-conflict/reply';
  await ownRoot().getByRole('button', { name: 'Sửa bình luận', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Nội dung chỉnh sửa', exact: true })
    .fill('Bình luận đã sửa');
  await page.getByRole('button', { name: 'Lưu bình luận', exact: true }).click();
  const edited = () => page.getByText('Bình luận đã sửa', { exact: true }).last().locator('..');
  await edited().getByRole('button', { name: 'Xóa bình luận', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByText(/Bình luận có thể có phản hồi/).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Hủy', exact: true })).toHaveCount(0);
  await edited().getByRole('button', { name: 'Trả lời', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Nội dung phản hồi', exact: true })
    .fill('Phản hồi một cấp');
  await page.getByRole('button', { name: 'Gửi phản hồi', exact: true }).click();
  await expect(page.getByText('Phản hồi một cấp', { exact: true }).last()).toBeVisible();
  const otherReply = page
    .getByText('Phản hồi từ bạn đọc khác', { exact: true })
    .last()
    .locator('..');
  await expect(otherReply.getByRole('button')).toHaveCount(0);
  fs.mkdirSync(path.join(root, 'test-results'), { recursive: true });
  await page.screenshot({ path: path.join(root, 'test-results/step155-comments.png') });
  await page.getByRole('link', { name: '← Về truyện', exact: true }).click();
  await page.getByRole('link', { name: '← Khám phá', exact: true }).click();
  await page.getByRole('tab', { name: 'Profile', exact: true }).click();
  phase = 'profile/update/logout';
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Tên hiển thị', exact: true })).toHaveValue(
    'Bạn đọc kiểm thử',
  );
  await page
    .getByRole('textbox', { name: 'Tên hiển thị', exact: true })
    .fill('Bạn đọc đã cập nhật');
  await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
  await expect(page.getByText('Bạn đọc đã cập nhật', { exact: true }).last()).toBeVisible();
  for (const width of [320, 393, 600]) {
    await page.setViewportSize({ width, height: 852 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  }
  await page.setViewportSize({ width: 393, height: 852 });
  await page.screenshot({ path: path.join(root, 'test-results/step155-profile.png') });
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByText('Chào bạn đọc', { exact: true }).last()).toBeVisible();
  expect(errors).toEqual([]);
  expect(unexpected).toEqual([]);
  console.log(
    JSON.stringify({
      groups: 9,
      status: 'PASS',
      mockedRequests: requests.length,
      pageErrors: errors.length,
      unexpectedRequests: unexpected.length,
      realBackendRequests: 0,
    }),
  );
}
run()
  .catch(() => {
    console.error(`Feedback smoke failed in ${phase}; requests and credentials omitted.`);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (browser) await browser.close();
    if (server) await new Promise((resolve) => server.close(resolve));
  });
