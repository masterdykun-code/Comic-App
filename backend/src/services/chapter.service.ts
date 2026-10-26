import { novelContentSchema, pageInputSchema } from '../middlewares/chapter.validation';
import type { ChapterCreateInput, ChapterQuery, ChapterRecord, ChapterStore, ChapterStory, ChapterTransaction, ChapterUpdateInput, PageInput } from '../types/chapter.types';
import { HttpError } from '../utils/http-error';
import { isTransactionConflict } from '../utils/transaction-conflict';
import { prismaChapterStore } from './chapter.store';

const missingChapter = () => new HttpError(404, 'CHAPTER_NOT_FOUND', 'Chapter not found');
const missingStory = () => new HttpError(404, 'STORY_NOT_FOUND', 'Story not found');
export function validPublishedData(story: ChapterStory, chapter: ChapterRecord) {
  if (story.type === 'NOVEL') return typeof chapter.content === 'string' && chapter.content.trim().length > 0 &&
    novelContentSchema.safeParse(chapter.content).success && chapter.pages.length === 0;
  return chapter.content === null && chapter.pages.length > 0 && chapter.pages.every((p) => pageInputSchema.safeParse({
    pageNumber: p.pageNumber, imageUrl: p.imageUrl, storagePublicId: p.storagePublicId,
  }).success) && new Set(chapter.pages.map((p) => p.pageNumber)).size === chapter.pages.length;
}
function assertValidPublishedData(story: ChapterStory, chapter: ChapterRecord) {
  if (!validPublishedData(story, chapter)) throw new HttpError(400, 'CHAPTER_NOT_PUBLISHABLE', 'NOVEL requires nonblank text without image pages; COMIC requires image pages without text');
}
function adminResult(chapter: ChapterRecord) {
  return { ...chapter, pages: [...chapter.pages].sort((a, b) => a.pageNumber - b.pageNumber) };
}
function assertVersion(chapter: ChapterRecord, expectedUpdatedAt?: string) {
  if (expectedUpdatedAt !== undefined && new Date(expectedUpdatedAt).getTime() !== chapter.updatedAt.getTime()) {
    throw new HttpError(409, 'CHAPTER_STALE', 'Chapter has changed; reload before saving');
  }
}
// Timestamp(3) must advance even for writes within one millisecond or clock rollback.
function nextVersion(chapter: ChapterRecord) {
  return new Date(Math.max(Date.now(), chapter.updatedAt.getTime() + 1));
}

