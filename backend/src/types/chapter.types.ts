import type { Chapter, ChapterPage, PublishStatus, StoryType } from '../generated/prisma/client';

export interface ChapterQuery { page: number; limit: number; }
export interface ChapterCreateInput { chapterNumber: number; title: string; content?: string | null; isVip?: boolean; coinPrice?: number; }
export type ChapterUpdateInput = Partial<ChapterCreateInput>;
export interface PageInput { pageNumber: number; imageUrl: string; storagePublicId?: string | null; }
export interface ChapterStory { id: string; type: StoryType; publishStatus: PublishStatus; }
export type ChapterRecord = Chapter & { pages: ChapterPage[] };
export type ChapterMetadata = Omit<Chapter, 'content'>;

export interface ChapterTransaction {
  canReadChapter?(id: string, userId?: string): Promise<boolean>;
  adminIsActive(id: string): Promise<boolean>;
  story(id: string, lock?: boolean): Promise<ChapterStory | null>;
  chapterStoryId(id: string): Promise<string | null>;
  chapter(id: string, lock?: boolean): Promise<ChapterRecord | null>;
  list(storyId: string, query: ChapterQuery, admin: boolean): Promise<{ data: ChapterMetadata[]; total: number }>;
  create(storyId: string, input: ChapterCreateInput): Promise<ChapterRecord>;
  update(id: string, input: ChapterUpdateInput & { publishStatus?: PublishStatus }, updatedAt?: Date): Promise<ChapterRecord>;
  replacePages(id: string, pages: PageInput[], updatedAt?: Date): Promise<ChapterRecord>;
  touchStory(id: string): Promise<void>;
}
export interface ChapterStore {
  transaction<T>(work: (tx: ChapterTransaction) => Promise<T>, mode: 'read' | 'write'): Promise<T>;
}
export interface ChapterLocals {
  chapterExpectedUpdatedAt?: string;
  storyId: string;
  chapterId: string;
  chapterQuery: ChapterQuery;
  chapterInput: ChapterCreateInput | ChapterUpdateInput | { pages: PageInput[] };
}
