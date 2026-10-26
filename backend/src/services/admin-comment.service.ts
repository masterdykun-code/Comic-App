import type { AdminCommentQuery, AdminCommentStore } from '../types/admin-comment.types';
import { HttpError } from '../utils/http-error';
import { prismaAdminCommentStore } from './admin-comment.store';
export function createAdminCommentService(store: AdminCommentStore = prismaAdminCommentStore) {
  return { list(actor: string, query: AdminCommentQuery) { return store.transaction(async (tx) => {
    if (!await tx.adminIsActive(actor)) throw new HttpError(403, 'FORBIDDEN', 'An active ADMIN account is required');
    const { data, total } = await tx.list(query);
    return { data, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }); } };
}
export type AdminCommentService = ReturnType<typeof createAdminCommentService>;
export const adminCommentService = createAdminCommentService();
