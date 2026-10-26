import type { ReaderChapter, Position, ProgressSnapshot } from '../src/features/reader/api';
import { chapter, novel } from './catalog-fixtures';
export const novelChapter: ReaderChapter = {
  ...chapter,
  type: 'NOVEL',
  content: 'Dòng thứ nhất.\nDòng thứ hai.\n\nMột đoạn mới.',
};
export const comicChapter: ReaderChapter = {
  ...chapter,
  type: 'COMIC',
  pages: [1, 3, 7].map((pageNumber) => ({
    pageNumber,
    imageUrl: `https://images.example.invalid/page-${pageNumber}.png`,
  })),
};
export const position: Position = {
  chapterId: chapter.id,
  textOffset: 10,
  pageNumber: null,
  scrollOffset: null,
  progressPercent: 25,
};
export const emptyProgress: ProgressSnapshot = { data: null, version: null };
export const savedProgress: ProgressSnapshot = {
  data: { storyId: novel.id, ...position },
  version: '2026-10-18T00:00:00.000Z',
};
