import type { FeedbackQuery, FeedbackStore, RatingInput } from '../types/feedback.types';
import { feedbackActor, feedbackOperations, feedbackPage, feedbackStory } from './feedback.service';

export function createRatingService(store?: FeedbackStore) {
  const run = feedbackOperations(store);
  return {
    list(storyId: string, query: FeedbackQuery) {
      return run(storyId, 'read', async (tx) => {
        await feedbackStory(tx, storyId, false);
        const result = await tx.ratings(storyId, query);
        return { ...feedbackPage(result, query), summary: result.summary };
      });
    },
    save(userId: string, storyId: string, input: RatingInput) {
      return run(storyId, 'write', async (tx) => {
        await feedbackActor(tx, userId); await feedbackStory(tx, storyId, true);
        return tx.saveRating(userId, storyId, input);
      });
    },
    remove(userId: string, storyId: string) {
      return run(storyId, 'write', async (tx) => {
        await feedbackActor(tx, userId);
        // Owner may remove a rating even if its story has since been unpublished.
        await feedbackStory(tx, storyId, true, false);
        return { removed: (await tx.deleteRating(userId, storyId)) > 0 };
      });
    },
  };
}
export type RatingService = ReturnType<typeof createRatingService>;
export const ratingService = createRatingService();