export function createChapterService(store: ChapterStore = prismaChapterStore) {
  async function write<T>(actorId: string, work: (tx: ChapterTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await store.transaction(async (tx) => {
          if (!await tx.adminIsActive(actorId)) throw new HttpError(403, 'FORBIDDEN', 'An active ADMIN account is required');
          return work(tx);
        }, 'write');
      } catch (error) {
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        if (isTransactionConflict(error) && attempt < 4) continue;
        if (isTransactionConflict(error)) throw new HttpError(409, 'CHAPTER_WRITE_CONFLICT', 'Concurrent chapter update conflict; please retry');
        if (code === 'P2002') throw new HttpError(409, 'CHAPTER_NUMBER_CONFLICT', 'Chapter number is already in use in this story');
        if (code === 'P2025' || code === 'P2003') throw missingChapter();
        throw error;
      }
    }
    throw new HttpError(409, 'CHAPTER_WRITE_CONFLICT', 'Please retry');
  }
  async function lockedChapter(tx: ChapterTransaction, id: string) {
    const storyId = await tx.chapterStoryId(id);
    if (!storyId) throw missingChapter();
    // All write paths acquire parent before child, avoiding inverse lock order.
    const story = await tx.story(storyId, true);
    if (!story) throw missingStory();
    const chapter = await tx.chapter(id, true);
    if (!chapter || chapter.storyId !== story.id) throw missingChapter();
    return { story, chapter };
  }
  return {
    async adminRead(id: string, adminId: string) {
      return store.transaction(async (tx) => {
        if (!await tx.adminIsActive(adminId)) throw new HttpError(403, 'FORBIDDEN', 'An active ADMIN account is required');
        const chapter = await tx.chapter(id);
        if (!chapter) throw missingChapter();
        const story = await tx.story(chapter.storyId);
        if (!story) throw missingStory();
        return { ...adminResult(chapter), type: story.type };
      }, 'read');
    },
    async list(storyId: string, query: ChapterQuery, adminId?: string) {
      return store.transaction(async (tx) => {
        if (adminId && !await tx.adminIsActive(adminId)) throw new HttpError(403, 'FORBIDDEN', 'An active ADMIN account is required');
        const story = await tx.story(storyId);
        if (!story || (!adminId && story.publishStatus !== 'PUBLISHED')) throw missingStory();
        const { data, total } = await tx.list(storyId, query, Boolean(adminId));
        return {
          data: adminId ? data : data.map(({ publishStatus: _status, ...metadata }) => metadata),
          pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
        };
      }, 'read');
    },
    async read(id: string, userId?: string) {
      return store.transaction(async (tx) => {
        const chapter = await tx.chapter(id);
        if (!chapter || chapter.publishStatus !== 'PUBLISHED') throw missingChapter();
        const story = await tx.story(chapter.storyId);
        if (!story || story.publishStatus !== 'PUBLISHED' || !validPublishedData(story, chapter)) throw missingChapter();
        if (chapter.isVip && !await tx.canReadChapter?.(id,userId)) throw new HttpError(402, 'CHAPTER_LOCKED', 'Unlock this VIP chapter with coins');
        const { id: chapterId, storyId, chapterNumber, title, createdAt, updatedAt } = chapter;
        return { id: chapterId, storyId, chapterNumber, title, type: story.type, createdAt, updatedAt,
          ...(story.type === 'NOVEL' ? { content: chapter.content } : {
            pages: [...chapter.pages].sort((a, b) => a.pageNumber - b.pageNumber).map(({ pageNumber, imageUrl }) => ({ pageNumber, imageUrl })),
          }),
        };
      }, 'read');
    },
    create(actorId: string, storyId: string, input: ChapterCreateInput) {
      return write(actorId, async (tx) => {
        const story = await tx.story(storyId, true);
        if (!story) throw missingStory();
        if (story.type === 'COMIC' && input.content !== undefined) throw new HttpError(400, 'COMIC_TEXT_FORBIDDEN', 'COMIC chapters do not accept content');
        const chapter = await tx.create(storyId, input);
        await tx.touchStory(storyId);
        return adminResult(chapter);
      });
    },
    update(actorId: string, id: string, input: ChapterUpdateInput, expectedUpdatedAt?: string) {
      return write(actorId, async (tx) => {
        const { story, chapter } = await lockedChapter(tx, id);
        assertVersion(chapter, expectedUpdatedAt);
        if (story.type === 'COMIC' && input.content !== undefined) throw new HttpError(400, 'COMIC_TEXT_FORBIDDEN', 'COMIC chapters do not accept content');
        const updated = await tx.update(chapter.id, input, nextVersion(chapter));
        if (updated.publishStatus === 'PUBLISHED') assertValidPublishedData(story, updated);
        await tx.touchStory(story.id);
        return adminResult(updated);
      });
    },
    replacePages(actorId: string, id: string, pages: PageInput[], expectedUpdatedAt?: string) {
      return write(actorId, async (tx) => {
        const { story, chapter } = await lockedChapter(tx, id);
        assertVersion(chapter, expectedUpdatedAt);
        if (story.type !== 'COMIC') throw new HttpError(400, 'NOVEL_PAGES_FORBIDDEN', 'Image pages are only supported for COMIC');
        if (chapter.publishStatus === 'PUBLISHED' && pages.length === 0) throw new HttpError(400, 'CHAPTER_NOT_PUBLISHABLE', 'Published COMIC must retain at least one page');
        const updated = await tx.replacePages(id, [...pages].sort((a, b) => a.pageNumber - b.pageNumber), nextVersion(chapter));
        if (updated.publishStatus === 'PUBLISHED') assertValidPublishedData(story, updated);
        await tx.touchStory(story.id);
        return adminResult(updated);
      });
    },
    publish(actorId: string, id: string, expectedUpdatedAt?: string) {
      return write(actorId, async (tx) => {
        const { story, chapter } = await lockedChapter(tx, id);
        assertVersion(chapter, expectedUpdatedAt);
        if (story.publishStatus !== 'PUBLISHED') throw new HttpError(409, 'STORY_NOT_PUBLISHED', 'Publish the parent story before publishing its chapters');
        assertValidPublishedData(story, chapter);
        if (chapter.publishStatus === 'PUBLISHED') return adminResult(chapter);
        const updated = await tx.update(id, { publishStatus: 'PUBLISHED' }, nextVersion(chapter));
        await tx.touchStory(story.id);
        return adminResult(updated);
      });
    },
  };
}
export type ChapterService = ReturnType<typeof createChapterService>;
export const chapterService = createChapterService();
