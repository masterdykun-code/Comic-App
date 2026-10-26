import type { CommentInput, FeedbackQuery, FeedbackStore, FeedbackTransaction } from '../types/feedback.types';
import type { CommentStatus } from '../generated/prisma/client';
import { HttpError } from '../utils/http-error';
import { feedbackActor, feedbackOperations, feedbackPage, feedbackStory, missingComment, publicComment } from './feedback.service';
import { THREAD_REPLY_LIMIT } from './feedback.store';

export function createCommentService(store?: FeedbackStore) {
  const run = feedbackOperations(store);
  async function withComment<T>(id: string, mode: 'read' | 'write', work: (tx: FeedbackTransaction, storyId: string) => Promise<T>) {
    // Resolve only identity, then re-read under the story lock. A concurrent
    // deletion between these transactions safely yields 404.
    const storyId = await run(null, 'read', (tx) => tx.commentStoryId(id));
    if (!storyId) throw missingComment();
    return run(storyId, mode, (tx) => work(tx, storyId));
  }
  return {
    list(storyId: string, query: FeedbackQuery) {
      return run(storyId, 'read', async (tx) => {
        await feedbackStory(tx, storyId, false);
        const result = await tx.roots(storyId, query);
        return feedbackPage({ ...result, data: result.data.map((root) => ({ ...publicComment(root), replies: root.replies.map(publicComment),
          repliesPagination: { page: 1, limit: THREAD_REPLY_LIMIT, total: root.replyCount, totalPages: Math.ceil(root.replyCount / THREAD_REPLY_LIMIT) } })) }, query);
      });
    },
    replies(id: string, query: FeedbackQuery) {
      return withComment(id, 'read', async (tx, storyId) => {
        await feedbackStory(tx, storyId, false);
        const root = await tx.comment(id, storyId);
        if (!root || root.status !== 'VISIBLE' || root.parentId !== null) throw missingComment();
        const result = await tx.replies(id, storyId, query);
        return feedbackPage({ ...result, data: result.data.map(publicComment) }, query);
      });
    },
    create(userId: string, storyId: string, input: CommentInput) {
      return run(storyId, 'write', async (tx) => {
        await feedbackActor(tx, userId); await feedbackStory(tx, storyId, true);
        if (input.parentId) {
          const parent = await tx.comment(input.parentId, storyId);
          if (!parent || parent.status !== 'VISIBLE') throw missingComment();
          if (parent.parentId !== null) throw new HttpError(400, 'REPLY_DEPTH_EXCEEDED', 'Replies can only target a root comment');
        }
        return publicComment(await tx.createComment(userId, storyId, input));
      });
    },
    edit(userId: string, id: string, content: string) {
      return withComment(id, 'write', async (tx, storyId) => {
        await feedbackActor(tx, userId); await feedbackStory(tx, storyId, true);
        const value = await tx.comment(id, storyId); if (!value) throw missingComment();
        if (value.userId !== userId) throw new HttpError(403, 'FORBIDDEN', 'Only the comment owner may edit it');
        const parent = value.parentId ? await tx.comment(value.parentId, storyId) : null;
        if (value.status !== 'VISIBLE' || (value.parentId && (!parent || parent.status !== 'VISIBLE'))) throw new HttpError(409, 'COMMENT_HIDDEN', 'A hidden comment or thread cannot be edited');
        return publicComment(await tx.editComment(id, content));
      });
    },
    remove(userId: string, id: string) {
      return withComment(id, 'write', async (tx, storyId) => {
        await feedbackActor(tx, userId); await feedbackStory(tx, storyId, true, false);
        const value = await tx.comment(id, storyId); if (!value) throw missingComment();
        if (value.userId !== userId) throw new HttpError(403, 'FORBIDDEN', 'Only the comment owner may delete it');
        if (await tx.replyCount(id)) throw new HttpError(409, 'COMMENT_HAS_REPLIES', 'Comments with replies cannot be deleted');
        await tx.deleteComment(id); return { removed: true };
      });
    },
    moderate(userId: string, id: string, status: CommentStatus) {
      return withComment(id, 'write', async (tx, storyId) => {
        await feedbackActor(tx, userId, true); await feedbackStory(tx, storyId, true, false);
        if (!await tx.comment(id, storyId)) throw missingComment();
        const value = await tx.moderate(id, status);
        // Moderation response confirms identity/status; hidden content is omitted.
        return { id: value.id, storyId: value.storyId, status: value.status, updatedAt: value.updatedAt };
      });
    },
  };
}
export type CommentService = ReturnType<typeof createCommentService>;
export const commentService = createCommentService();
