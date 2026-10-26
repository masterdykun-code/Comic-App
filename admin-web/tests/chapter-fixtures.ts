import type { Story } from '../src/features/stories/model';
import type { Chapter, ChapterList } from '../src/features/chapters/model';
export const storyId = '20000000-0000-4000-8000-000000000001';
export const chapterId = '40000000-0000-4000-8000-000000000001';
export const testStory: Story = {
  id: storyId,
  title: 'Truyện kiểm thử chương',
  slug: 'truyen-test',
  type: 'NOVEL',
  authorName: 'QA Author',
  description: 'Mô tả',
  coverUrl: '',
  genres: [],
  status: 'ONGOING',
  publishStatus: 'PUBLISHED',
  createdBy: 'qa-admin',
  chapterCount: 1,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
export const testChapter: Chapter = {
  id: chapterId,
  storyId,
  chapterNumber: 1,
  title: 'Chương bình minh',
  content: 'Dòng một\n\nDòng hai',
  pages: [],
  type: 'NOVEL',
  publishStatus: 'DRAFT',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-02T00:00:00Z',
};
export const testComic: Chapter = {
  ...testChapter,
  type: 'COMIC',
  content: null,
  pages: [
    {
      pageNumber: 1,
      imageUrl: 'https://images.example.test/old-1.png',
      storagePublicId: 'old-public-1',
    },
    {
      pageNumber: 2,
      imageUrl: 'https://images.example.test/old-2.png',
      storagePublicId: 'old-public-2',
    },
  ],
};
export const chapterList: ChapterList = {
  data: [
    testChapter,
    {
      ...testChapter,
      id: '40000000-0000-4000-8000-000000000002',
      chapterNumber: 2,
      title: 'Chương xuất bản',
      publishStatus: 'PUBLISHED',
    },
  ],
  pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
};
