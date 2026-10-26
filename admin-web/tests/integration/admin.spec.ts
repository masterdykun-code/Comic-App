/// <reference types="node" />
import { Buffer } from 'node:buffer';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const apiUrl = process.env.E2E_API_URL!;
const prefix = `e2e_${process.env.E2E_RUN_ID}_`;
const password = process.env.E2E_PASSWORD!;
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64',
);
const text = 'Dòng đầu tiên của tiểu thuyết.\n\nDòng cuối giữ đúng xuống dòng và dấu tiếng Việt.';
let adminToken = '';
let userToken = '';
let novel = '';
let comic = '';
let novelChapter = '';
let novelSlug = '';
let genreName = '';

async function api(
  request: APIRequestContext,
  path: string,
  method = 'GET',
  data?: unknown,
  actor: 'admin' | 'user' | 'guest' = 'admin',
) {
  if (!path.startsWith('/') || path.startsWith('//'))
    throw new Error('Relative E2E API path required');
  return request.fetch(apiUrl + path, {
    method,
    headers:
      actor === 'guest'
        ? {}
        : { Authorization: `Bearer ${actor === 'admin' ? adminToken : userToken}` },
    ...(data === undefined ? {} : { data }),
  });
}
async function login(page: Page, actor = 'admin') {
  await page.goto('/login');
  await page
    .getByLabel('Địa chỉ email', { exact: true })
    .fill(actor === 'admin' ? process.env.E2E_ADMIN_EMAIL! : process.env.E2E_USER_EMAIL!);
  await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click();
  if (actor === 'admin') await expect(page).toHaveURL(/\/dashboard$/);
}
async function visit(page: Page, path: string) {
  // Keep memory-only auth; navigation remains inside the real React router.
  await page.evaluate((target) => {
    history.pushState(null, '', target);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}
async function createGenre(page: Page, name: string) {
  await visit(page, '/genres');
  await page.getByRole('button', { name: 'Thêm thể loại', exact: true }).click();
  await page.getByLabel('Tên thể loại', { exact: true }).fill(name);
  await page.getByRole('button', { name: 'Tạo slug từ tên' }).click();
  await page.getByRole('button', { name: 'Tạo thể loại', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận tạo thể loại' }).click();
  await expect(page.getByText(name, { exact: true })).toBeVisible();
}
async function createStory(page: Page, type: 'NOVEL' | 'COMIC') {
  await visit(page, '/stories/new');
  await page.getByLabel('Tên truyện').fill(prefix + type);
  await page.getByLabel('Tác giả').fill('E2E author');
  await page.getByLabel('Loại truyện').selectOption(type);
  await page.getByLabel('Mô tả').fill('Nội dung kiểm thử được tạo riêng trong test database.');
  await page.getByRole('checkbox', { name: genreName }).check();
  if (type === 'NOVEL') {
    await page
      .getByLabel('Chọn ảnh bìa')
      .setInputFiles({ name: 'generated-cover.png', mimeType: 'image/png', buffer: png });
    await page.getByRole('button', { name: 'Xác nhận tải ảnh lên' }).click();
    await page.getByRole('button', { name: 'Tải lên Cloudinary', exact: true }).click();
    await expect(page.getByLabel('URL ảnh bìa')).toHaveValue(/^https:\/\/e2e-images\.invalid\//);
  } else await page.getByLabel('URL ảnh bìa').fill('https://e2e-images.invalid/comic-cover.png');
  const response = page.waitForResponse(
    (r) => r.url() === apiUrl + '/stories' && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Lưu bản nháp' }).click();
  const saved = await response;
  expect(saved.status()).toBe(201);
  const row = (await saved.json()).data;
  expect(row.publishStatus).toBe('DRAFT');
  await expect(page.getByRole('heading', { name: prefix + type, exact: true })).toBeVisible();
  return row;
}
async function publishStory(page: Page, id: string) {
  await visit(page, `/stories/${id}`);
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận xuất bản', exact: true }).click();
  await expect(page.getByText('Đã xuất bản', { exact: true })).toBeVisible();
}
async function publishChapter(page: Page, storyId: string, chapterId: string) {
  await visit(page, `/stories/${storyId}/chapters/${chapterId}`);
  await page.getByRole('button', { name: 'Xuất bản', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận xuất bản', exact: true }).click();
  await expect(page.getByText('Đã xuất bản', { exact: true })).toBeVisible();
}

test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ request }) => {
  for (const actor of ['admin', 'user']) {
    const result = await request.post(apiUrl + '/auth/login', {
      data: {
        email: actor === 'admin' ? process.env.E2E_ADMIN_EMAIL : process.env.E2E_USER_EMAIL,
        password,
      },
    });
    expect(result.status()).toBe(200);
    const body = await result.json();
    if (actor === 'admin') adminToken = body.data.accessToken;
    else userToken = body.data.accessToken;
  }
});
test.beforeEach(async ({ page }) => {
  // Only image rendering is mocked. All internal API traffic reaches the test backend.
  await page.route('**/*', (route) => {
    const url = new URL(route.request().url());
    if (url.origin === process.env.E2E_APP_URL || url.origin === 'http://127.0.0.1:4185')
      return route.continue();
    if (url.hostname === 'e2e-images.invalid')
      return route.fulfill({ contentType: 'image/png', body: png });
    return route.abort();
  });
});

test('NOVEL: UI login, Genre, DRAFT Story, multiline Chapter, publication and real public reads', async ({
  page,
  request,
}) => {
  await login(page);
  genreName = prefix + 'Fantasy';
  await createGenre(page, genreName);
  const story = await createStory(page, 'NOVEL');
  novel = story.id;
  novelSlug = story.slug;
  expect((await api(request, `/stories/${novel}`, 'GET', undefined, 'guest')).status()).toBe(404);
  await page.getByRole('link', { name: 'Quản lý chương', exact: true }).click();
  await page.getByRole('link', { name: 'Thêm chương' }).click();
  await page.getByLabel('Tên chương', { exact: true }).fill('Chương chữ E2E');
  await page.getByLabel('Nội dung chương', { exact: true }).fill(text);
  const response = page.waitForResponse(
    (r) =>
      r.url() === `${apiUrl}/admin/stories/${novel}/chapters` && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Tạo chương nháp' }).click();
  const saved = await response;
  expect(saved.status()).toBe(201);
  novelChapter = (await saved.json()).data.id;
  const premature = await api(request, `/admin/chapters/${novelChapter}/publish`, 'PATCH', {});
  expect(premature.status()).toBe(409);
  expect((await premature.json()).error.code).toBe('STORY_NOT_PUBLISHED');
  await expect(page.locator('.chapters-novel')).toHaveText(text);
  await publishStory(page, novel);
  await publishChapter(page, novel, novelChapter);
  const publicStory = await api(request, `/stories/${novel}`, 'GET', undefined, 'guest');
  expect(publicStory.status()).toBe(200);
  expect((await publicStory.json()).data.slug).toBe(novelSlug);
  const chapter = await api(request, `/chapters/${novelChapter}`, 'GET', undefined, 'guest');
  expect(chapter.status()).toBe(200);
  expect((await chapter.json()).data.content).toBe(text);
  const listed = await api(request, `/stories/${novel}/chapters`, 'GET', undefined, 'guest');
  expect((await listed.json()).data.map((r: { id: string }) => r.id)).toContain(novelChapter);
  await page.screenshot({ path: 'test-results/integration/novel-publication.png', fullPage: true });
});

test('COMIC: real multipart, Backend storage mock, reorder, persist and public image order', async ({
  page,
  request,
}) => {
  await login(page);
  const story = await createStory(page, 'COMIC');
  comic = story.id;
  await page.getByRole('link', { name: 'Quản lý chương', exact: true }).click();
  await page.getByRole('link', { name: 'Thêm chương' }).click();
  await page.getByLabel('Tên chương', { exact: true }).fill('Chương tranh E2E');
  const response = page.waitForResponse(
    (r) =>
      r.url() === `${apiUrl}/admin/stories/${comic}/chapters` && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Tạo chương nháp' }).click();
  const saved = await response;
  expect(saved.status()).toBe(201);
  const id = (await saved.json()).data.id;
  await page
    .getByLabel('Chọn ảnh trang truyện')
    .setInputFiles(
      [1, 2].map((n) => ({ name: `generated-${n}.png`, mimeType: 'image/png', buffer: png })),
    );
  await page.getByRole('button', { name: /Xác nhận tải batch tiếp theo/ }).click();
  const uploadResponse = page.waitForResponse(
    (r) => r.url() === apiUrl + '/admin/uploads/chapter-pages',
  );
  await page.getByRole('button', { name: 'Tải 2 ảnh trong batch này' }).click();
  const uploaded = await uploadResponse;
  expect(uploaded.status()).toBe(201);
  const images = (await uploaded.json()).data;
  expect(images.map((r: { order: number }) => r.order)).toEqual([1, 2]);
  await expect(page.getByRole('button', { name: 'Lưu danh sách trang' })).toBeEnabled();
  // Upload alone must not create ChapterPage rows.
  expect((await (await api(request, `/admin/chapters/${id}`)).json()).data.pages).toHaveLength(0);
  await page.getByRole('button', { name: 'Đưa trang 2 lên' }).click();
  await page.getByRole('button', { name: 'Lưu danh sách trang' }).click();
  await page.getByRole('button', { name: 'Xác nhận lưu danh sách trang' }).click();
  await expect(page.getByText('Đã lưu toàn bộ danh sách trang.')).toBeVisible();
  await publishStory(page, comic);
  await publishChapter(page, comic, id);
  const result = await api(request, `/chapters/${id}`, 'GET', undefined, 'guest');
  expect(result.status()).toBe(200);
  const body = (await result.json()).data;
  expect(body.pages.map((p: { imageUrl: string }) => p.imageUrl)).toEqual([
    images[1].secureUrl,
    images[0].secureUrl,
  ]);
  expect(body.pages.map((p: { pageNumber: number }) => p.pageNumber)).toEqual([1, 2]);
  expect(body.pages.every((p: object) => !('storagePublicId' in p))).toBe(true);
});

test('Management: Genre edit/delete/conflict, real Story filters and UI Comment Hide/Show', async ({
  page,
  request,
}) => {
  await login(page);
  const spare = prefix + 'Unused';
  await createGenre(page, spare);
  await page.getByRole('button', { name: `Sửa ${spare}`, exact: true }).click();
  await page.getByLabel('Tên thể loại', { exact: true }).fill(spare + 'Edited');
  await page.getByRole('button', { name: 'Lưu thể loại', exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận lưu thể loại' }).click();
  await expect(page.getByRole('button', { name: `Xóa ${spare}Edited`, exact: true })).toBeVisible();
  await page.getByRole('button', { name: `Xóa ${spare}Edited`, exact: true }).click();
  await page.getByRole('button', { name: 'Xác nhận xóa thể loại' }).click();
  await expect(page.getByText(spare + 'Edited', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: `Xóa ${genreName}`, exact: true }).click();
  const deletion = page.waitForResponse(
    (r) => r.request().method() === 'DELETE' && r.url().includes('/admin/genres/'),
  );
  await page.getByRole('button', { name: 'Xác nhận xóa thể loại' }).click();
  expect((await deletion).status()).toBe(409);
  await expect(page.getByRole('alert')).toContainText('đang được truyện sử dụng');
  await visit(page, '/stories');
  await page.getByLabel('Tìm tên truyện').fill(prefix);
  await page.getByRole('button', { name: /Áp dụng/ }).click();
  await expect(page.getByRole('link', { name: prefix + 'NOVEL', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: prefix + 'COMIC', exact: true })).toBeVisible();
  const created = await api(
    request,
    `/stories/${novel}/comments`,
    'POST',
    { content: 'E2E Root comment' },
    'user',
  );
  expect(created.status()).toBe(201);
  const root = (await created.json()).data;
  const reply = await api(
    request,
    `/stories/${novel}/comments`,
    'POST',
    { content: 'E2E Reply', parentId: root.id },
    'user',
  );
  expect(reply.status()).toBe(201);
  await visit(page, '/comments');
  await expect(page.getByText('E2E Root comment', { exact: true })).toBeVisible();
  await expect(page.getByText(/Phản hồi @e2e_/)).toBeVisible();
  await page.getByRole('button', { name: `Ẩn bình luận ${root.id}` }).click();
  await page.getByRole('button', { name: 'Xác nhận ẩn bình luận' }).click();
  await expect(page.getByRole('button', { name: `Hiện bình luận ${root.id}` })).toBeVisible();
  expect(
    (await (await api(request, `/stories/${novel}/comments`, 'GET', undefined, 'guest')).json())
      .data,
  ).toHaveLength(0);
  await page.getByRole('button', { name: `Hiện bình luận ${root.id}` }).click();
  await page.getByRole('button', { name: 'Xác nhận hiện bình luận' }).click();
  await expect(page.getByRole('button', { name: `Ẩn bình luận ${root.id}` })).toBeVisible();
  const publicRows = (
    await (await api(request, `/stories/${novel}/comments`, 'GET', undefined, 'guest')).json()
  ).data;
  expect(publicRows[0].replies).toHaveLength(1);
});

test('Chapter versions: successful UI edit, stale editor guard, real CHAPTER_STALE and concurrent writers', async ({
  page,
  request,
}) => {
  await login(page);
  await visit(page, `/stories/${novel}/chapters/${novelChapter}/edit`);
  await expect(page.getByLabel('Tên chương', { exact: true })).toHaveValue('Chương chữ E2E');
  const initial = (await (await api(request, `/admin/chapters/${novelChapter}`)).json()).data;
  await page.getByLabel('Tên chương', { exact: true }).fill('Chương đã chỉnh sửa E2E');
  const write = page.waitForResponse(
    (r) =>
      r.url() === `${apiUrl}/admin/chapters/${novelChapter}` && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Lưu thông tin chương' }).click();
  const saved = await write;
  expect(saved.status()).toBe(200);
  expect(saved.request().postDataJSON().expectedUpdatedAt).toBe(initial.updatedAt);
  await expect(page.getByText('Đã lưu thông tin chương.')).toBeVisible();
  const revision = (await saved.json()).data.updatedAt;
  const newer = await api(request, `/admin/chapters/${novelChapter}`, 'PATCH', {
    title: 'Chương từ tác vụ đồng thời',
    expectedUpdatedAt: revision,
  });
  expect(newer.status()).toBe(200);
  await page.getByLabel('Tên chương', { exact: true }).fill('Thay đổi cũ không được ghi');
  await page.getByRole('button', { name: 'Lưu thông tin chương' }).click();
  await expect(page.getByRole('alert').first()).toContainText('Chương đã được thay đổi');
  const rejected = await api(request, `/admin/chapters/${novelChapter}`, 'PATCH', {
    title: 'Stale',
    expectedUpdatedAt: revision,
  });
  expect(rejected.status()).toBe(409);
  expect((await rejected.json()).error.code).toBe('CHAPTER_STALE');
  const current = (await newer.json()).data;
  const race = await Promise.all(
    ['Writer A', 'Writer B'].map((title) =>
      api(request, `/admin/chapters/${novelChapter}`, 'PATCH', {
        title,
        expectedUpdatedAt: current.updatedAt,
      }),
    ),
  );
  expect(race.map((r) => r.status()).sort()).toEqual([200, 409]);
  const final = (await (await api(request, `/admin/chapters/${novelChapter}`)).json()).data;
  expect(['Writer A', 'Writer B']).toContain(final.title);
  expect(final.content).toBe(text);
});

test('Security: Guest/USER denied, validation, real session expiration and UI logout', async ({
  page,
  request,
}) => {
  await page.goto('/comments');
  await expect(page).toHaveURL(/\/login$/);
  expect((await api(request, '/admin/comments', 'GET', undefined, 'guest')).status()).toBe(401);
  expect(
    (
      await api(
        request,
        '/admin/genres',
        'POST',
        { name: prefix + 'Forbidden', slug: 'forbidden' },
        'user',
      )
    ).status(),
  ).toBe(403);
  expect((await api(request, '/admin/comments', 'GET', undefined, 'user')).status()).toBe(403);
  await login(page, 'user');
  await expect(page.getByRole('alert')).toContainText('không có quyền');
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await visit(page, '/genres');
  await page.getByRole('button', { name: 'Thêm thể loại', exact: true }).click();
  await page.getByRole('button', { name: 'Tạo thể loại', exact: true }).click();
  await expect(page.getByText('Vui lòng nhập tên thể loại.')).toBeVisible();
  expect(
    (
      await api(request, '/admin/genres', 'POST', {
        name: prefix + 'Invalid',
        slug: '../escape',
        role: 'ADMIN',
      })
    ).status(),
  ).toBe(400);
  expect((await api(request, '/admin/comments?limit=101')).status()).toBe(400);
  await page.getByRole('button', { name: 'Hủy chỉnh sửa' }).click();
  await visit(page, '/dashboard');
  // This local CLI has the same strict test-DB guard; no HTTP test-control endpoint exists.
  execFileSync(
    process.execPath,
    [
      resolve('../backend/node_modules/tsx/dist/cli.mjs'),
      resolve('../backend/tests/browser/control.ts'),
      'expire-admin-session',
    ],
    { cwd: resolve('../backend'), env: process.env, stdio: 'ignore' },
  );
  expect((await api(request, '/auth/me')).status()).toBe(401);
  await page.getByRole('button', { name: 'Kiểm tra lại phiên' }).click();
  await expect(page).toHaveURL(/\/login$/);
  await expect(page.getByRole('status')).toContainText('kết thúc');
});
