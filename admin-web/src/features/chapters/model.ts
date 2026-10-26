import { z } from 'zod';
import { storyId } from '../stories/model';
export const chapterInputSchema = z
  .object({
    chapterNumber: z
      .number({ error: 'Vui lòng nhập số chương hợp lệ.' })
      .int('Số chương phải là số nguyên.')
      .min(1, 'Số chương phải lớn hơn 0.')
      .max(2147483647),
    title: z
      .string()
      .trim()
      .min(1, 'Vui lòng nhập tên chương.')
      .max(200, 'Tối đa 200 ký tự.')
      .refine((v) => !v.includes('\0'), 'Tên chương không được chứa ký tự NUL.'),
    content: z
      .string()
      .max(200000, 'Nội dung tối đa 200.000 ký tự.')
      .refine((v) => !v.includes('\0'), 'Nội dung không được chứa ký tự NUL.')
      .nullable()
      .optional(),
  })
  .strict();
export type ChapterInput = z.infer<typeof chapterInputSchema>;
export interface PageInput {
  pageNumber: number;
  imageUrl: string;
  storagePublicId?: string | null;
}
export interface ChapterMetadata {
  isVip?: boolean;
  coinPrice?: number;
  id: string;
  storyId: string;
  chapterNumber: number;
  title: string;
  publishStatus: 'DRAFT' | 'PUBLISHED';
  createdAt: string;
  updatedAt: string;
}
export interface Chapter extends ChapterMetadata {
  content: string | null;
  pages: PageInput[];
  type?: 'NOVEL' | 'COMIC';
}
export interface ChapterList {
  data: ChapterMetadata[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
export interface UploadedPage {
  secureUrl: string;
  publicId: string;
  order: number;
}
export interface PageDraft {
  key: string;
  imageUrl: string;
  storagePublicId: string | null;
}
export const MiB = 1024 * 1024;
// Reserve 256 KiB for multipart boundaries/headers below the server's 50 MiB body cap.
export const batchPayloadLimit = 50 * MiB - 256 * 1024;
export function imageError(file: File) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type))
    return 'Chỉ nhận JPEG, PNG hoặc WebP; không nhận SVG.';
  if (!file.size || file.size > 10 * MiB) return 'Mỗi ảnh phải từ 1 byte đến 10 MiB.';
  return '';
}
export function makeBatches(files: File[]): File[][] {
  const batches: File[][] = [];
  let batch: File[] = [];
  let bytes = 0;
  for (const file of files) {
    if (imageError(file)) throw new Error(imageError(file));
    if (batch.length >= 20 || bytes + file.size > batchPayloadLimit) {
      batches.push(batch);
      batch = [];
      bytes = 0;
    }
    batch.push(file);
    bytes += file.size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}
export function numberedPages(pages: PageDraft[]): PageInput[] {
  return pages.map((page, index) => ({
    pageNumber: index + 1,
    imageUrl: page.imageUrl,
    storagePublicId: page.storagePublicId,
  }));
}
export function existingPages(pages: PageInput[]): PageDraft[] {
  return [...pages]
    .sort((a, b) => a.pageNumber - b.pageNumber)
    .map((p) => ({
      key: crypto.randomUUID(),
      imageUrl: p.imageUrl,
      storagePublicId: p.storagePublicId ?? null,
    }));
}
export function assertIds(story: string, chapter?: string) {
  storyId.parse(story);
  if (chapter) storyId.parse(chapter);
}
export function chapterProblem(chapter: Chapter, type: 'NOVEL' | 'COMIC', storyPublished: boolean) {
  if (!storyPublished) return 'Hãy xuất bản truyện trước khi xuất bản chương.';
  if (type === 'NOVEL' && (!chapter.content?.trim() || chapter.pages.length > 0))
    return 'Chương NOVEL cần nội dung chữ hợp lệ và không có trang ảnh.';
  if (type === 'COMIC' && (chapter.content !== null || !chapter.pages.length))
    return 'Chương COMIC cần ít nhất một trang ảnh đã lưu và không có nội dung chữ.';
  return '';
}
