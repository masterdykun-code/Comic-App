import { getPrismaClient } from '../config/prisma';
import { Prisma, type PrismaClient } from '../generated/prisma/client';
import type { StoryRecord, StoryStore, StoryTransaction } from '../types/story.types';

const select = {
  id: true, title: true, slug: true, type: true, authorName: true, description: true,
  coverUrl: true, status: true, publishStatus: true, createdBy: true, createdAt: true, updatedAt: true,
  genres: { select: { genre: { select: { id: true, name: true, slug: true } } }, orderBy: { genre: { name: 'asc' } } },
  _count: { select: { chapters: true } },
} satisfies Prisma.StorySelect;
type Selected = Prisma.StoryGetPayload<{ select: typeof select }>;
function record(row: Selected): StoryRecord {
  const { genres, _count, ...story } = row;
  return { ...story, genres: genres.map((link) => link.genre), chapterCount: _count.chapters };
}

function transactionAdapter(tx: Prisma.TransactionClient): StoryTransaction {
  return {
    async adminIsActive(id) {
      return Boolean(await tx.user.findFirst({ where: { id, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } }));
    },
    async list(query, admin) {
      const where: Prisma.StoryWhereInput = {
        publishStatus: admin ? query.publishStatus : 'PUBLISHED',
        ...(query.search ? { title: { contains: query.search.replace(/[\\%_]/g, '\\$&'), mode: 'insensitive' } } : {}),
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
        ...(query.genreId ? { genres: { some: { genreId: query.genreId } } } : {}),
      };
      const orderBy: Prisma.StoryOrderByWithRelationInput[] = [
        query.sort === 'title' ? { title: 'asc' } : query.sort === 'updated' ? { updatedAt: 'desc' } : { createdAt: 'desc' },
        { id: 'asc' },
      ];
      const total = await tx.story.count({ where });
      const rows = await tx.story.findMany({ where, select, orderBy, skip: (query.page - 1) * query.limit, take: query.limit });
      return { data: rows.map(record), total };
    },
    async find(id, lock = false) {
      if (lock) await tx.$queryRaw`SELECT id FROM public.stories WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.story.findUnique({ where: { id }, select });
      return row ? record(row) : null;
    },
    async genresExist(ids) {
      return !ids.length || await tx.genre.count({ where: { id: { in: ids } } }) === ids.length;
    },
    async create(data, genreIds) {
      return record(await tx.story.create({ data: {
        ...data, publishStatus: 'DRAFT', genres: { create: genreIds.map((genreId) => ({ genreId })) },
      }, select }));
    },
    async update(id, data, genreIds) {
      return record(await tx.story.update({ where: { id }, data: {
        ...data,
        ...(genreIds !== undefined ? { genres: { deleteMany: {}, create: genreIds.map((genreId) => ({ genreId })) } } : {}),
      }, select }));
    },
    async remove(id) {
      // Caller holds Story FOR UPDATE. These changes all share the outer transaction.
      await tx.comment.updateMany({ where: { storyId: id, parentId: { not: null } }, data: { parentId: null } });
      await tx.comment.deleteMany({ where: { storyId: id } });
      await tx.rating.deleteMany({ where: { storyId: id } });
      await tx.favorite.deleteMany({ where: { storyId: id } });
      await tx.bookmark.deleteMany({ where: { storyId: id } });
      await tx.readingHistory.deleteMany({ where: { storyId: id } });
      await tx.readingProgress.deleteMany({ where: { storyId: id } });
      await tx.chapterPage.deleteMany({ where: { chapter: { storyId: id } } });
      await tx.chapter.deleteMany({ where: { storyId: id } });
      await tx.storyGenre.deleteMany({ where: { storyId: id } });
      await tx.story.delete({ where: { id } });
      // Genre, User, Cloudinary images and local cover files are deliberately retained.
    },
  };
}

export function createPrismaStoryStore(client: () => PrismaClient = getPrismaClient): StoryStore {
  return {
    transaction(work, mode) {
      return client().$transaction((tx) => work(transactionAdapter(tx)), {
        isolationLevel: mode === 'write' ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.RepeatableRead,
      });
    },
  };
}
export const prismaStoryStore = createPrismaStoryStore();
