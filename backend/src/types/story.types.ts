import type { Story, StoryStatus, StoryType, PublishStatus } from '../generated/prisma/client';

export interface StoryListQuery {
  page: number;
  limit: number;
  search?: string;
  type?: StoryType;
  genreId?: string;
  status?: StoryStatus;
  sort: 'newest' | 'updated' | 'title';
  publishStatus?: PublishStatus;
}

export interface StoryCreateInput {
  title: string;
  type: StoryType;
  authorName: string;
  description?: string;
  coverUrl?: string;
  status?: StoryStatus;
  genreIds?: string[];
}
export type StoryUpdateInput = Partial<StoryCreateInput>;
export type StoryDeleteInput = { confirm: true; expectedUpdatedAt: string };
export type StoryRecord = Story & {
  genres: Array<{ id: string; name: string; slug: string }>;
  chapterCount: number;
};
export type StoryCreateData = Required<Omit<StoryCreateInput, 'genreIds'>> & { slug: string; createdBy: string };
export type StoryUpdateData = Partial<Omit<StoryCreateData, 'slug' | 'createdBy'>> & { publishStatus?: PublishStatus };

export interface StoryTransaction {
  adminIsActive(userId: string): Promise<boolean>;
  list(query: StoryListQuery, admin: boolean): Promise<{ data: StoryRecord[]; total: number }>;
  find(id: string, lock?: boolean): Promise<StoryRecord | null>;
  genresExist(ids: string[]): Promise<boolean>;
  create(data: StoryCreateData, genreIds: string[]): Promise<StoryRecord>;
  update(id: string, data: StoryUpdateData, genreIds?: string[]): Promise<StoryRecord>;
  remove(id: string): Promise<void>;
}

export interface StoryStore {
  transaction<T>(work: (tx: StoryTransaction) => Promise<T>, mode: 'read' | 'write'): Promise<T>;
}

export interface StoryLocals {
  storyId: string;
  storyQuery: StoryListQuery;
  storyInput: StoryCreateInput | StoryUpdateInput;
  storyDeleteInput: StoryDeleteInput;
}
