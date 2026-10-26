import MockAdapter from 'axios-mock-adapter';
import { describe, expect, it } from 'vitest';
import { createApiClient } from '../src/lib/api/client';
import { Session } from '../src/features/auth/session';
import { createStoriesApi } from '../src/features/stories/api';
import { defaults } from '../src/features/stories/model';
import { input, transport } from './fixtures';

async function fixture() {
  const session = new Session(transport());
  await session.login(input);
  const client = createApiClient(session);
  const mock = new MockAdapter(client, { onNoMatch: 'throwException' });
  return { mock, session, api: createStoriesApi(client) };
}
const id = '20000000-0000-4000-8000-000000000001';
const valid = { ...defaults, title: 'Valid title', authorName: 'Valid author' };
describe('Stories HTTP contract (no real requests)', () => {
  it('uses protected unpublish and explicitly confirmed/versioned DELETE without replay', async () => {
    const { api, mock } = await fixture();
    const expectedUpdatedAt = '2026-10-24T00:00:00.000Z';
    mock
      .onPatch(`/admin/stories/${id}/unpublish`)
      .reply(200, { data: { id, publishStatus: 'DRAFT' } });
    mock.onDelete(`/admin/stories/${id}`).reply((config) => {
      expect(config.headers?.Authorization).toMatch(/^Bearer /);
      expect(JSON.parse(config.data)).toEqual({ confirm: true, expectedUpdatedAt });
      return [200, { success: true, data: { deleted: true } }];
    });
    expect((await api.unpublish(id)).publishStatus).toBe('DRAFT');
    await expect(api.remove(id, expectedUpdatedAt)).resolves.toEqual({ deleted: true });
    expect(mock.history.delete).toHaveLength(1);
  });
  it('validates deletion identifiers/version and refuses malformed success', async () => {
    const { api, mock } = await fixture();
    await expect(api.remove('bad', 'bad')).rejects.toThrow();
    expect(mock.history.delete).toHaveLength(0);
    mock.onDelete(`/admin/stories/${id}`).reply(200, { success: true });
    await expect(api.remove(id, '2026-10-24T00:00:00Z')).rejects.toMatchObject({ status: 502 });
    expect(mock.history.delete).toHaveLength(1);
  });
  it.each([
    ['STORY_STALE', 'Truyện đã thay đổi'],
    ['STORY_DELETE_CONFLICT', 'Không xóa một phần'],
  ])('maps deletion conflict %s safely', async (code, message) => {
    const { api, mock } = await fixture();
    mock
      .onDelete(`/admin/stories/${id}`)
      .reply(409, { error: { code }, message: 'private SQL detail' });
    await expect(api.remove(id, '2026-10-24T00:00:00Z')).rejects.toMatchObject({
      status: 409,
      code,
      message: expect.stringContaining(message),
    });
    expect(mock.history.delete).toHaveLength(1);
  });
  it('uses protected ADMIN reads and passes exact pagination and abort signal', async () => {
    const { api, mock } = await fixture();
    mock.onGet('/admin/stories').reply((config) => {
      expect(config.headers?.Authorization).toMatch(/^Bearer /);
      expect(config.params).toEqual({ page: 2, limit: 10, type: 'COMIC', publishStatus: 'DRAFT' });
      return [200, { data: [], pagination: { page: 2, limit: 10, total: 0, totalPages: 0 } }];
    });
    mock
      .onGet(`/admin/stories/${id}`)
      .reply(200, { data: { id, publishStatus: 'DRAFT', chapterCount: 3 } });
    await api.list(
      { page: 2, limit: 10, type: 'COMIC', publishStatus: 'DRAFT' },
      new AbortController().signal,
    );
    expect(await api.detail(id)).toEqual({ id, publishStatus: 'DRAFT', chapterCount: 3 });
  });
  it('create omits publication, creator and upload public ID; locked update omits type', async () => {
    const { api, mock } = await fixture();
    mock.onPost('/stories').reply((config) => {
      expect(JSON.parse(config.data)).toEqual(valid);
      return [201, { data: { id } }];
    });
    mock.onPatch(`/stories/${id}`).reply((config) => {
      const { type: _type, ...expected } = valid;
      expect(JSON.parse(config.data)).toEqual(expected);
      return [200, { data: { id } }];
    });
    await api.create(valid);
    await api.update(id, valid, true);
  });
  it('publish is PATCH with empty JSON object', async () => {
    const { api, mock } = await fixture();
    mock.onPatch(`/stories/${id}/publish`).reply((config) => {
      expect(JSON.parse(config.data)).toEqual({});
      return [200, { data: { id } }];
    });
    await api.publish(id);
  });
  it('uploads one file as multipart field file and returns secureUrl/publicId', async () => {
    const { api, mock } = await fixture();
    const file = new File(['mock-image'], 'cover.png', { type: 'image/png' });
    const result = { secureUrl: 'https://example.test/cover.png', publicId: 'mock-upload' };
    mock.onPost('/admin/uploads/cover').reply((config) => {
      expect(config.data).toBeInstanceOf(FormData);
      expect(config.data.get('file')).toBe(file);
      expect([...config.data.keys()]).toEqual(['file']);
      expect(config.timeout).toBe(45_000);
      return [201, { data: result }];
    });
    expect(await api.upload(file)).toEqual(result);
    expect(mock.history.post).toHaveLength(1);
  });
  it('HTTP 401 mutation invalidates auth without automatic replay or refresh', async () => {
    const { api, mock, session } = await fixture();
    mock.onPost('/stories').reply(401, { message: 'untrusted secret' });
    await expect(api.create(valid)).rejects.toMatchObject({ status: 401 });
    expect(session.snapshot().status).toBe('anonymous');
    expect(mock.history.post).toHaveLength(1);
  });
  it.each([
    [400, 'STORY_NOT_PUBLISHABLE', 'ít nhất một thể loại'],
    [409, 'STORY_TYPE_LOCKED', 'không thể đổi loại'],
    [400, 'INVALID_GENRES', 'thể loại không còn tồn tại'],
    [413, 'UPLOAD_TOO_LARGE', '5 MiB'],
  ])('maps HTTP %s %s to a safe, specific error', async (status, code, text) => {
    const { api, mock } = await fixture();
    mock
      .onPatch(`/stories/${id}/publish`)
      .reply(status, { message: 'sensitive server internals', error: { code } });
    await expect(api.publish(id)).rejects.toMatchObject({
      status,
      code,
      message: expect.stringContaining(text),
    });
  });
  it('never carries arbitrary server errors, secrets or request config into UI', async () => {
    const { api, mock } = await fixture();
    mock.onGet(`/admin/stories/${id}`).reply(500, {
      message: 'DATABASE_URL=secret',
      stack: 'sensitive stack',
      error: { code: 'unexpected' },
    });
    try {
      await api.detail(id);
      throw new Error('Expected rejection');
    } catch (error) {
      expect(error).toMatchObject({ status: 500 });
      expect(JSON.stringify(error)).not.toContain('secret');
      expect(error).not.toHaveProperty('config');
    }
  });
});
