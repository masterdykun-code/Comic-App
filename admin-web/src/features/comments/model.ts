import { z } from 'zod';
import { storyId } from '../stories/model';
export type CommentStatus = 'VISIBLE' | 'HIDDEN';
export interface CommentAuthor {
  username: string;
  displayName: string;
  avatarUrl: string | null;
}
export interface AdminComment {
  id: string;
  storyId: string;
  parentId: string | null;
  content: string;
  status: CommentStatus;
  user: CommentAuthor;
  createdAt: string;
  updatedAt: string;
  story: { id: string; title: string; slug: string; publishStatus: 'DRAFT' | 'PUBLISHED' };
  parent: { id: string; status: CommentStatus; user: CommentAuthor } | null;
  replyCount: number;
}
export interface CommentQuery {
  page: number;
  limit: number;
  sort: 'newest' | 'oldest';
  status?: CommentStatus;
  storyId?: string;
  parentId?: string;
}
export interface CommentList {
  data: AdminComment[];
  pagination: { page: number; limit: number; total: number; totalPages: number };
}
const integer = (fallback: number, max: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine((n) => Number.isSafeInteger(n) && n <= max)
    .optional()
    .default(fallback);
export const commentQuerySchema = z
  .object({
    page: integer(1, 2147483647),
    limit: integer(20, 100),
    sort: z.enum(['newest', 'oldest']).optional().default('newest'),
    status: z.enum(['VISIBLE', 'HIDDEN']).optional(),
    storyId: storyId.transform((id) => id.toLowerCase()).optional(),
    parentId: storyId.transform((id) => id.toLowerCase()).optional(),
  })
  .strict()
  .refine((q) => (q.page - 1) * q.limit <= 2147483647);
export const statusLabel = { VISIBLE: 'Hiện', HIDDEN: 'Ẩn' };
