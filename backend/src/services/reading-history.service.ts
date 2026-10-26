import type { ReadingQuery, ReadingStore } from '../types/reading.types';
import { readingOperations, readingPagination, publishedChapter } from './reading.service';

export const HISTORY_DEDUP_MS = 30_000;
export function createReadingHistoryService(store?: ReadingStore, clock: () => number = Date.now) {
  const run = readingOperations(store);
  return {
    list(userId: string, query: ReadingQuery) {
      return run(userId, 'read', async (tx) => readingPagination(await tx.history(userId, query), query));
    },
    record(userId: string, storyId: string, chapterId: string) {
      return run(userId, 'write', async (tx) => {
        await publishedChapter(tx, storyId, chapterId, true, userId);
        await tx.recordDailyActivity?.(userId, 'READ', chapterId);
        const now = new Date(clock());
        const previous = await tx.recentHistory(userId, storyId, chapterId, new Date(now.getTime() - HISTORY_DEDUP_MS));
        if (previous) return { data: previous, recorded: false };
        return { data: await tx.addHistory(userId, storyId, chapterId, now), recorded: true };
      });
    },
    clear(userId: string) {
      return run(userId, 'write', async (tx) => ({ deletedCount: await tx.clearHistory(userId) }));
    },
  };
}
export type ReadingHistoryService = ReturnType<typeof createReadingHistoryService>;
export const readingHistoryService = createReadingHistoryService();
