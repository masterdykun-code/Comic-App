import type { StoryType } from '../generated/prisma/client';
export interface RankingQuery {
  kind: 'reads' | 'rating' | 'updated';
  type?: StoryType;
  page: number;
  limit: number;
}
export interface RankedStory {
  id: string;
  title: string;
  authorName: string;
  coverUrl: string;
  type: StoryType;
  updatedAt: Date;
  rank: number;
  readCount: number;
  averageScore: number | null;
  ratingCount: number;
}
export interface RankingStore {
  list(query: RankingQuery): Promise<{ data: RankedStory[]; total: number }>;
}
