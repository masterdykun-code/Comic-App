import type { ReaderChapter, SavedProgress } from '../reader/api';
import { comicPosition, novelPosition } from '../reader/positions';
import type { ResolvedBookmark } from './api';
import { ApiError } from '../../lib/errors';
export function bookmarkPosition(
  bookmark: ResolvedBookmark,
  chapter: ReaderChapter,
): SavedProgress {
  if (bookmark.storyId !== chapter.storyId || bookmark.chapterId !== chapter.id)
    throw new ApiError(404, 'Dấu trang không thuộc chương này.');
  const index =
    chapter.type === 'COMIC'
      ? Math.max(
          0,
          chapter.pages.findIndex((p) => p.pageNumber === bookmark.pageNumber),
        )
      : 0;
  return {
    storyId: chapter.storyId,
    ...(chapter.type === 'NOVEL'
      ? novelPosition(chapter.id, bookmark.textOffset ?? 0, chapter.content.length)
      : comicPosition(chapter.id, chapter.pages[index].pageNumber, index, chapter.pages.length)),
  };
}
