import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/http-error';
const uuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i).toLowerCase();
const integer = (fallback: number, max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number).refine((n) => Number.isSafeInteger(n) && n <= max).optional().default(fallback);
export const adminCommentQuerySchema = z.strictObject({
  page: integer(1, 2147483647), limit: integer(20, 100), sort: z.enum(['newest', 'oldest']).optional().default('newest'),
  storyId: uuid.optional(), parentId: uuid.optional(), status: z.enum(['VISIBLE', 'HIDDEN']).optional(),
}).refine((q) => (q.page - 1) * q.limit <= 2147483647);
export const validateAdminCommentQuery: RequestHandler = (req, res, next) => {
  const value = adminCommentQuerySchema.safeParse(req.query);
  if (!value.success) throw new HttpError(400, 'INVALID_QUERY', 'Invalid admin comment query');
  res.locals.adminCommentQuery = value.data; next();
};
