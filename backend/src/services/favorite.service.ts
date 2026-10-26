import type { ReadingQuery, ReadingStore } from '../types/reading.types';
import { HttpError } from '../utils/http-error';
import { readingOperations, readingPagination, publishedStory } from './reading.service';

export function createFavoriteService(store?: ReadingStore) {
  const run = readingOperations(store);
  return {
    list(userId: string, query: ReadingQuery) {
      return run(userId, 'read', async (tx) => readingPagination(await tx.favorites(userId, query), query));
    },
    add(userId: string, storyId: string) {
      return run(userId, 'write', async (tx) => {
        await publishedStory(tx, storyId, true);
        if (await tx.favoriteExists(userId, storyId)) throw new HttpError(409, 'FAVORITE_EXISTS', 'Story is already in favorites');
        const favorite = await tx.addFavorite(userId, storyId);
        await tx.recordDailyActivity?.(userId, 'FAVORITE', storyId);
        return favorite;
      });
    },
    remove(userId: string, storyId: string) {
      return run(userId, 'write', async (tx) => ({ removed: (await tx.removeFavorite(userId, storyId)) > 0 }));
    },
  };
}
export type FavoriteService = ReturnType<typeof createFavoriteService>;
export const favoriteService = createFavoriteService();
