import type { ChapterRecord } from './chapter.types';
import type { PublishStatus, StoryType } from '../generated/prisma/client';

export interface ReadingQuery { page: number; limit: number; }
export interface ReadingStory {
  id: string; title: string; slug: string; coverUrl: string; type: StoryType; authorName: string;
}
export interface ReadingChapter { id: string; chapterNumber: number; title: string; }
export interface FavoriteEntry { id: string; storyId: string; createdAt: Date; story: ReadingStory; }
export interface ProgressInput {
  chapterId: string; progressPercent: number; expectedUpdatedAt: string | null;
  textOffset?: number | null; pageNumber?: number | null; scrollOffset?: number | null;
}
export interface ProgressPosition {
  chapterId: string; progressPercent: number; textOffset: number | null; pageNumber: number | null; scrollOffset: number | null;
}
export interface ProgressEntry extends ProgressPosition {
  id: string; storyId: string; updatedAt: Date; story: ReadingStory; chapter: ReadingChapter;
}
export interface HistoryEntry {
  id: string; storyId: string; chapterId: string; readAt: Date; story: ReadingStory; chapter: ReadingChapter;
}
export interface ReadingPage<T> { data: T[]; total: number; }
export interface ReadingTransaction {
  canReadChapter?(id: string, userId?: string): Promise<boolean>;
  recordDailyActivity?(userId: string, kind: 'READ'|'FAVORITE', targetId: string): Promise<void>;
  activeUser(userId: string): Promise<boolean>;
  story(id: string, lock: boolean): Promise<(ReadingStory & { publishStatus: PublishStatus }) | null>;
  chapter(id: string, storyId: string, lock: boolean): Promise<ChapterRecord | null>;
  favorites(userId: string, query: ReadingQuery): Promise<ReadingPage<FavoriteEntry>>;
  favoriteExists(userId: string, storyId: string): Promise<boolean>;
  addFavorite(userId: string, storyId: string): Promise<FavoriteEntry>;
  removeFavorite(userId: string, storyId: string): Promise<number>;
  progressList(userId: string, query: ReadingQuery): Promise<ReadingPage<ProgressEntry>>;
  progress(userId: string, storyId: string): Promise<ProgressEntry | null>;
  saveProgress(userId: string, storyId: string, input: ProgressPosition, updatedAt: Date): Promise<ProgressEntry>;
  history(userId: string, query: ReadingQuery): Promise<ReadingPage<HistoryEntry>>;
  recentHistory(userId: string, storyId: string, chapterId: string, since: Date): Promise<HistoryEntry | null>;
  addHistory(userId: string, storyId: string, chapterId: string, now: Date): Promise<HistoryEntry>;
  clearHistory(userId: string): Promise<number>;
}
export interface ReadingStore {
  transaction<T>(userId: string, mode: 'read' | 'write', work: (tx: ReadingTransaction) => Promise<T>): Promise<T>;
}
