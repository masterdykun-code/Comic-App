import { create } from 'axios';
import MockAdapter from 'axios-mock-adapter';
import {
  createFeedbackApi,
  commentInput,
  profileInput,
  ratingInput,
} from '../src/features/feedback/api';
import { createApiClient } from '../src/services/api';
import { createAuthSession } from '../src/stores/auth';
import { safeError } from '../src/lib/errors';
import { safeReturnPath } from '../src/features/auth/navigation';
import { comment, reply, thread, rating, ratingPage, feedbackPage } from './feedback-fixtures';
import { novel } from './catalog-fixtures';
import { user, transport, vault, input } from './fixtures';
jest.mock('../src/services/runtime', () => ({ api: jest.requireActual('axios').default.create() }));
const client = create();
const mock = new MockAdapter(client);
const api = createFeedbackApi(client);
const envelope = (data: object) => ({ success: true, ...data });
beforeEach(() => mock.reset());
test('ratings parse aggregate/distribution and request supported pagination', async () => {
  mock
    .onGet(`/stories/${novel.id}/ratings`, { params: { page: 2, limit: 20, sort: 'newest' } })
    .reply(200, envelope(ratingPage([rating], 2, 21)));
  expect(await api.ratings(novel.id, 2)).toEqual(ratingPage([rating], 2, 21));
});
test('public rating parser strips sensitive and invented ownership fields', async () => {
  mock.onGet().reply(
    200,
    envelope(
      ratingPage([
        {
          ...rating,
          userId: user.id,
          isOwner: true,
          user: { ...rating.user, email: user.email, passwordHash: 'private' },
        } as typeof rating,
      ]),
    ),
  );
  const result = await api.ratings(novel.id);
  expect(result.data[0]).toEqual(rating);
  expect(JSON.stringify(result)).not.toContain('passwordHash');
});
test('root comments parse inline replies and reply pagination', async () => {
  mock.onGet().reply(200, envelope(feedbackPage([thread])));
  expect(await api.comments(novel.id)).toEqual(feedbackPage([thread]));
});
test('replies use oldest ordering and exact root/story identity', async () => {
  mock
    .onGet(`/comments/${comment.id}/replies`, { params: { page: 2, limit: 20, sort: 'oldest' } })
    .reply(200, envelope(feedbackPage([reply], 2, 21)));
  expect(await api.replies(comment.id, novel.id, 2)).toEqual(feedbackPage([reply], 2, 21));
});
test.each(['HIDDEN', 'DELETED'])(
  'rejects explicit %s comments instead of rendering them',
  async (status) => {
    mock.onGet().reply(200, envelope(feedbackPage([{ ...thread, status }])));
    await expect(api.comments(novel.id)).rejects.toMatchObject({ status: 502 });
  },
);
test('rejects cross-story inline reply and reply-to-reply topology', async () => {
  mock
    .onGet()
    .reply(
      200,
      envelope(feedbackPage([{ ...thread, replies: [{ ...reply, parentId: reply.id }] }])),
    );
  await expect(api.comments(novel.id)).rejects.toMatchObject({ status: 502 });
});
test('rejects mismatched server pagination', async () => {
  mock.onGet().reply(200, envelope(ratingPage([rating], 3, 41)));
  await expect(api.ratings(novel.id)).rejects.toMatchObject({ status: 502 });
});
test('rating update sends only score and reviewText and DELETE targets my-rating', async () => {
  mock.onPut().reply(200, envelope({ data: rating }));
  mock.onDelete().reply(200, envelope({ data: { removed: true } }));
  await api.saveRating(novel.id, { score: 4, reviewText: ' Nhận xét ' });
  expect(JSON.parse(mock.history.put[0].data)).toEqual({ score: 4, reviewText: 'Nhận xét' });
  await api.removeRating(novel.id);
  expect(mock.history.delete[0].url).toBe(`/stories/${novel.id}/my-rating`);
});
test('comment writes send no client-selected user or role', async () => {
  mock.onPost().reply(201, envelope({ data: reply }));
  mock.onPatch().reply(200, envelope({ data: comment }));
  mock.onDelete().reply(200, envelope({ data: { removed: true } }));
  await api.createComment(novel.id, { content: ' Phản hồi ', parentId: comment.id });
  expect(JSON.parse(mock.history.post[0].data)).toEqual({
    content: 'Phản hồi',
    parentId: comment.id,
  });
  await api.editComment(comment.id, ' Sửa ');
  expect(JSON.parse(mock.history.patch[0].data)).toEqual({ content: 'Sửa' });
  await api.removeComment(comment.id);
  expect(mock.history.delete[0].url).toBe(`/comments/${comment.id}`);
});
test('profile uses GET/PATCH me and strips hash from response', async () => {
  mock.onGet().reply(200, envelope({ data: { ...user, passwordHash: 'secret' } }));
  mock.onPatch().reply(200, envelope({ data: user }));
  expect(await api.me()).toEqual(user);
  await api.updateProfile({ displayName: ' Tên mới ', avatarUrl: null });
  expect(JSON.parse(mock.history.patch[0].data)).toEqual({
    displayName: 'Tên mới',
    avatarUrl: null,
  });
});
test.each([0, 6, 1.5, NaN])('rejects invalid rating score %s', (score) =>
  expect(ratingInput.safeParse({ score }).success).toBe(false),
);
test.each(['', ' ', '<b>HTML</b>', '\u200b', 'a\x00b', 'a'.repeat(3001)])(
  'rejects invalid comment text %#',
  (content) => expect(commentInput.safeParse({ content }).success).toBe(false),
);
test('matches backend character boundaries, optional review and newline content', () => {
  expect(commentInput.parse({ content: '  Dòng 1\nDòng 2  ' }).content).toBe('Dòng 1\nDòng 2');
  expect(ratingInput.safeParse({ score: 5, reviewText: 'a'.repeat(2001) }).success).toBe(false);
  expect(ratingInput.safeParse({ score: 5, reviewText: null }).success).toBe(true);
  expect(profileInput.safeParse({ displayName: 'a'.repeat(101) }).success).toBe(false);
});
test.each([
  { role: 'ADMIN' },
  { status: 'ACTIVE' },
  { id: user.id },
  {},
  { avatarUrl: 'javascript:alert(1)' },
  { displayName: '' },
])('rejects unsupported profile input %#', (value) =>
  expect(profileInput.safeParse(value).success).toBe(false),
);
test('rejects forged ownership fields before sending', async () => {
  await expect(api.saveRating(novel.id, { score: 5, userId: user.id } as never)).rejects.toThrow();
  expect(mock.history.put).toHaveLength(0);
});
test('login return permits feedback UUID but rejects arbitrary redirects', () => {
  expect(safeReturnPath(`/feedback/${novel.id}`)).toBe(`/feedback/${novel.id}`);
  expect(safeReturnPath('/feedback/not-a-uuid')).toBe('/library');
});
test.each([400, 401, 403, 404, 409, 429, 500])(
  'real shared client sanitizes HTTP %s without logging credentials',
  async (status) => {
    const session = createAuthSession(transport(), vault());
    await session.login(input);
    const shared = createApiClient('http://localhost:4199/api', session);
    const adapter = new MockAdapter(shared);
    adapter.onPut().reply(status, {
      message: 'private credentials passwordHash secret token',
      code: 'COMMENT_HAS_REPLIES',
    });
    const error = await createFeedbackApi(shared)
      .saveRating(novel.id, { score: 5 })
      .catch(safeError);
    expect(error).toMatchObject({ status });
    expect(JSON.stringify(error)).not.toMatch(/private credentials|passwordHash|Authorization/);
    expect(adapter.history.put).toHaveLength(1);
    adapter.restore();
  },
);
