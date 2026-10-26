import { getPrismaClient } from '../config/prisma';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type { FeedbackQuery, FeedbackStore, FeedbackTransaction } from '../types/feedback.types';

export const THREAD_REPLY_LIMIT = 20;
const user = { username: true, displayName: true, avatarUrl: true } satisfies Prisma.UserSelect;
const rating = { id: true, storyId: true, score: true, reviewText: true, createdAt: true, updatedAt: true, user: { select: user } } satisfies Prisma.RatingSelect;
const comment = { id: true, userId: true, storyId: true, parentId: true, content: true, status: true, createdAt: true, updatedAt: true, user: { select: user } } satisfies Prisma.CommentSelect;
const paging = (q: FeedbackQuery) => ({ skip: (q.page - 1) * q.limit, take: q.limit });
const ordering = (sort: FeedbackQuery['sort']) => [{ createdAt: sort === 'newest' ? 'desc' as const : 'asc' as const }, { id: sort === 'newest' ? 'desc' as const : 'asc' as const }];

function adapter(tx: Prisma.TransactionClient): FeedbackTransaction {
  return {
    async activeUser(id, admin = false) {
      return Boolean(await tx.user.findFirst({ where: { id, status: 'ACTIVE', ...(admin ? { role: 'ADMIN' } : {}) }, select: { id: true } }));
    },
    async story(id, lock) {
      if (lock) await tx.$queryRaw`SELECT id FROM public.stories WHERE id = ${id}::uuid FOR SHARE`;
      return tx.story.findUnique({ where: { id }, select: { id: true, publishStatus: true } });
    },
    async ratings(storyId, query) {
      const groups = await tx.rating.groupBy({ by: ['score'], where: { storyId }, _count: { _all: true } });
      const distribution: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
      let total = 0; let weighted = 0;
      for (const group of groups) {
        if (group.score >= 1 && group.score <= 5) distribution[group.score as 1 | 2 | 3 | 4 | 5] = group._count._all;
        total += group._count._all; weighted += group.score * group._count._all;
      }
      const data = await tx.rating.findMany({ where: { storyId }, select: rating, ...paging(query), orderBy: ordering(query.sort) });
      return { data, total, summary: { averageScore: total ? Number((weighted / total).toFixed(2)) : null, totalRatings: total, distribution } };
    },
    saveRating(userId, storyId, input) {
      return tx.rating.upsert({ where: { userId_storyId: { userId, storyId } },
        create: { userId, storyId, score: input.score, reviewText: input.reviewText ?? null },
        update: { score: input.score, ...(input.reviewText !== undefined ? { reviewText: input.reviewText } : {}) }, select: rating });
    },
    async deleteRating(userId, storyId) { return (await tx.rating.deleteMany({ where: { userId, storyId } })).count; },
    async roots(storyId, query) {
      const where: Prisma.CommentWhereInput = { storyId, parentId: null, status: 'VISIBLE' };
      const total = await tx.comment.count({ where });
      const rows = await tx.comment.findMany({ where, ...paging(query), orderBy: ordering(query.sort), select: {
        ...comment,
        replies: { where: { status: 'VISIBLE', storyId }, select: comment, orderBy: ordering('oldest'), take: THREAD_REPLY_LIMIT },
        _count: { select: { replies: { where: { status: 'VISIBLE', storyId } } } },
      } });
      return { data: rows.map(({ _count, ...row }) => ({ ...row, replyCount: _count.replies })), total };
    },
    async replies(parentId, storyId, query) {
      const where: Prisma.CommentWhereInput = { storyId, parentId, status: 'VISIBLE' };
      const total = await tx.comment.count({ where });
      const data = await tx.comment.findMany({ where, select: comment, ...paging(query), orderBy: ordering(query.sort) });
      return { data, total };
    },
    async commentStoryId(id) { return (await tx.comment.findUnique({ where: { id }, select: { storyId: true } }))?.storyId ?? null; },
    comment(id, storyId) { return tx.comment.findFirst({ where: { id, storyId }, select: comment }); },
    createComment(userId, storyId, input) { return tx.comment.create({ data: { userId, storyId, content: input.content, parentId: input.parentId ?? null, status: 'VISIBLE' }, select: comment }); },
    editComment(id, content) { return tx.comment.update({ where: { id }, data: { content }, select: comment }); },
    replyCount(id) { return tx.comment.count({ where: { parentId: id } }); },
    async deleteComment(id) { await tx.comment.delete({ where: { id } }); },
    moderate(id, status) { return tx.comment.update({ where: { id }, data: { status }, select: comment }); },
  };
}
export function createPrismaFeedbackStore(client: () => PrismaClient = getPrismaClient): FeedbackStore {
  return {
    transaction(storyId, mode, work) {
      return client().$transaction(async (tx) => {
        if (mode === 'write') {
          if (!storyId) throw new Error('Feedback writes require a story lock scope');
          await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${storyId}::text, 1464746320::bigint))`;
        }
        return work(adapter(tx));
      }, { isolationLevel: mode === 'write' ? 'ReadCommitted' : 'RepeatableRead', maxWait: 5000, timeout: 10000 });
    },
  };
}
export const prismaFeedbackStore = createPrismaFeedbackStore();
