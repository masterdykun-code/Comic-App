import type { Chapter, Genre, Page, Story } from '../src/features/stories/api';
export const genre: Genre = {
  id: '10000000-0000-4000-8000-000000000001',
  name: 'Kỳ ảo',
  slug: 'ky-ao',
};
export const novel: Story = {
  id: '20000000-0000-4000-8000-000000000001',
  title: 'Những ngày xanh',
  slug: 'nhung-ngay-xanh',
  type: 'NOVEL',
  authorName: 'Tác giả kiểm thử',
  description: 'Một hành trình.\nMột khởi đầu mới.',
  coverUrl: null,
  status: 'ONGOING',
  genres: [genre],
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-02T00:00:00.000Z',
};
export const comic: Story = {
  ...novel,
  id: '20000000-0000-4000-8000-000000000002',
  title: 'Trang tranh đầu tiên',
  type: 'COMIC',
  slug: 'trang-tranh-dau-tien',
};
export const chapter: Chapter = {
  id: '30000000-0000-4000-8000-000000000001',
  storyId: novel.id,
  chapterNumber: 3,
  title: 'Khởi đầu',
  createdAt: novel.createdAt,
  updatedAt: novel.updatedAt,
};
export function result<T>(data: T[], page = 1, total = data.length, limit = 12): Page<T> {
  return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
}
