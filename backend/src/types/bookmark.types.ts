import type {
  ReadingQuery,
  ReadingTransaction,
  ReadingStory,
  ReadingChapter,
} from './reading.types';
export interface BookmarkInput {
  storyId: string;
  chapterId: string;
  textOffset?: number | null;
  pageNumber?: number | null;
}
export interface BookmarkRow {
  id: string;
  userId: string;
  storyId: string;
  chapterId: string;
  textOffset: number | null;
  pageNumber: number | null;
  chapterUpdatedAt: Date;
  createdAt: Date;
  story: ReadingStory & { publishStatus: string };
  chapter: ReadingChapter & { publishStatus: string };
}
export interface BookmarkTransaction extends Pick<
  ReadingTransaction,
  'activeUser' | 'story' | 'chapter' | 'canReadChapter'
> {
  find(userId: string, id: string): Promise<BookmarkRow | null>;
  existing(userId: string, chapterId: string): Promise<BookmarkRow | null>;
  list(
    userId: string,
    query: ReadingQuery,
  ): Promise<{ data: BookmarkRow[]; total: number }>;
  create(
    userId: string,
    input: Required<BookmarkInput>,
    chapterUpdatedAt: Date,
  ): Promise<BookmarkRow>;
  remove(userId: string, id: string): Promise<number>;
}
export interface BookmarkStore {
  transaction<T>(
    userId: string,
    mode: 'read' | 'write',
    work: (tx: BookmarkTransaction) => Promise<T>,
  ): Promise<T>;
}
