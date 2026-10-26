import type { CommentEntry, FeedbackPage, FeedbackQuery, FeedbackStore, FeedbackTransaction } from '../types/feedback.types';
import { HttpError } from '../utils/http-error';
import { prismaFeedbackStore } from './feedback.store';

export function feedbackOperations(store: FeedbackStore = prismaFeedbackStore) {
  return async function run<T>(storyId: string | null, mode: 'read' | 'write', work: (tx: FeedbackTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await store.transaction(storyId, mode, work); }
      catch (error) {
        const e = error as { code?: string; meta?: { code?: string } };
        if (e?.code === 'P2034' && attempt < 2) continue;
        if (['P2002', 'P2003', 'P2034', 'P2028', '55P03'].includes(e?.code ?? '') || (e?.code === 'P2010' && e.meta?.code === '55P03')) {
          throw new HttpError(409, 'FEEDBACK_CONFLICT', 'Feedback changed concurrently; reload and retry');
        }
        if (e?.code === 'P2025') throw missingComment();
        throw error;
      }
    }
    throw new HttpError(409, 'FEEDBACK_CONFLICT', 'Reload and retry');
  };
}
export const missingComment = () => new HttpError(404, 'COMMENT_NOT_FOUND', 'Comment not found');
export async function feedbackStory(tx: FeedbackTransaction, storyId: string, lock: boolean, published = true) {
  const story = await tx.story(storyId, lock);
  if (!story || (published && story.publishStatus !== 'PUBLISHED')) throw new HttpError(404, 'STORY_NOT_FOUND', 'Story not found');
  return story;
}
export async function feedbackActor(tx: FeedbackTransaction, userId: string, admin = false) {
  if (!await tx.activeUser(userId, admin)) throw new HttpError(admin ? 403 : 401, admin ? 'FORBIDDEN' : 'UNAUTHORIZED', admin ? 'An active ADMIN account is required' : 'Authentication required');
}
export function publicComment(value: CommentEntry) {
  const { id, storyId, parentId, content, createdAt, updatedAt, user } = value;
  return { id, storyId, parentId, content, createdAt, updatedAt, user };
}
export function feedbackPage<T>(result: FeedbackPage<T>, query: FeedbackQuery) {
  return { data: result.data, pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } };
}
