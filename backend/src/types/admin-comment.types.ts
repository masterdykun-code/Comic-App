import type { CommentStatus } from '../generated/prisma/client';
import type { FeedbackQuery, FeedbackUser } from './feedback.types';
export interface AdminCommentQuery extends FeedbackQuery { storyId?: string; status?: CommentStatus; parentId?: string; }
export interface AdminCommentEntry {
  id: string; storyId: string; parentId: string | null; content: string; status: CommentStatus;
  createdAt: Date; updatedAt: Date; user: FeedbackUser;
  story: { id: string; title: string; slug: string; publishStatus: 'DRAFT' | 'PUBLISHED' };
  parent: { id: string; status: CommentStatus; user: FeedbackUser } | null;
  replyCount: number;
}
export interface AdminCommentTransaction {
  adminIsActive(id: string): Promise<boolean>;
  list(query: AdminCommentQuery): Promise<{ data: AdminCommentEntry[]; total: number }>;
}
export interface AdminCommentStore { transaction<T>(work: (tx: AdminCommentTransaction) => Promise<T>): Promise<T>; }
