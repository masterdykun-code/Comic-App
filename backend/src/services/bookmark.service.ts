import type {
  BookmarkInput,
  BookmarkRow,
  BookmarkStore,
  BookmarkTransaction,
} from '../types/bookmark.types';
import type { ReadingQuery } from '../types/reading.types';
import { HttpError } from '../utils/http-error';
import { publishedChapter, readingPagination } from './reading.service';
import { prismaBookmarkStore } from './bookmark.store';
const missing = () =>
  new HttpError(404, 'BOOKMARK_NOT_FOUND', 'Bookmark not found');
function present(row: BookmarkRow) {
  const available =
    row.story.publishStatus === 'PUBLISHED' &&
    row.chapter.publishStatus === 'PUBLISHED';
  const {
    userId: _userId,
    chapterUpdatedAt: _snapshot,
    story,
    chapter,
    ...bookmark
  } = row;
  return {
    ...bookmark,
    available,
    story: available
      ? {
          id: story.id,
          title: story.title,
          slug: story.slug,
          type: story.type,
          authorName: story.authorName,
          coverUrl: story.coverUrl,
        }
      : null,
    chapter: available
      ? {
          id: chapter.id,
          title: chapter.title,
          chapterNumber: chapter.chapterNumber,
        }
      : null,
  };
}
export function createBookmarkService(
  store: BookmarkStore = prismaBookmarkStore,
) {
  async function run<T>(
    userId: string,
    mode: 'read' | 'write',
    work: (tx: BookmarkTransaction) => Promise<T>,
  ) {
    try {
      return await store.transaction(userId, mode, async (tx) => {
        if (!(await tx.activeUser(userId)))
          throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
        return work(tx);
      });
    } catch (e) {
      const code = (e as { code?: string })?.code;
      if (code === 'P2003' || code === 'P2025') throw missing();
      if (
        ['P2002', 'P2034', 'P2028', '55P03'].includes(code ?? '') ||
        (code === 'P2010' &&
          (e as { meta?: { code?: string } }).meta?.code === '55P03')
      )
        throw new HttpError(
          409,
          'BOOKMARK_BUSY',
          'Bookmark changed concurrently; check your list before retrying',
        );
      throw e;
    }
  }
  return {
    list(userId: string, query: ReadingQuery) {
      return run(userId, 'read', async (tx) => {
        const result = await tx.list(userId, query);
        return readingPagination(
          { ...result, data: result.data.map(present) },
          query,
        );
      });
    },
    add(userId: string, input: BookmarkInput) {
      return run(userId, 'write', async (tx) => {
        const { story, chapter } = await publishedChapter(
          tx,
          input.storyId,
          input.chapterId,
          true,
          userId,
        );
        let textOffset: number | null = null,
          pageNumber: number | null = null;
        if (story.type === 'NOVEL') {
          if (
            input.pageNumber != null ||
            (input.textOffset ?? 0) > chapter.content!.length
          )
            throw new HttpError(
              400,
              'INVALID_BOOKMARK_POSITION',
              'Invalid text position',
            );
          textOffset = input.textOffset ?? 0;
        } else {
          if (input.textOffset != null)
            throw new HttpError(
              400,
              'INVALID_BOOKMARK_POSITION',
              'Invalid comic position',
            );
          pageNumber = input.pageNumber ?? chapter.pages[0]!.pageNumber;
          if (!chapter.pages.some((p) => p.pageNumber === pageNumber))
            throw new HttpError(
              400,
              'INVALID_BOOKMARK_POSITION',
              'Page does not exist',
            );
        }
        const existing = await tx.existing(userId, chapter.id);
        if (existing) return { data: present(existing), created: false };
        const row = await tx.create(
          userId,
          { storyId: story.id, chapterId: chapter.id, textOffset, pageNumber },
          chapter.updatedAt,
        );
        return { data: present(row), created: true };
      });
    },
    resolve(userId: string, id: string) {
      return run(userId, 'read', async (tx) => {
        const row = await tx.find(userId, id);
        if (!row) throw missing();
        const { story, chapter } = await publishedChapter(
          tx,
          row.storyId,
          row.chapterId,
          false,
          userId,
        );
        const textOffset =
          story.type === 'NOVEL'
            ? Math.min(
                Math.max(row.textOffset ?? 0, 0),
                chapter.content!.length,
              )
            : null;
        const pageNumber =
          story.type === 'COMIC'
            ? chapter.pages.some((p) => p.pageNumber === row.pageNumber)
              ? row.pageNumber
              : chapter.pages[0]!.pageNumber
            : null;
        return {
          ...present(row),
          textOffset,
          pageNumber,
          positionAdjusted:
            row.chapterUpdatedAt.getTime() !== chapter.updatedAt.getTime() ||
            row.textOffset !== textOffset ||
            row.pageNumber !== pageNumber,
        };
      });
    },
    remove(userId: string, id: string) {
      return run(userId, 'write', async (tx) => {
        if (!(await tx.remove(userId, id))) throw missing();
        return { removed: true };
      });
    },
  };
}
export type BookmarkService = ReturnType<typeof createBookmarkService>;
export const bookmarkService = createBookmarkService();
