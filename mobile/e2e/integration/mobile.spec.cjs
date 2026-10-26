/* global __dirname */
const path = require('node:path');
const { createRequire } = require('node:module');
const { test, expect } = createRequire(path.resolve(__dirname, '../../../admin-web/package.json'))(
  '@playwright/test',
);
const f = JSON.parse(process.env.MOBILE_E2E_FIXTURES);
const password = process.env.MOBILE_E2E_PASSWORD;
const apiBase = process.env.MOBILE_E2E_API;
const webBase = process.env.MOBILE_E2E_WEB;
let failures, writes;
test.beforeEach(async ({ context, page }) => {
  failures = [];
  writes = [];
  page.on('pageerror', (error) =>
    failures.push(
      /identifier|touch|pageX|changedTouches/i.test(error.message)
        ? 'TOUCH_EVENT'
        : /width|height/.test(error.message)
          ? 'LAYOUT_EXCEPTION'
          : 'BROWSER_EXCEPTION',
    ),
  );
  page.on('response', (response) => {
    if (
      response.url().startsWith(apiBase + '/me/reading-progress/') &&
      response.request().method() === 'PUT'
    )
      writes.push(response.status());
  });
  await context.route('**/*', (route) => {
    const origin = new URL(route.request().url()).origin;
    if ([new URL(apiBase).origin, webBase].includes(origin)) return route.continue();
    failures.push('external network blocked');
    return route.abort();
  });
});
test.afterEach(({ page }, info) => {
  if (info.status !== info.expectedStatus || failures.length)
    info.annotations.push({
      type: 'safe-diagnostic',
      description: JSON.stringify({
        errorKinds: failures,
        progressWriteStatuses: writes,
        pageClosed: page.isClosed(),
      }),
    });
  expect(failures).toEqual([]);
});
async function call(request, route, token, method = 'GET', data) {
  if (!route.startsWith('/') || route.startsWith('//')) throw new Error('API destination refused');
  const response = await request.fetch(apiBase + route, {
    method,
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    ...(data === undefined ? {} : { data }),
  });
  return { status: response.status(), body: await response.json() };
}
async function login(page, email = f.user.email, next = '/profile') {
  await page.goto(`/login?next=${encodeURIComponent(next)}`);
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  const response = page.waitForResponse(
    (r) => r.url() === apiBase + '/auth/login' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const result = await response;
  expect(result.status()).toBe(200);
  const session = (await result.json()).data;
  await expect(page).toHaveURL(new RegExp(next.replace(/[?]/g, '\\?') + '$'));
  return session;
}
async function tab(page, name) {
  await page.getByRole('tab', { name, exact: true }).click();
}
async function openStory(page, story) {
  await tab(page, 'Home');
  await page
    .getByRole('button', { name: `Xem ${story.title}`, exact: true })
    .first()
    .click();
  await expect(page).toHaveURL(new RegExp(`/story/${story.id}$`));
}
async function confirm(page) {
  await page.getByRole('button', { name: 'Xác nhận', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hủy', exact: true })).toHaveCount(0);
}
async function backToTabs(page) {
  if (page.url().includes('/reader/'))
    await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
  if (page.url().includes('/feedback/'))
    await page.getByRole('link', { name: '← Về truyện', exact: true }).click();
  if (page.url().includes('/story/'))
    await page.getByRole('link', { name: '← Khám phá', exact: true }).click();
}
async function progress(request, token, storyId) {
  const result = await call(request, `/me/reading-progress/${storyId}`, token);
  expect(result.status).toBe(200);
  return result.body;
}

test('UI E2E: Guest catalog, search/filter/pagination and published boundaries', async ({
  page,
  request,
}) => {
  await page.goto('/');
  await expect(
    page.getByRole('button', { name: `Xem ${f.novel.title}`, exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: `Xem ${f.comic.title}`, exact: true }).first(),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: `Xem ${f.draft.title}`, exact: true })).toHaveCount(
    0,
  );
  await tab(page, 'Explore');
  const load = page.waitForResponse(
    (r) => r.url().includes('/api/stories?') && new URL(r.url()).searchParams.get('page') === '2',
  );
  await page.getByRole('button', { name: 'Tải thêm truyện', exact: true }).click();
  expect((await load).status()).toBe(200);
  await expect(page.getByRole('button', { name: `Xem ${f.draft.title}`, exact: true })).toHaveCount(
    0,
  );
  await page.getByRole('button', { name: `Thể loại: ${f.genre.name}`, exact: true }).click();
  await expect(page.getByRole('button', { name: `Xem ${f.novel.title}`, exact: true })).toHaveCount(
    1,
  );
  await expect(page.getByRole('button', { name: /Catalog/ })).toHaveCount(0);
  await page.getByRole('link', { name: 'Tìm kiếm truyện', exact: true }).click();
  await page.getByRole('textbox', { name: 'Tìm truyện theo tên', exact: true }).fill(f.novel.title);
  await page.getByRole('button', { name: `Xem ${f.novel.title}`, exact: true }).click();
  await expect(page.getByText('2 chương đã xuất bản', { exact: true }).last()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Chương 9 · NOVEL chapter 9', exact: true }),
  ).toHaveCount(0);
  const chapters = await call(request, `/stories/${f.novel.id}/chapters`);
  expect(chapters.body.data.map((r) => r.chapterNumber)).toEqual([1, 3]);
  expect((await call(request, `/stories/${f.draft.id}`)).status).toBe(404);
  expect((await call(request, `/chapters/${f.novelChapters[2].id}`)).status).toBe(404);
});

test('UI E2E: register USER, real login/me, logout, protected routes and account cache separation', async ({
  page,
  request,
}) => {
  await page.goto('/history');
  await expect(page).toHaveURL(/\/login\?/);
  await page.goto('/register');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(f.prefix + 'new');
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill(f.prefix + 'new@example.invalid');
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  await page.getByRole('textbox', { name: 'Xác nhận mật khẩu', exact: true }).fill(password);
  const registration = page.waitForResponse((r) => r.url() === apiBase + '/auth/register');
  await page.getByRole('button', { name: 'Đăng ký', exact: true }).click();
  const registered = await registration;
  expect(registered.status()).toBe(201);
  expect((await registered.json()).data.role).toBe('USER');
  await expect(page).toHaveURL(/\/login/);
  // Continue from the UI after registration; no replacement API or injected tokens.
  await page
    .getByRole('textbox', { name: 'Email', exact: true })
    .fill(f.prefix + 'new@example.invalid');
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  const logged = page.waitForResponse((r) => r.url() === apiBase + '/auth/login');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const session = (await (await logged).json()).data;
  await expect(page).toHaveURL(/\/library$/);
  expect((await call(request, '/auth/me', session.accessToken)).body.data.username).toBe(
    f.prefix + 'new',
  );
  await openStory(page, f.novel);
  await page.getByRole('button', { name: 'Lưu vào giá sách', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bỏ khỏi giá sách', exact: true })).toBeVisible();
  await backToTabs(page);
  await tab(page, 'Library');
  await expect(
    page.getByRole('button', { name: `Xem ${f.novel.title}`, exact: true }),
  ).toBeVisible();
  await tab(page, 'Profile');
  const logoutResponse = page.waitForResponse((r) => r.url() === apiBase + '/auth/logout');
  await page.getByRole('button', { name: 'Đăng xuất', exact: true }).click();
  await confirm(page);
  expect((await logoutResponse).status()).toBe(200);
  expect((await call(request, '/auth/me', session.accessToken)).status).toBe(401);
  await page.getByRole('link', { name: 'Đăng nhập', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(f.user.email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  await expect(page).toHaveURL(/\/profile$/);
  await tab(page, 'Library');
  await expect(page.getByText('Giá sách chưa có truyện', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: `Xem ${f.novel.title}`, exact: true })).toHaveCount(
    0,
  );
});

test('UI E2E: NOVEL multiline, chapter navigation, Favorites/History and textOffset restore/conflict', async ({
  page,
  request,
}) => {
  const session = await login(page);
  await openStory(page, f.novel);
  await page.getByRole('button', { name: 'Lưu vào giá sách', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Bỏ khỏi giá sách', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Bắt đầu đọc', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/reader/${f.novelChapters[0].id}`));
  const firstBlock = page.getByTestId('novel-block-0').last();
  await expect(firstBlock).toContainText('Dòng mở đầu.');
  expect(await firstBlock.textContent()).toContain(
    'Dòng mở đầu.\nDòng thứ hai được giữ nguyên.\n\n',
  );
  await page.getByRole('button', { name: 'Chương sau', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/reader/${f.novelChapters[1].id}`));
  await page.getByRole('button', { name: 'Chương trước', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/reader/${f.novelChapters[0].id}`));
  const scroll = page.getByTestId('novel-scroll').last();
  await expect(scroll).toBeVisible();
  const novelBox = await scroll.boundingBox();
  await page.touchscreen.tap(novelBox.x + novelBox.width / 2, novelBox.y + novelBox.height / 2);
  await scroll.hover();
  await page.mouse.wheel(0, 2600);
  await expect.poll(() => scroll.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(
      async () => (await progress(request, session.accessToken, f.novel.id)).data?.textOffset ?? 0,
      { timeout: 15000 },
    )
    .toBeGreaterThan(0);
  const saved = await progress(request, session.accessToken, f.novel.id);
  expect(saved.data.chapterId).toBe(f.novelChapters[0].id);
  await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
  await backToTabs(page);
  await tab(page, 'Library');
  await page.getByRole('button', { name: 'Giá sách: Đang đọc', exact: true }).click();
  await page.getByRole('button', { name: 'Tiếp tục đọc', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/reader/${f.novelChapters[0].id}`));
  await expect
    .poll(() =>
      page
        .getByTestId('novel-scroll')
        .last()
        .evaluate((el) => el.scrollTop),
    )
    .toBeGreaterThan(0);
  const baseline = await progress(request, session.accessToken, f.novel.id);
  const control = await call(
    request,
    `/me/reading-progress/${f.novel.id}`,
    session.accessToken,
    'PUT',
    {
      chapterId: f.novelChapters[0].id,
      textOffset: 6400,
      pageNumber: null,
      scrollOffset: null,
      progressPercent: 40,
      expectedUpdatedAt: baseline.version,
    },
  );
  expect(control.status).toBe(200);
  const conflict = page.waitForResponse(
    (r) =>
      r.url() === apiBase + `/me/reading-progress/${f.novel.id}` &&
      r.request().method() === 'PUT' &&
      r.status() === 409,
    { timeout: 15000 },
  );
  const resumedBox = await page.getByTestId('novel-scroll').last().boundingBox();
  await page.touchscreen.tap(
    resumedBox.x + resumedBox.width / 2,
    resumedBox.y + resumedBox.height / 2,
  );
  await page.getByTestId('novel-scroll').last().hover();
  await page.mouse.wheel(0, 1300);
  await conflict;
  await expect(page.getByRole('alert').filter({ hasText: 'Đã ngừng tự lưu' })).toBeVisible();
  await page.mouse.wheel(0, 900);
  await page.waitForTimeout(1700);
  expect((await progress(request, session.accessToken, f.novel.id)).data.textOffset).toBe(6400);
  await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
  await backToTabs(page);
  await tab(page, 'Profile');
  await page.getByRole('link', { name: 'Lịch sử đọc', exact: true }).click();
  await expect(page.getByRole('button', { name: /^Đọc lại chương / }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Xóa lịch sử đọc', exact: true }).click();
  await page.getByRole('button', { name: 'Hủy', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Hủy', exact: true })).toHaveCount(0);
  expect(
    (await call(request, '/me/reading-history', session.accessToken)).body.pagination.total,
  ).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Xóa lịch sử đọc', exact: true }).click();
  const historyDeleted = page.waitForResponse(
    (r) => r.url() === apiBase + '/me/reading-history' && r.request().method() === 'DELETE',
  );
  await confirm(page);
  expect((await historyDeleted).status()).toBe(200);
  expect(
    (await call(request, '/me/reading-history', session.accessToken)).body.pagination.total,
  ).toBe(0);
  expect((await progress(request, session.accessToken, f.novel.id)).data.textOffset).toBe(6400);
  expect(
    (await call(request, '/me/favorites', session.accessToken)).body.data.some(
      (r) => r.storyId === f.novel.id,
    ),
  ).toBe(true);
  await page.getByRole('link', { name: '← Hồ sơ', exact: true }).click();
  await page.getByRole('link', { name: 'Mở giá sách', exact: true }).click();
  await page
    .getByRole('button', { name: `Bỏ ${f.novel.title} khỏi giá sách`, exact: true })
    .click();
  const favoriteDeleted = page.waitForResponse(
    (r) => r.url() === apiBase + `/me/favorites/${f.novel.id}` && r.request().method() === 'DELETE',
  );
  await confirm(page);
  expect((await favoriteDeleted).status()).toBe(200);
  expect((await call(request, '/me/favorites', session.accessToken)).body.pagination.total).toBe(0);
});

test('UI E2E: COMIC real fixture images, page order/save/restore, chapter navigation and failed image', async ({
  page,
  request,
}) => {
  const session = await login(page);
  await openStory(page, f.comic);
  await page.getByRole('button', { name: 'Bắt đầu đọc', exact: true }).click();
  await expect(page.getByRole('img', { name: 'Trang 1', exact: true })).toBeVisible();
  const list = page.getByTestId('comic-list').last();
  const box = await list.boundingBox();
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
  await list.hover();
  await page.mouse.wheel(0, 1300);
  await expect(page.getByText('Trang 3 · 3 trang ảnh', { exact: true }).last()).toBeVisible();
  await expect
    .poll(async () => (await progress(request, session.accessToken, f.comic.id)).data?.pageNumber, {
      timeout: 15000,
    })
    .toBe(3);
  await page.getByRole('button', { name: 'Quay lại', exact: true }).click();
  await page.getByRole('button', { name: 'Bắt đầu đọc', exact: true }).click();
  await expect(page.getByText('Trang 3 · 3 trang ảnh', { exact: true }).last()).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Tải các trang trước', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('comic-page-1')).toHaveCount(0);
  const restoredBox = await page.getByTestId('comic-list').last().boundingBox();
  await page.touchscreen.tap(
    restoredBox.x + restoredBox.width / 2,
    restoredBox.y + restoredBox.height / 2,
  );
  await page.getByTestId('comic-list').last().hover();
  await page.mouse.wheel(0, 1600);
  await expect(page.getByText('Không tải được trang 7.', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Chương sau', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/reader/${f.comicChapters[1].id}`));
  await page.getByRole('button', { name: 'Chương trước', exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/reader/${f.comicChapters[0].id}`));
  const published = await call(request, `/chapters/${f.comicChapters[0].id}`);
  expect(published.body.data.pages.map((r) => r.pageNumber)).toEqual([1, 3, 7]);
});

test('UI E2E: real Ratings/Comments/Replies, HIDDEN exclusion, ownership/409 and Profile update', async ({
  page,
  request,
}) => {
  await page.goto(`/feedback/${f.novel.id}`);
  await expect(
    page.getByRole('link', { name: 'Đăng nhập để đánh giá', exact: true }),
  ).toBeVisible();
  await expect(page.getByText('HIDDEN_MOBILE_FIXTURE', { exact: true })).toHaveCount(0);
  await page.getByRole('link', { name: 'Đăng nhập để đánh giá', exact: true }).click();
  await page.getByRole('textbox', { name: 'Email', exact: true }).fill(f.user.email);
  await page.getByRole('textbox', { name: 'Mật khẩu', exact: true }).fill(password);
  const loginResponse = page.waitForResponse((r) => r.url() === apiBase + '/auth/login');
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  const session = (await (await loginResponse).json()).data;
  await page.getByRole('radio', { name: '4 sao', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Nhận xét (không bắt buộc)', exact: true })
    .fill('Đánh giá tích hợp');
  await page.getByRole('button', { name: 'Gửi đánh giá', exact: true }).click();
  await expect(page.getByText('4.00 / 5', { exact: true }).last()).toBeVisible();
  await page.getByRole('radio', { name: '5 sao', exact: true }).click();
  await page.getByRole('button', { name: 'Cập nhật đánh giá', exact: true }).click();
  await expect(page.getByText('5.00 / 5', { exact: true }).last()).toBeVisible();
  await page.getByRole('button', { name: 'Xóa đánh giá của tôi', exact: true }).click();
  await confirm(page);
  await expect(page.getByText('Chưa có điểm', { exact: true }).last()).toBeVisible();
  await page
    .getByRole('textbox', { name: 'Nội dung bình luận', exact: true })
    .fill('Bình luận tích hợp');
  await page.getByRole('button', { name: 'Gửi bình luận', exact: true }).click();
  const card = () => page.getByText('Bình luận tích hợp', { exact: true }).last().locator('..');
  await card().getByRole('button', { name: 'Trả lời', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Nội dung phản hồi', exact: true })
    .fill('Phản hồi một cấp thật');
  await page.getByRole('button', { name: 'Gửi phản hồi', exact: true }).click();
  await expect(page.getByText('Phản hồi một cấp thật', { exact: true }).last()).toBeVisible();
  await expect(
    page
      .getByText('Phản hồi một cấp thật', { exact: true })
      .last()
      .locator('..')
      .getByRole('button', { name: 'Trả lời', exact: true }),
  ).toHaveCount(0);
  await card().getByRole('button', { name: 'Sửa bình luận', exact: true }).click();
  await page
    .getByRole('textbox', { name: 'Nội dung chỉnh sửa', exact: true })
    .fill('Bình luận tích hợp đã sửa');
  await page.getByRole('button', { name: 'Lưu bình luận', exact: true }).click();
  const edited = () =>
    page.getByText('Bình luận tích hợp đã sửa', { exact: true }).last().locator('..');
  const conflict = page.waitForResponse(
    (r) => r.url().includes('/api/comments/') && r.request().method() === 'DELETE',
  );
  await edited().getByRole('button', { name: 'Xóa bình luận', exact: true }).click();
  await confirm(page);
  expect((await conflict).status()).toBe(409);
  await expect(page.getByText(/Bình luận có thể có phản hồi/).last()).toBeVisible();
  const publicComments = await call(request, `/stories/${f.novel.id}/comments`);
  expect(JSON.stringify(publicComments.body)).not.toContain('HIDDEN_MOBILE_FIXTURE');
  await backToTabs(page);
  await tab(page, 'Profile');
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Tên hiển thị', exact: true })).toHaveValue(
    'E2E Reader',
  );
  await page
    .getByRole('textbox', { name: 'Tên hiển thị', exact: true })
    .fill('Mobile updated reader');
  await page
    .getByRole('textbox', { name: 'URL ảnh đại diện', exact: true })
    .fill('http://127.0.0.1:4186/__fixtures__/avatar.png');
  const patch = page.waitForResponse(
    (r) => r.url() === apiBase + '/auth/me' && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Lưu hồ sơ', exact: true }).click();
  expect(Object.keys((await patch).request().postDataJSON()).sort()).toEqual([
    'avatarUrl',
    'displayName',
  ]);
  await expect(page.getByText('Mobile updated reader', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('img', { name: 'Ảnh đại diện', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Tên hiển thị', exact: true })).toHaveValue(
    'Mobile updated reader',
  );
  expect((await call(request, '/auth/me', session.accessToken)).body.data.role).toBe('USER');
});

test('UI E2E plus API integration: real refresh rotation, reuse revocation, expired session and USER authorization', async ({
  page,
  request,
}) => {
  await page.clock.install({ time: new Date() });
  const session = await login(page);
  expect((await call(request, '/admin/stories', session.accessToken)).status).toBe(403);
  expect((await call(request, '/admin/stories')).status).toBe(401);
  expect(
    (await call(request, '/auth/me', session.accessToken, 'PATCH', { role: 'ADMIN' })).status,
  ).toBe(400);
  expect(
    (await call(request, '/auth/me', session.accessToken, 'PATCH', { status: 'BANNED' })).status,
  ).toBe(400);
  // Advance browser time only: exercise the existing client refresh threshold against the real API.
  await page.clock.fastForward(880000);
  const rotated = page.waitForResponse(
    (r) => r.url() === apiBase + '/auth/refresh' && r.status() === 200,
  );
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
  const replacement = (await (await rotated).json()).data;
  expect(replacement.refreshToken === session.refreshToken).toBe(false);
  await expect(page.getByRole('textbox', { name: 'Tên hiển thị', exact: true })).toBeVisible();
  expect(
    (
      await call(request, '/auth/refresh', undefined, 'POST', {
        refreshToken: session.refreshToken,
      })
    ).status,
  ).toBe(401);
  expect((await call(request, '/auth/me', replacement.accessToken)).status).toBe(401);
  await page.getByRole('button', { name: 'Hủy sửa hồ sơ', exact: true }).click();
  await page.getByRole('button', { name: 'Chỉnh sửa hồ sơ', exact: true }).click();
  await expect(page.getByText('Chào bạn đọc', { exact: true }).last()).toBeVisible();
  await expect(page.getByRole('button', { name: 'Lưu hồ sơ', exact: true })).toHaveCount(0);
});

test('API integration: fixture ADMIN authorization, expired JWT, concurrent refresh and logout revocation', async ({
  request,
}) => {
  const adminLogin = await call(request, '/auth/login', undefined, 'POST', {
    email: f.admin.email,
    password,
  });
  expect(adminLogin.status).toBe(200);
  const admin = adminLogin.body.data;
  expect((await call(request, '/admin/stories', admin.accessToken)).status).toBe(200);
  const readerLogin = await call(request, '/auth/login', undefined, 'POST', {
    email: f.user.email,
    password,
  });
  expect(readerLogin.status).toBe(200);
  const reader = readerLogin.body.data;
  const me = await call(request, '/auth/me', reader.accessToken);
  expect(me.status).toBe(200);
  expect(Object.hasOwn(me.body.data, 'passwordHash')).toBe(false);
  const jwt = createRequire(path.resolve(__dirname, '../../../backend/package.json'))(
    'jsonwebtoken',
  );
  const claims = jwt.decode(reader.accessToken);
  const expired = jwt.sign({ sid: claims.sid, tokenUse: 'access' }, process.env.JWT_SECRET, {
    algorithm: 'HS256',
    subject: claims.sub,
    issuer: claims.iss,
    audience: claims.aud,
    expiresIn: -1,
  });
  expect((await call(request, '/auth/me', expired)).status).toBe(401);
  const concurrent = await Promise.all(
    [1, 2].map(() =>
      call(request, '/auth/refresh', undefined, 'POST', { refreshToken: reader.refreshToken }),
    ),
  );
  expect(concurrent.map((r) => r.status).sort()).toEqual([200, 401]);
  const winner = concurrent.find((r) => r.status === 200).body.data;
  expect((await call(request, '/auth/me', winner.accessToken)).status).toBe(401);
  expect(
    (await call(request, '/auth/logout', undefined, 'POST', { refreshToken: admin.refreshToken }))
      .status,
  ).toBe(200);
  expect((await call(request, '/auth/me', admin.accessToken)).status).toBe(401);
});
