import { getPrismaClient } from '../config/prisma';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type { ReadingStore, ReadingTransaction } from '../types/reading.types';

import { coinDay } from './coin.service';
import { canReadVip } from './vip-access';
const storySelect = { id: true, title: true, slug: true, coverUrl: true, type: true, authorName: true } satisfies Prisma.StorySelect;
const chapterSelect = { id: true, chapterNumber: true, title: true } satisfies Prisma.ChapterSelect;
const favoriteSelect = { id: true, storyId: true, createdAt: true, story: { select: storySelect } } satisfies Prisma.FavoriteSelect;
const progressSelect = {
  id: true, storyId: true, chapterId: true, textOffset: true, pageNumber: true, scrollOffset: true,
  progressPercent: true, updatedAt: true, story: { select: storySelect }, chapter: { select: chapterSelect },
} satisfies Prisma.ReadingProgressSelect;
const historySelect = {
  id: true, storyId: true, chapterId: true, readAt: true, story: { select: storySelect }, chapter: { select: chapterSelect },
} satisfies Prisma.ReadingHistorySelect;
const published = { story: { publishStatus: 'PUBLISHED' }, chapter: { publishStatus: 'PUBLISHED' } } as const;
const page = (q: { page: number; limit: number }) => ({ skip: (q.page - 1) * q.limit, take: q.limit });
type StoredProgress = Prisma.ReadingProgressGetPayload<{ select: typeof progressSelect }>;
const progressValue = (value: StoredProgress) => ({ ...value, progressPercent: value.progressPercent.toNumber() });

function adapter(tx: Prisma.TransactionClient): ReadingTransaction {
  return {
    canReadChapter: (id,userId)=>canReadVip(tx,id,userId),
    recordDailyActivity: async (userId,kind,targetId)=>{ await tx.coinDailyActivity.createMany({data:[{userId,day:coinDay(),kind,targetId}],skipDuplicates:true}); },
    async activeUser(userId) {
      return Boolean(await tx.user.findFirst({ where: { id: userId, status: 'ACTIVE' }, select: { id: true } }));
    },
    async story(id, lock) {
      // Same parent-before-child order as the existing Stories/Chapters writers.
      if (lock) await tx.$queryRaw`SELECT id FROM public.stories WHERE id = ${id}::uuid FOR SHARE`;
      return tx.story.findUnique({ where: { id }, select: { ...storySelect, publishStatus: true } });
    },
    async chapter(id, storyId, lock) {
      if (lock) await tx.$queryRaw`SELECT id FROM public.chapters WHERE id = ${id}::uuid AND story_id = ${storyId}::uuid FOR SHARE`;
      return tx.chapter.findFirst({ where: { id, storyId }, include: { pages: { orderBy: { pageNumber: 'asc' } } } });
    },
    async favorites(userId, query) {
      const where: Prisma.FavoriteWhereInput = { userId, story: { publishStatus: 'PUBLISHED' } };
      const total = await tx.favorite.count({ where });
      const data = await tx.favorite.findMany({ where, select: favoriteSelect, ...page(query), orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
      return { data, total };
    },
    async favoriteExists(userId, storyId) {
      return Boolean(await tx.favorite.findUnique({ where: { userId_storyId: { userId, storyId } }, select: { id: true } }));
    },
    addFavorite(userId, storyId) { return tx.favorite.create({ data: { userId, storyId }, select: favoriteSelect }); },
    async removeFavorite(userId, storyId) { return (await tx.favorite.deleteMany({ where: { userId, storyId } })).count; },
    async progressList(userId, query) {
      const where: Prisma.ReadingProgressWhereInput = { userId, ...published };
      const total = await tx.readingProgress.count({ where });
      const values = await tx.readingProgress.findMany({ where, select: progressSelect, ...page(query), orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }] });
      return { data: values.map(progressValue), total };
    },
    async progress(userId, storyId) {
      const value = await tx.readingProgress.findUnique({ where: { userId_storyId: { userId, storyId } }, select: progressSelect });
      return value ? progressValue(value) : null;
    },
    async saveProgress(userId, storyId, input, updatedAt) {
      return progressValue(await tx.readingProgress.upsert({
        where: { userId_storyId: { userId, storyId } },
        create: { userId, storyId, ...input, updatedAt }, update: { ...input, updatedAt }, select: progressSelect,
      }));
    },
    async history(userId, query) {
      const where: Prisma.ReadingHistoryWhereInput = { userId, ...published };
      const total = await tx.readingHistory.count({ where });
      const data = await tx.readingHistory.findMany({ where, select: historySelect, ...page(query), orderBy: [{ readAt: 'desc' }, { id: 'desc' }] });
      return { data, total };
    },
    recentHistory(userId, storyId, chapterId, since) {
      return tx.readingHistory.findFirst({ where: { userId, storyId, chapterId, readAt: { gte: since } }, select: historySelect, orderBy: [{ readAt: 'desc' }, { id: 'desc' }] });
    },
    addHistory(userId, storyId, chapterId, now) {
      return tx.readingHistory.create({ data: { userId, storyId, chapterId, readAt: now }, select: historySelect });
    },
    async clearHistory(userId) { return (await tx.readingHistory.deleteMany({ where: { userId } })).count; },
  };
}
export { adapter as createReadingAdapter };
export function createPrismaReadingStore(client: () => PrismaClient = getPrismaClient): ReadingStore {
  return {
    transaction(userId, mode, work) {
      return client().$transaction(async (tx) => {
        if (mode === 'write') {
          // Transaction-scoped, cross-process lock. ReadCommitted takes fresh reads
          // after a waiting writer acquires this lock; no schema changes needed.
          await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
          await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(hashtextextended(${userId}::text, 1464746310::bigint))`;
        }
        return work(adapter(tx));
      }, { isolationLevel: mode === 'write' ? 'ReadCommitted' : 'RepeatableRead', maxWait: 5000, timeout: 10000 });
    },
  };
}
export const prismaReadingStore = createPrismaReadingStore();
