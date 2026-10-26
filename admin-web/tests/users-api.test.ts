import { afterEach, expect, it } from 'vitest';
import MockAdapter from 'axios-mock-adapter';
import axios from 'axios';
import {
  managedUserSchema,
  dashboardSchema,
  userQuerySchema,
  createUsersApi,
} from '../src/features/users/api';
const row = {
  id: '20000000-0000-4000-8000-000000000001',
  username: 'reader',
  displayName: 'Bạn đọc',
  email: 'reader@example.test',
  avatarUrl: null,
  role: 'USER',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
const client = axios.create();
const usersApi = createUsersApi(client);
const mocks: MockAdapter[] = [];
afterEach(() => mocks.splice(0).forEach((m) => m.restore()));
function mock() {
  const m = new MockAdapter(client);
  mocks.push(m);
  return m;
}
it('parses USER projection without extra sensitive fields and rejects an ADMIN row', () => {
  expect(managedUserSchema.parse({ ...row, passwordHash: 'private' })).not.toHaveProperty(
    'passwordHash',
  );
  expect(managedUserSchema.safeParse({ ...row, role: 'ADMIN' }).success).toBe(false);
});
it('status API sends only status, version and explicit confirmation', async () => {
  const m = mock();
  m.onPatch(`/admin/users/${row.id}/status`).reply(200, {
    success: true,
    data: { ...row, status: 'BANNED' },
  });
  const result = await usersApi.status({
    id: row.id,
    status: 'BANNED',
    expectedUpdatedAt: row.updatedAt,
  });
  expect(result.status).toBe('BANNED');
  expect(JSON.parse(m.history.patch[0]!.data as string)).toEqual({
    status: 'BANNED',
    expectedUpdatedAt: row.updatedAt,
    confirm: true,
  });
});
it('invalid id/query never sends an API request', async () => {
  const m = mock();
  await expect(usersApi.detail('bad')).rejects.toThrow();
  await expect(usersApi.list({ page: 1, limit: 101 })).rejects.toThrow();
  expect(m.history.get).toHaveLength(0);
  expect(userQuerySchema.safeParse({ page: 0 }).success).toBe(false);
  expect(userQuerySchema.safeParse({ role: 'ADMIN' }).success).toBe(false);
});
it('dashboard requires defined read semantics and nonnegative numeric totals', () => {
  const stats = {
    users: { total: 0, active: 0, banned: 0 },
    stories: { total: 0, novels: 0, comics: 0, published: 0 },
    totalChapters: 0,
    readingEvents: 0,
    readingMetric: 'STORED_AUTHENTICATED_HISTORY',
    popularStories: [],
  };
  expect(dashboardSchema.safeParse(stats).success).toBe(true);
  expect(dashboardSchema.safeParse({ ...stats, readingEvents: -1 }).success).toBe(false);
  expect(dashboardSchema.safeParse({ ...stats, readingMetric: 'TOTAL_VIEWS' }).success).toBe(false);
});
