import type { ProgressInput, ReadingQuery, ReadingStore } from '../types/reading.types';
import { HttpError } from '../utils/http-error';
import { readingOperations, readingPagination, publishedChapter, publishedStory } from './reading.service';
import { validPublishedData } from './chapter.service';

export function createReadingProgressService(store?: ReadingStore, clock: () => number = Date.now) {
  const run = readingOperations(store);
  return {
    list(userId: string, query: ReadingQuery) {
      return run(userId, 'read', async (tx) => readingPagination(await tx.progressList(userId, query), query));
    },
    get(userId: string, storyId: string) {
      return run(userId, 'read', async (tx) => {
        const story = await publishedStory(tx, storyId, false);
        const saved = await tx.progress(userId, storyId);
        const version = saved?.updatedAt.toISOString() ?? null;
        const first = { data: null, version, resume: 'FIRST_PUBLISHED_CHAPTER' as const };
        if (!saved) return first;
        const chapter = await tx.chapter(saved.chapterId, storyId, false);
        if (!chapter || chapter.publishStatus !== 'PUBLISHED' || !validPublishedData(story, chapter)) return first;
        // An ADMIN may shorten text or replace comic pages after a save. Normalize
        // only the response, retaining the stored version for optimistic writes.
        const data = { ...saved };
        if (story.type === 'NOVEL') {
          data.textOffset = Math.min(Math.max(saved.textOffset ?? 0, 0), chapter.content!.length);
          data.pageNumber = null; data.scrollOffset = null;
        } else {
          const exists = chapter.pages.some((p) => p.pageNumber === saved.pageNumber);
          data.textOffset = null;
          data.pageNumber = exists ? saved.pageNumber : chapter.pages[0].pageNumber;
          data.scrollOffset = exists ? Math.max(saved.scrollOffset ?? 0, 0) : 0;
        }
        return { data, version, resume: 'SAVED_POSITION' as const,
          positionAdjusted: data.textOffset !== saved.textOffset || data.pageNumber !== saved.pageNumber || data.scrollOffset !== saved.scrollOffset };
      });
    },
    save(userId: string, storyId: string, input: ProgressInput) {
      return run(userId, 'write', async (tx) => {
        const { story, chapter } = await publishedChapter(tx, storyId, input.chapterId, true, userId);
        const current = await tx.progress(userId, storyId);
        if ((current?.updatedAt.toISOString() ?? null) !== input.expectedUpdatedAt) {
          throw new HttpError(409, 'PROGRESS_VERSION_CONFLICT', 'Reading position changed; reload before saving');
        }
        const invalid = () => new HttpError(400, 'INVALID_READING_POSITION', 'Invalid position for this chapter type');
        let textOffset: number | null = null; let pageNumber: number | null = null; let scrollOffset: number | null = null;
        if (story.type === 'NOVEL') {
          if (input.pageNumber != null || input.scrollOffset != null || (input.textOffset ?? 0) > chapter.content!.length) throw invalid();
          textOffset = input.textOffset ?? 0;
        } else {
          if (input.textOffset != null || input.pageNumber == null || !chapter.pages.some((p) => p.pageNumber === input.pageNumber)) throw invalid();
          pageNumber = input.pageNumber; scrollOffset = input.scrollOffset ?? 0;
        }
        const updatedAt = new Date(Math.max(clock(), (current?.updatedAt.getTime() ?? 0) + 1));
        const data = await tx.saveProgress(userId, storyId, { chapterId: input.chapterId, progressPercent: input.progressPercent, textOffset, pageNumber, scrollOffset }, updatedAt);
        return { data, version: data.updatedAt.toISOString() };
      });
    },
  };
}
export type ReadingProgressService = ReturnType<typeof createReadingProgressService>;
export const readingProgressService = createReadingProgressService();
