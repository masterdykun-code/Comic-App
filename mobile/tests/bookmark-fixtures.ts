import type { Bookmark, ResolvedBookmark } from '../src/features/bookmarks/api';
import { novel, comic, chapter } from './catalog-fixtures';
export const novelBookmark: Bookmark = {
  id: '40000000-0000-4000-8000-000000000001',
  storyId: novel.id,
  chapterId: chapter.id,
  textOffset: 900,
  pageNumber: null,
  available: true,
  createdAt: '2026-10-24T00:00:00Z',
  story: {
    id: novel.id,
    title: novel.title,
    slug: novel.slug,
    authorName: novel.authorName,
    coverUrl: novel.coverUrl,
    type: 'NOVEL',
  },
  chapter: { id: chapter.id, title: 'Đoạn văn đã đánh dấu', chapterNumber: 3 },
};
export const comicBookmark: Bookmark = {
  ...novelBookmark,
  id: '40000000-0000-4000-8000-000000000002',
  storyId: comic.id,
  chapterId: '30000000-0000-4000-8000-000000000002',
  textOffset: null,
  pageNumber: 3,
  story: {
    id: comic.id,
    title: comic.title,
    slug: comic.slug,
    authorName: comic.authorName,
    coverUrl: null,
    type: 'COMIC',
  },
  chapter: {
    id: '30000000-0000-4000-8000-000000000002',
    title: 'Trang ảnh đã đánh dấu',
    chapterNumber: 1,
  },
};
export const resolvedNovel: ResolvedBookmark = { ...novelBookmark, positionAdjusted: false };
