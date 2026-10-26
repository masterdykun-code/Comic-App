import type { CommentStatus, PublishStatus } from '../generated/prisma/client';

export interface FeedbackQuery { page: number; limit: number; sort: 'newest' | 'oldest'; }
export interface FeedbackUser { username: string; displayName: string; avatarUrl: string | null; }
export interface RatingInput { score: number; reviewText?: string | null; }
export interface RatingEntry extends RatingInput {
  id: string; storyId: string; reviewText: string | null; createdAt: Date; updatedAt: Date; user: FeedbackUser;
}
export interface CommentEntry {
  id: string; userId: string; storyId: string; parentId: string | null; content: string;
  status: CommentStatus; createdAt: Date; updatedAt: Date; user: FeedbackUser;
}
export interface CommentThread extends CommentEntry { replies: CommentEntry[]; replyCount: number; }
export interface CommentInput { content: string; parentId?: string | null; }
export interface FeedbackPage<T> { data: T[]; total: number; }
export interface FeedbackTransaction {
  activeUser(id: string, admin?: boolean): Promise<boolean>;
  story(id: string, lock: boolean): Promise<{ id: string; publishStatus: PublishStatus } | null>;
  ratings(storyId: string, query: FeedbackQuery): Promise<FeedbackPage<RatingEntry> & { summary: { averageScore: number | null; totalRatings: number; distribution: Record<1 | 2 | 3 | 4 | 5, number> } }>;
  saveRating(userId: string, storyId: string, input: RatingInput): Promise<RatingEntry>;
  deleteRating(userId: string, storyId: string): Promise<number>;
  roots(storyId: string, query: FeedbackQuery): Promise<FeedbackPage<CommentThread>>;
  replies(parentId: string, storyId: string, query: FeedbackQuery): Promise<FeedbackPage<CommentEntry>>;
  commentStoryId(id: string): Promise<string | null>;
  comment(id: string, storyId: string): Promise<CommentEntry | null>;
  createComment(userId: string, storyId: string, input: CommentInput): Promise<CommentEntry>;
  editComment(id: string, content: string): Promise<CommentEntry>;
  replyCount(id: string): Promise<number>;
  deleteComment(id: string): Promise<void>;
  moderate(id: string, status: CommentStatus): Promise<CommentEntry>;
}
export interface FeedbackStore {
  transaction<T>(storyId: string | null, mode: 'read' | 'write', work: (tx: FeedbackTransaction) => Promise<T>): Promise<T>;
}
