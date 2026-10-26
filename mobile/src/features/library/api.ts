import { z } from 'zod';
import type { AxiosInstance } from 'axios';
import { api } from '../../services/runtime';
import { ApiError } from '../../lib/errors';
import { isUuid, type Page } from '../stories/api';
const uuid = z.string().refine(isUuid);
const date = z.iso.datetime({ offset: true });
const positive = z.number().int().min(1).max(2_147_483_647);
const story = z
  .object({
    id: uuid,
    title: z.string(),
    slug: z.string(),
    coverUrl: z.string().nullable(),
    type: z.enum(['NOVEL', 'COMIC']),
    authorName: z.string(),
    publishStatus: z.literal('PUBLISHED').optional(),
  })
  .transform(({ publishStatus: _status, ...row }) => row);
const chapter = z.object({ id: uuid, chapterNumber: positive, title: z.string() });
const favorite = z
  .object({ id: uuid, storyId: uuid, createdAt: date, story })
  .refine((row) => row.storyId === row.story.id);
const percentage = z
  .union([
    z.number(),
    z
      .string()
      .regex(/^\d+(\.\d{1,2})?$/)
      .transform(Number),
  ])
  .pipe(z.number().min(0).max(100));
const progress = z
  .object({
    id: uuid,
    storyId: uuid,
    chapterId: uuid,
    progressPercent: percentage,
    updatedAt: date,
    story,
    chapter,
  })
  .refine((row) => row.story.id === row.storyId && row.chapter.id === row.chapterId);
const history = z
  .object({ id: uuid, storyId: uuid, chapterId: uuid, readAt: date, story, chapter })
  .refine((row) => row.story.id === row.storyId && row.chapter.id === row.chapterId);
export type Favorite = z.output<typeof favorite>;
export type Progress = z.output<typeof progress>;
export type History = z.output<typeof history>;
export type ReadingEntry = Favorite | Progress | History;
export type LibraryKind = 'favorites' | 'progress' | 'history';
const pagination = z
  .object({
    page: positive,
    limit: positive.max(100),
    total: z.number().int().min(0),
    totalPages: z.number().int().min(0),
  })
  .refine((p) => p.totalPages === Math.ceil(p.total / p.limit));
function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError(502, 'Dữ liệu giá sách chưa hợp lệ. Vui lòng thử lại.');
  return result.data;
}
function list<T>(schema: z.ZodType<T>, raw: unknown, requestedPage: number): Page<T> {
  const result = parse(
    z
      .object({ success: z.literal(true), data: z.array(schema), pagination })
      .refine(
        (row) => row.pagination.page === requestedPage && row.data.length <= row.pagination.limit,
      ),
    raw,
  );
  return { data: result.data, pagination: result.pagination };
}
export function createLibraryApi(client: AxiosInstance) {
  return {
    async favorites(page = 1, limit = 12, signal?: AbortSignal) {
      return list(
        favorite,
        (await client.get<unknown>('/me/favorites', { params: { page, limit }, signal })).data,
        page,
      );
    },
    async progress(page = 1, signal?: AbortSignal) {
      return list(
        progress,
        (await client.get<unknown>('/me/reading-progress', { params: { page, limit: 12 }, signal }))
          .data,
        page,
      );
    },
    async history(page = 1, signal?: AbortSignal) {
      return list(
        history,
        (await client.get<unknown>('/me/reading-history', { params: { page, limit: 12 }, signal }))
          .data,
        page,
      );
    },
    async add(storyId: string, signal?: AbortSignal) {
      return parse(
        z.object({ success: z.literal(true), data: favorite }),
        (await client.post<unknown>('/me/favorites', { storyId }, { signal })).data,
      ).data;
    },
    async remove(storyId: string, signal?: AbortSignal) {
      return parse(
        z.object({ success: z.literal(true), data: z.object({ removed: z.boolean() }) }),
        (await client.delete<unknown>(`/me/favorites/${storyId}`, { signal })).data,
      ).data;
    },
    async clearHistory(signal?: AbortSignal) {
      return parse(
        z.object({
          success: z.literal(true),
          data: z.object({ deletedCount: z.number().int().min(0) }),
        }),
        (await client.delete<unknown>('/me/reading-history', { signal })).data,
      ).data;
    },
  };
}
export const libraryApi = createLibraryApi(api);
