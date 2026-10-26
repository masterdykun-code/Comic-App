import type { StoryType } from '../generated/prisma/enums';

export interface GenreStoriesQuery {
  page: number;
  limit: number;
  type?: StoryType;
}

export interface GenreLocals {
  genreId: string;
  genreStoriesQuery: GenreStoriesQuery;
}
