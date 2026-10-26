import { getPrismaClient } from '../config/prisma';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import type { AdminCommentStore } from '../types/admin-comment.types';
const user = { username: true, displayName: true, avatarUrl: true } satisfies Prisma.UserSelect;
export function createPrismaAdminCommentStore(client: () => PrismaClient = getPrismaClient): AdminCommentStore {
  return { transaction(work) { return client().$transaction(async (tx) => work({
    async adminIsActive(id) { return Boolean(await tx.user.findFirst({ where: { id, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })); },
    async list(query) {
      const where: Prisma.CommentWhereInput = { ...(query.storyId ? { storyId: query.storyId } : {}), ...(query.status ? { status: query.status } : {}), ...(query.parentId ? { parentId: query.parentId } : {}) };
      const total = await tx.comment.count({ where });
      const direction = query.sort === 'oldest' ? 'asc' as const : 'desc' as const;
      const rows = await tx.comment.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: direction }, { id: direction }], select: {
        id: true, storyId: true, parentId: true, content: true, status: true, createdAt: true, updatedAt: true,
        user: { select: user }, story: { select: { id: true, title: true, slug: true, publishStatus: true } },
        parent: { select: { id: true, status: true, user: { select: user } } }, _count: { select: { replies: true } },
      } });
      return { data: rows.map(({ _count, ...row }) => ({ ...row, replyCount: _count.replies })), total };
    },
  }), { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 }); } };
}
export const prismaAdminCommentStore = createPrismaAdminCommentStore();
