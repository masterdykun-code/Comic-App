import { getPrismaClient } from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import type { ChapterStore, ChapterTransaction } from '../types/chapter.types';

import { canReadVip } from './vip-access';
const metadata = {
  id: true, storyId: true, chapterNumber: true, title: true,
  publishStatus: true, createdAt: true, updatedAt: true, isVip: true, coinPrice: true,
} satisfies Prisma.ChapterSelect;
const full = { ...metadata, content: true, pages: { orderBy: { pageNumber: 'asc' } } } satisfies Prisma.ChapterSelect;

function adapter(tx: Prisma.TransactionClient): ChapterTransaction {
  return {
    canReadChapter: (id,userId)=>canReadVip(tx,id,userId),
    async adminIsActive(id) {
      return Boolean(await tx.user.findFirst({ where: { id, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } }));
    },
    async story(id, lock = false) {
      if (lock) await tx.$queryRaw`SELECT id FROM public.stories WHERE id = ${id}::uuid FOR UPDATE`;
      return tx.story.findUnique({ where: { id }, select: { id: true, type: true, publishStatus: true } });
    },
    async chapterStoryId(id) {
      return (await tx.chapter.findUnique({ where: { id }, select: { storyId: true } }))?.storyId ?? null;
    },
    async chapter(id, lock = false) {
      if (lock) await tx.$queryRaw`SELECT id FROM public.chapters WHERE id = ${id}::uuid FOR UPDATE`;
      return tx.chapter.findUnique({ where: { id }, select: full });
    },
    async list(storyId, query, admin) {
      const where: Prisma.ChapterWhereInput = { storyId, ...(!admin ? { publishStatus: 'PUBLISHED' } : {}) };
      const total = await tx.chapter.count({ where });
      const data = await tx.chapter.findMany({
        where, select: metadata, orderBy: [{ chapterNumber: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.limit, take: query.limit,
      });
      return { data, total };
    },
    create(storyId, input) {
      return tx.chapter.create({ data: {
        storyId, chapterNumber: input.chapterNumber, title: input.title,
        content: input.content ?? null, publishStatus: 'DRAFT', isVip: input.isVip ?? false, coinPrice: input.coinPrice ?? 10,
      }, select: full });
    },
    update(id, input, updatedAt) {
      return tx.chapter.update({ where: { id }, data: { ...input, ...(updatedAt ? { updatedAt } : {}) }, select: full });
    },
    async replacePages(id, pages, updatedAt) {
      // Deletes only this chapter's page rows, never external storage resources.
      await tx.chapterPage.deleteMany({ where: { chapterId: id } });
      if (pages.length) await tx.chapterPage.createMany({ data: pages.map((p) => ({
        chapterId: id, pageNumber: p.pageNumber, imageUrl: p.imageUrl, storagePublicId: p.storagePublicId ?? null,
      })) });
      return tx.chapter.update({ where: { id }, data: { updatedAt: updatedAt ?? new Date() }, select: full });
    },
    async touchStory(id) {
      // Parent-row update makes concurrent Serializable snapshots retry, including
      // Story type edits that inspect the chapter count.
      await tx.story.update({ where: { id }, data: { updatedAt: new Date() } });
    },
  };
}
export const prismaChapterStore: ChapterStore = {
  transaction(work, mode) {
    return getPrismaClient().$transaction((tx) => work(adapter(tx)), {
      isolationLevel: mode === 'write' ? Prisma.TransactionIsolationLevel.Serializable : Prisma.TransactionIsolationLevel.RepeatableRead,
    });
  },
};
