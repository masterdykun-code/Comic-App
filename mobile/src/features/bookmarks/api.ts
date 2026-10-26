import { z } from 'zod';
import type { AxiosInstance } from 'axios';
import { api } from '../../services/runtime';
import { ApiError } from '../../lib/errors';
import { isUuid } from '../stories/api';
const uuid = z.string().refine(isUuid),
  date = z.iso.datetime({ offset: true });
const story = z.object({
  id: uuid,
  title: z.string(),
  slug: z.string(),
  type: z.enum(['NOVEL', 'COMIC']),
  authorName: z.string(),
  coverUrl: z.string().nullable(),
});
const chapter = z.object({
  id: uuid,
  title: z.string(),
  chapterNumber: z.number().int().positive(),
});
const entry = z
  .object({
    id: uuid,
    storyId: uuid,
    chapterId: uuid,
    createdAt: date,
    textOffset: z.number().int().min(0).max(2147483647).nullable(),
    pageNumber: z.number().int().positive().max(2147483647).nullable(),
    available: z.boolean(),
    story: story.nullable(),
    chapter: chapter.nullable(),
  })
  .refine((r) =>
    r.available
      ? r.story?.id === r.storyId &&
        r.chapter?.id === r.chapterId &&
        (r.story.type === 'NOVEL'
          ? r.textOffset !== null && r.pageNumber === null
          : r.pageNumber !== null && r.textOffset === null)
      : r.story === null && r.chapter === null,
  );
export type Bookmark = z.output<typeof entry>;
export interface BookmarkInput {
  storyId: string;
  chapterId: string;
  textOffset?: number | null;
  pageNumber?: number | null;
}
function parse<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ApiError(502, 'Dữ liệu dấu trang chưa hợp lệ. Vui lòng thử lại.');
  return result.data;
}
const resolved = entry.and(z.object({ positionAdjusted: z.boolean() })).refine((r) => r.available);
export type ResolvedBookmark = z.output<typeof resolved>;
export function createBookmarkApi(client: AxiosInstance) {
  return {
    async list(page = 1, signal?: AbortSignal) {
      const r = parse(
        z
          .object({
            success: z.literal(true),
            data: z.array(entry),
            pagination: z.object({
              page: z.number().int().positive(),
              limit: z.number().int().min(1).max(100),
              total: z.number().int().min(0),
              totalPages: z.number().int().min(0),
            }),
          })
          .refine(
            (r) =>
              r.pagination.page === page &&
              r.data.length <= r.pagination.limit &&
              r.pagination.totalPages === Math.ceil(r.pagination.total / r.pagination.limit),
          ),
        (await client.get<unknown>('/me/bookmarks', { params: { page, limit: 20 }, signal })).data,
      );
      return { data: r.data, pagination: r.pagination };
    },
    async add(input: BookmarkInput, signal?: AbortSignal) {
      const result = parse(
        z.object({ success: z.literal(true), data: entry, created: z.boolean() }),
        (
          await client.post<unknown>(
            '/me/bookmarks',
            {
              storyId: input.storyId,
              chapterId: input.chapterId,
              textOffset: input.textOffset ?? null,
              pageNumber: input.pageNumber ?? null,
            },
            { signal },
          )
        ).data,
      );
      if (result.data.storyId !== input.storyId || result.data.chapterId !== input.chapterId)
        throw new ApiError(502, 'Dấu trang trả về không khớp chương đang đọc.');
      return result;
    },
    async resolve(id: string, signal?: AbortSignal) {
      const r = parse(
        z.object({ success: z.literal(true), data: resolved }),
        (await client.get<unknown>(`/me/bookmarks/${id}`, { signal })).data,
      );
      if (r.data.id !== id) throw new ApiError(502, 'Dấu trang không khớp.');
      return r.data;
    },
    async remove(id: string, signal?: AbortSignal) {
      return parse(
        z.object({ success: z.literal(true), data: z.object({ removed: z.literal(true) }) }),
        (await client.delete<unknown>(`/me/bookmarks/${id}`, { signal })).data,
      ).data;
    },
  };
}
export const bookmarkApi = createBookmarkApi(api);
