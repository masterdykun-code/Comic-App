import { getPrismaClient } from '../config/prisma';
import type { EpubBook } from './epub.parser';
import { HttpError } from '../utils/http-error';
export type EpubMetadata = {
  title: string;
  authorName: string;
  description: string;
  genreIds: string[];
  useCover: boolean;
};
export interface EpubImportStore {
  duplicate(title: string, slug: string, id: string): Promise<boolean>;
  create(
    id: string,
    actor: string,
    metadata: EpubMetadata,
    slug: string,
    coverUrl: string,
    chapters: EpubBook['chapters'],
  ): Promise<{ id: string; chapterCount: number }>;
  visibility(id: string): Promise<'DRAFT' | 'PUBLISHED' | null>;
}
export function epubSlug(title: string) {
  return (
    title
      .toLowerCase()
      .replace(/đ/g, 'd')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 160)
      .replace(/-$/, '') || 'story'
  );
}
export const prismaEpubImportStore: EpubImportStore = {
  async duplicate(title, slug, id) {
    return Boolean(
      await getPrismaClient().story.findFirst({
        where: {
          OR: [
            { id },
            { slug },
            { title: { equals: title, mode: 'insensitive' } },
          ],
        },
        select: { id: true },
      }),
    );
  },
  async create(id, actor, m, slug, coverUrl, chapters) {
    try {
      return await getPrismaClient().$transaction(
        async (tx) => {
          if (
            !(await tx.user.findFirst({
              where: { id: actor, role: 'ADMIN', status: 'ACTIVE' },
              select: { id: true },
            }))
          )
            throw new HttpError(403, 'FORBIDDEN', 'Yêu cầu ADMIN ACTIVE.');
          const lock = await tx.$queryRaw<
            Array<{ locked: boolean }>
          >`SELECT pg_try_advisory_xact_lock(1464746330,1901) AS locked`;
          if (!lock[0]?.locked)
            throw new HttpError(
              409,
              'EPUB_IMPORT_BUSY',
              'Đang có lượt nhập khác. Hãy thử lại sau.',
            );
          if (
            await tx.story.findFirst({
              where: {
                OR: [
                  { id },
                  { slug },
                  { title: { equals: m.title, mode: 'insensitive' } },
                ],
              },
              select: { id: true },
            })
          )
            throw new HttpError(
              409,
              'EPUB_DUPLICATE',
              'Truyện đã tồn tại; không ghi đè.',
            );
          if (
            m.genreIds.length &&
            (await tx.genre.count({ where: { id: { in: m.genreIds } } })) !==
              m.genreIds.length
          )
            throw new HttpError(
              400,
              'INVALID_GENRES',
              'Thể loại không hợp lệ.',
            );
          await tx.story.create({
            data: {
              id,
              title: m.title,
              authorName: m.authorName,
              description: m.description,
              slug,
              type: 'NOVEL',
              status: 'ONGOING',
              publishStatus: 'DRAFT',
              createdBy: actor,
              coverUrl,
              genres: { create: m.genreIds.map((genreId) => ({ genreId })) },
            },
          });
          // Batches keep parameter counts bounded; one transaction rolls back the entire book.
          for (let i = 0; i < chapters.length; i += 100)
            await tx.chapter.createMany({
              data: chapters
                .slice(i, i + 100)
                .map((c) => ({
                  ...c,
                  storyId: id,
                  publishStatus: 'DRAFT' as const,
                })),
            });
          return { id, chapterCount: chapters.length };
        },
        { isolationLevel: 'Serializable', timeout: 60000, maxWait: 5000 },
      );
    } catch (e) {
      const code =
        typeof e === 'object' && e !== null && 'code' in e ? e.code : undefined;
      if (code === 'P2002')
        throw new HttpError(
          409,
          'EPUB_DUPLICATE',
          'Truyện hoặc chương đã tồn tại; không ghi đè.',
        );
      if (code === 'P2034')
        throw new HttpError(
          409,
          'EPUB_IMPORT_BUSY',
          'Có thay đổi đồng thời. Kiểm tra danh sách trước khi thử lại.',
        );
      throw e;
    }
  },
  async visibility(id) {
    const row = await getPrismaClient().story.findUnique({
      where: { id },
      select: { publishStatus: true, coverUrl: true },
    });
    return row?.coverUrl.endsWith(`/api/epub-covers/${id}`)
      ? row.publishStatus
      : null;
  },
};
