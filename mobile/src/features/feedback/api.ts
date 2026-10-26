import { z } from 'zod';
import type { AxiosInstance } from 'axios';
import { api } from '../../services/runtime';
import { ApiError } from '../../lib/errors';
import { isUuid } from '../stories/api';
const uuid = z.string().refine(isUuid);
const date = z.iso.datetime({ offset: true });
const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f<>]/.test(s))
    .refine((s) => s.replace(/[\s\p{Cf}]/gu, '').length > 0);
export const ratingInput = z.strictObject({
  score: z.number().int().min(1).max(5),
  reviewText: text(2000).nullable().optional(),
});
export const commentInput = z.strictObject({
  content: text(3000),
  parentId: uuid.nullable().optional(),
});
export const profileInput = z
  .strictObject({
    displayName: z.string().trim().min(1).max(100).optional(),
    avatarUrl: z
      .url({ protocol: /^https?$/ })
      .max(2048)
      .nullable()
      .optional(),
  })
  .refine((row) => Object.keys(row).length > 0);
const author = z.object({
  username: z.string().min(1),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
});
const common = { id: uuid, storyId: uuid, createdAt: date, updatedAt: date, user: author };
const rating = z.object({
  ...common,
  score: z.number().int().min(1).max(5),
  reviewText: z.string().nullable(),
});
const comment = z.object({
  ...common,
  parentId: uuid.nullable(),
  content: z.string(),
  status: z.literal('VISIBLE').optional(),
});
const count = z.number().int().min(0);
const pagination = z
  .object({
    page: z.number().int().positive(),
    limit: z.number().int().min(1).max(100),
    total: count,
    totalPages: count,
  })
  .refine((p) => p.totalPages === Math.ceil(p.total / p.limit));
const thread = comment.extend({ replies: z.array(comment), repliesPagination: pagination });
const summary = z.object({
  averageScore: z.number().min(1).max(5).nullable(),
  totalRatings: count,
  distribution: z.object({ 1: count, 2: count, 3: count, 4: count, 5: count }),
});
const user = z.object({
  id: uuid,
  username: z.string(),
  email: z.email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(['USER', 'ADMIN']),
  status: z.literal('ACTIVE'),
  createdAt: date,
  updatedAt: date,
});
export type Rating = z.infer<typeof rating>;
export type Comment = z.infer<typeof comment>;
export type Thread = z.infer<typeof thread>;
export type Summary = z.infer<typeof summary>;
export function parse<T>(schema: z.ZodType<T>, raw: unknown): T {
  const result = schema.safeParse(raw);
  if (!result.success) throw new ApiError(502, 'Dữ liệu tương tác chưa hợp lệ. Vui lòng tải lại.');
  return result.data;
}
function pageSchema<T>(item: z.ZodType<T>) {
  return z.object({ success: z.literal(true), data: z.array(item), pagination });
}
export function createFeedbackApi(client: AxiosInstance) {
  const getPage = async <T>(
    path: string,
    item: z.ZodType<T>,
    page: number,
    sort: string,
    signal?: AbortSignal,
    limit = 20,
  ) => {
    const raw: unknown = (await client.get(path, { params: { page, limit, sort }, signal })).data;
    const result = parse(pageSchema(item), raw);
    if (result.pagination.page !== page || result.data.length > result.pagination.limit)
      throw new ApiError(502, 'Phân trang chưa hợp lệ.');
    return { ...result, raw };
  };
  return {
    async me(signal?: AbortSignal) {
      return parse(
        z.object({ success: z.literal(true), data: user }),
        (await client.get('/auth/me', { signal })).data,
      ).data;
    },
    async ratings(storyId: string, page = 1, signal?: AbortSignal, limit = 20) {
      const result = await getPage(
        `/stories/${storyId}/ratings`,
        rating,
        page,
        'newest',
        signal,
        limit,
      );
      if (result.data.some((row) => row.storyId !== storyId))
        throw new ApiError(502, 'Đánh giá không thuộc truyện.');
      return {
        data: result.data,
        pagination: result.pagination,
        summary: parse(z.object({ summary }), result.raw).summary,
      };
    },
    async comments(storyId: string, page = 1, signal?: AbortSignal) {
      const result = await getPage(`/stories/${storyId}/comments`, thread, page, 'newest', signal);
      if (
        result.data.some(
          (row) =>
            row.storyId !== storyId ||
            row.parentId !== null ||
            row.replies.some((r) => r.storyId !== storyId || r.parentId !== row.id),
        )
      )
        throw new ApiError(502, 'Luồng bình luận chưa hợp lệ.');
      return { data: result.data, pagination: result.pagination };
    },
    async replies(id: string, storyId: string, page = 1, signal?: AbortSignal) {
      const result = await getPage(`/comments/${id}/replies`, comment, page, 'oldest', signal);
      if (result.data.some((row) => row.storyId !== storyId || row.parentId !== id))
        throw new ApiError(502, 'Phản hồi chưa hợp lệ.');
      return { data: result.data, pagination: result.pagination };
    },
    async saveRating(storyId: string, input: z.input<typeof ratingInput>, signal?: AbortSignal) {
      return parse(
        z.object({ success: z.literal(true), data: rating }),
        (await client.put(`/stories/${storyId}/my-rating`, ratingInput.parse(input), { signal }))
          .data,
      ).data;
    },
    async removeRating(storyId: string, signal?: AbortSignal) {
      return parse(
        z.object({ success: z.literal(true), data: z.object({ removed: z.boolean() }) }),
        (await client.delete(`/stories/${storyId}/my-rating`, { signal })).data,
      ).data;
    },
    async createComment(
      storyId: string,
      input: z.input<typeof commentInput>,
      signal?: AbortSignal,
    ) {
      return parse(
        z.object({ success: z.literal(true), data: comment }),
        (await client.post(`/stories/${storyId}/comments`, commentInput.parse(input), { signal }))
          .data,
      ).data;
    },
    async editComment(id: string, content: string, signal?: AbortSignal) {
      return parse(
        z.object({ success: z.literal(true), data: comment }),
        (await client.patch(`/comments/${id}`, { content: text(3000).parse(content) }, { signal }))
          .data,
      ).data;
    },
    async removeComment(id: string, signal?: AbortSignal) {
      return parse(
        z.object({ success: z.literal(true), data: z.object({ removed: z.boolean() }) }),
        (await client.delete(`/comments/${id}`, { signal })).data,
      ).data;
    },
    async updateProfile(input: z.input<typeof profileInput>, signal?: AbortSignal) {
      return parse(
        z.object({ success: z.literal(true), data: user }),
        (await client.patch('/auth/me', profileInput.parse(input), { signal })).data,
      ).data;
    },
  };
}
export const feedbackApi = createFeedbackApi(api);
