import type { ReadingPage, ReadingQuery, ReadingStore, ReadingTransaction } from '../types/reading.types';
import { HttpError } from '../utils/http-error';
import { prismaReadingStore } from './reading.store';
import { validPublishedData } from './chapter.service';

export function readingOperations(store: ReadingStore = prismaReadingStore) {
  return async function run<T>(userId: string, mode: 'read' | 'write', work: (tx: ReadingTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return await store.transaction(userId, mode, async (tx) => {
          if (!await tx.activeUser(userId)) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
          return work(tx);
        });
      } catch (error) {
        const e = error as { code?: string; meta?: { code?: string } };
        if (e?.code === 'P2034' && attempt < 2) continue;
        if (e?.code === 'P2002') throw new HttpError(409, 'READING_CONFLICT', 'Concurrent reading update; reload and retry');
        if (e?.code === 'P2003' || e?.code === 'P2025') throw new HttpError(404, 'READING_RESOURCE_NOT_FOUND', 'Reading resource not found');
        if (e?.code === 'P2034' || e?.code === 'P2028' || e?.code === '55P03' || (e?.code === 'P2010' && e.meta?.code === '55P03')) {
          throw new HttpError(409, 'READING_BUSY', 'Reading data is busy; reload and retry');
        }
        throw error;
      }
    }
    throw new HttpError(409, 'READING_BUSY', 'Reload and retry');
  };
}
export async function publishedStory(tx: Pick<ReadingTransaction, 'story'>, storyId: string, lock: boolean) {
  const story = await tx.story(storyId, lock);
  if (!story || story.publishStatus !== 'PUBLISHED') throw new HttpError(404, 'STORY_NOT_FOUND', 'Story not found');
  return story;
}
export async function publishedChapter(tx: Pick<ReadingTransaction, 'story' | 'chapter' | 'canReadChapter'>, storyId: string, chapterId: string, lock: boolean, userId?: string) {
  const story = await publishedStory(tx, storyId, lock);
  const chapter = await tx.chapter(chapterId, storyId, lock);
  if (!chapter || chapter.publishStatus !== 'PUBLISHED' || !validPublishedData(story, chapter)) {
    throw new HttpError(404, 'CHAPTER_NOT_FOUND', 'Chapter not found');
  }
  if(chapter.isVip && !await tx.canReadChapter?.(chapter.id,userId)) throw new HttpError(402,'CHAPTER_LOCKED','Unlock this VIP chapter first');
  return { story, chapter };
}
export function readingPagination<T>(result: ReadingPage<T>, query: ReadingQuery) {
  return { data: result.data, pagination: { ...query, total: result.total, totalPages: Math.ceil(result.total / query.limit) } };
}
