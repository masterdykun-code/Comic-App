import { z } from 'zod';
import type { AxiosInstance } from 'axios';
import { api } from '../auth/runtime';
const count = z.number().int().nonnegative();
export const managedUserSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  email: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.literal('USER'),
  status: z.enum(['ACTIVE', 'BANNED']),
  createdAt: z.iso.datetime({ offset: true }),
  updatedAt: z.iso.datetime({ offset: true }),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;
export const userQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    search: z.string().trim().min(1).max(200).optional(),
    status: z.enum(['ACTIVE', 'BANNED']).optional(),
  })
  .strict()
  .refine(
    (q) => Number.isSafeInteger((q.page - 1) * q.limit) && (q.page - 1) * q.limit <= 2147483647,
  );
export type UserQuery = z.infer<typeof userQuerySchema>;
const userListSchema = z.object({
  data: z.array(managedUserSchema),
  pagination: z.object({ page: count, limit: count, total: count, totalPages: count }),
});
export const dashboardSchema = z.object({
  users: z.object({ total: count, active: count, banned: count }),
  stories: z.object({ total: count, novels: count, comics: count, published: count }),
  totalChapters: count,
  readingEvents: count,
  readingMetric: z.literal('STORED_AUTHENTICATED_HISTORY'),
  popularStories: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      type: z.enum(['NOVEL', 'COMIC']),
      publishStatus: z.enum(['DRAFT', 'PUBLISHED']),
      readCount: count,
    }),
  ),
});
export function createUsersApi(client: AxiosInstance) {
  return {
    async list(query: UserQuery) {
      return userListSchema.parse(
        (await client.get('/admin/users', { params: userQuerySchema.parse(query) })).data,
      );
    },
    async detail(id: string) {
      z.uuid().parse(id);
      return managedUserSchema.parse((await client.get(`/admin/users/${id}`)).data.data);
    },
    async status(input: { id: string; status: ManagedUser['status']; expectedUpdatedAt: string }) {
      z.uuid().parse(input.id);
      return managedUserSchema.parse(
        (
          await client.patch(`/admin/users/${input.id}/status`, {
            status: input.status,
            expectedUpdatedAt: input.expectedUpdatedAt,
            confirm: true,
          })
        ).data.data,
      );
    },
    async dashboard() {
      return dashboardSchema.parse((await client.get('/admin/dashboard')).data.data);
    },
  };
}
export const usersApi = createUsersApi(api);
