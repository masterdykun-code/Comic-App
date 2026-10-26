import MockAdapter from 'axios-mock-adapter';
import { expect, it } from 'vitest';
import { Session } from '../src/features/auth/session';
import { createApiClient } from '../src/lib/api/client';
import { createGenresApi } from '../src/features/genres/api';
import { createCommentsApi } from '../src/features/comments/api';
import { genre, rootComment } from './catalog-fixtures';
import { input, transport } from './fixtures';

async function setup() {
  const auth = transport();
  const session = new Session(auth);
  await session.login(input);
  const client = createApiClient(session);
  const mock = new MockAdapter(client);
  return {
    auth,
    session,
    mock,
    genres: createGenresApi(client),
    comments: createCommentsApi(client),
  };
}
it('genre writes use the authorized admin paths and strict bodies', async () => {
  const { mock, genres } = await setup();
  const value = { name: 'Phiêu lưu', slug: 'phieu-luu' };
  mock.onPost('/admin/genres').reply(201, { success: true, data: genre });
  mock.onPatch(`/admin/genres/${genre.id}`).reply(200, { success: true, data: genre });
  mock
    .onDelete(`/admin/genres/${genre.id}`)
    .reply(200, { success: true, data: { id: genre.id, removed: true } });
  expect(await genres.create(value)).toEqual(genre);
  await genres.update(genre.id, value);
  await genres.remove(genre.id);
  expect(JSON.parse(mock.history.post[0]!.data)).toEqual(value);
  expect(JSON.parse(mock.history.patch[0]!.data)).toEqual(value);
  expect(mock.history.delete[0]!.data).toBeUndefined();
});
it('comments list passes filters and moderation sends only status', async () => {
  const { mock, comments } = await setup();
  const query = {
    page: 2,
    limit: 20,
    sort: 'newest' as const,
    status: 'HIDDEN' as const,
    storyId: rootComment.storyId,
  };
  const list = {
    data: [rootComment],
    pagination: { page: 2, limit: 20, total: 21, totalPages: 2 },
  };
  mock.onGet('/admin/comments').reply(200, list);
  mock
    .onPatch(`/admin/comments/${rootComment.id}/moderate`)
    .reply(200, { success: true, data: { id: rootComment.id, status: 'HIDDEN' } });
  expect(await comments.list(query)).toEqual(list);
  expect(mock.history.get[0]!.params).toEqual(query);
  await comments.moderate(rootComment.id, 'HIDDEN');
  expect(JSON.parse(mock.history.patch[0]!.data)).toEqual({ status: 'HIDDEN' });
});
it('409 uses safe code mapping instead of returning server details', async () => {
  const { mock, genres } = await setup();
  mock.onDelete().reply(409, {
    success: false,
    error: { code: 'GENRE_IN_USE', message: 'private database connection passwordHash' },
  });
  await expect(genres.remove(genre.id)).rejects.toMatchObject({
    status: 409,
    message: expect.stringContaining('đang được truyện sử dụng'),
  });
});
it('401 never replays genre mutations or refreshes after an ambiguous write', async () => {
  const { mock, genres, auth, session } = await setup();
  mock.onDelete().reply(401, {});
  await expect(genres.remove(genre.id)).rejects.toMatchObject({ status: 401 });
  expect(mock.history.delete).toHaveLength(1);
  expect(auth.refresh).not.toHaveBeenCalled();
  expect(session.peek()).toBeNull();
});
it('invalid genre mass assignment and IDs never reach HTTP', async () => {
  const { mock, genres, comments } = await setup();
  await expect(
    genres.create({ name: 'Valid', slug: 'valid', role: 'ADMIN' } as never),
  ).rejects.toThrow();
  await expect(genres.remove('invalid')).rejects.toThrow();
  await expect(comments.moderate('invalid', 'HIDDEN')).rejects.toThrow();
  expect(mock.history).toHaveLength(0);
});
