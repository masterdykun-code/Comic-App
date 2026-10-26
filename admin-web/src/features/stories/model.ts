import { z } from 'zod';

export const storyId = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i);
const webUrl = z
  .string()
  .trim()
  .max(2048)
  .refine((s) => {
    if (!s) return true;
    try {
      return ['http:', 'https:'].includes(new URL(s).protocol);
    } catch {
      return false;
    }
  }, 'Nhập URL ảnh HTTP hoặc HTTPS hợp lệ.');
export const storyFormSchema = z
  .object({
    title: z.string().trim().min(1, 'Vui lòng nhập tên truyện.').max(200, 'Tối đa 200 ký tự.'),
    type: z.enum(['NOVEL', 'COMIC']),
    authorName: z.string().trim().min(1, 'Vui lòng nhập tác giả.').max(100, 'Tối đa 100 ký tự.'),
    description: z.string().trim().max(10000, 'Tối đa 10.000 ký tự.'),
    coverUrl: webUrl,
    genreIds: z
      .array(storyId)
      .max(50, 'Tối đa 50 thể loại.')
      .refine((ids) => new Set(ids).size === ids.length),
    status: z.enum(['ONGOING', 'COMPLETED']),
  })
  .strict();
export type StoryInput = z.infer<typeof storyFormSchema>;
export interface Genre {
  id: string;
  name: string;
  slug: string;
}
export interface Story extends Omit<StoryInput, 'genreIds'> {
  id: string;
  slug: string;
  genres: Genre[];
  publishStatus: 'DRAFT' | 'PUBLISHED';
  createdBy: string;
  chapterCount: number;
  createdAt: string;
  updatedAt: string;
}
export interface StoryQuery {
  page: number;
  limit: number;
  search?: string;
  type?: Story['type'];
  genreId?: string;
  status?: Story['status'];
  publishStatus?: Story['publishStatus'];
  sort?: 'newest' | 'updated' | 'title';
}
export interface StoryList {
  data: Story[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
export interface CoverUpload {
  secureUrl: string;
  publicId: string;
}
export const maxCoverSize = 5 * 1024 * 1024;
export function coverFileError(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return 'Chỉ chấp nhận JPEG, PNG hoặc WebP. Không chấp nhận SVG.';
  if (!file.size || file.size > maxCoverSize) return 'Ảnh phải có dung lượng từ 1 byte đến 5 MiB.';
  return '';
}
export const defaults: StoryInput = {
  title: '',
  type: 'NOVEL',
  authorName: '',
  description: '',
  coverUrl: '',
  genreIds: [],
  status: 'ONGOING',
};
export function publicationIssues(
  story: Pick<StoryInput, 'description' | 'coverUrl'> & { genres: Genre[] },
) {
  return [
    !story.description.trim() && 'mô tả',
    !story.coverUrl && 'ảnh bìa',
    !story.genres.length && 'ít nhất một thể loại',
  ]
    .filter(Boolean)
    .join(', ');
}
export const labels = {
  NOVEL: 'Tiểu thuyết',
  COMIC: 'Truyện tranh',
  ONGOING: 'Đang ra',
  COMPLETED: 'Hoàn thành',
  DRAFT: 'Bản nháp',
  PUBLISHED: 'Đã xuất bản',
};
export function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? '—'
    : new Intl.DateTimeFormat('vi-VN', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}
