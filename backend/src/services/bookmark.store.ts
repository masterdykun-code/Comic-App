import { getPrismaClient } from '../config/prisma';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { createReadingAdapter } from './reading.store';
import type { BookmarkStore } from '../types/bookmark.types';
const select = {
  id: true,
  userId: true,
  storyId: true,
  chapterId: true,
  textOffset: true,
  pageNumber: true,
  chapterUpdatedAt: true,
  createdAt: true,
  story: {
    select: {
      id: true,
      title: true,
      slug: true,
      type: true,
      authorName: true,
      coverUrl: true,
      publishStatus: true,
    },
  },
  chapter: {
    select: { id: true, title: true, chapterNumber: true, publishStatus: true },
  },
} satisfies Prisma.BookmarkSelect;
export function createPrismaBookmarkStore(
  client: () => PrismaClient = getPrismaClient,
): BookmarkStore {
  return {
    transaction(userId, mode, work) {
      return client().$transaction(
        async (tx) => {
          if (mode === 'write') {
            await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
            // Same per-user lock as personal reading writes; never write progress/history here.
            await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${userId}::text, 1464746310::bigint))`;
          }
          const { activeUser, story, chapter, canReadChapter } = createReadingAdapter(tx);
          return work({
            activeUser,
            canReadChapter,
            story,
            chapter,
            find: (owner, id) =>
              tx.bookmark.findFirst({ where: { id, userId: owner }, select }),
            existing: (owner, chapterId) =>
              tx.bookmark.findUnique({
                where: { userId_chapterId: { userId: owner, chapterId } },
                select,
              }),
            async list(owner, query) {
              const where = { userId: owner };
              const total = await tx.bookmark.count({ where });
              const data = await tx.bookmark.findMany({
                where,
                select,
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                skip: (query.page - 1) * query.limit,
                take: query.limit,
              });
              return { data, total };
            },
            create: (owner, input, chapterUpdatedAt) =>
              tx.bookmark.create({
                data: { userId: owner, ...input, chapterUpdatedAt },
                select,
              }),
            async remove(owner, id) {
              return (
                await tx.bookmark.deleteMany({ where: { id, userId: owner } })
              ).count;
            },
          });
        },
        {
          isolationLevel: mode === 'write' ? 'ReadCommitted' : 'RepeatableRead',
          maxWait: 5000,
          timeout: 10000,
        },
      );
    },
  };
}
export const prismaBookmarkStore = createPrismaBookmarkStore();
