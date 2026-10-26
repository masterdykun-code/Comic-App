import type { Favorite, Progress, History } from '../src/features/library/api';
import { novel, chapter } from './catalog-fixtures';
const story = {
  id: novel.id,
  title: novel.title,
  slug: novel.slug,
  type: novel.type,
  coverUrl: null,
  authorName: novel.authorName,
};
const readingChapter = {
  id: chapter.id,
  chapterNumber: chapter.chapterNumber,
  title: chapter.title,
};
export const favorite: Favorite = {
  id: '40000000-0000-4000-8000-000000000001',
  storyId: novel.id,
  createdAt: novel.createdAt,
  story,
};
export const progress: Progress = {
  id: '40000000-0000-4000-8000-000000000002',
  storyId: novel.id,
  chapterId: chapter.id,
  updatedAt: novel.updatedAt,
  progressPercent: 25,
  story,
  chapter: readingChapter,
};
export const history: History = {
  id: '40000000-0000-4000-8000-000000000003',
  storyId: novel.id,
  chapterId: chapter.id,
  readAt: novel.updatedAt,
  story,
  chapter: readingChapter,
};
