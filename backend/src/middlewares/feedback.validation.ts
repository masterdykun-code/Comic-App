import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/http-error';

const uuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i).toLowerCase();
// Treat text as plain text, rejecting controls, invisible-only input and HTML
// rather than rewriting user content into an ambiguous sanitized representation.
const plainText = (max: number) => z.string().trim().min(1).max(max)
  .refine((s) => !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f-\x9f<>]/.test(s))
  .refine((s) => s.replace(/[\s\p{Cf}]/gu, '').length > 0);
export const ratingInputSchema = z.strictObject({ score: z.number().int().min(1).max(5), reviewText: plainText(2000).nullable().optional() });
export const commentInputSchema = z.strictObject({ content: plainText(3000), parentId: uuid.nullable().optional() });
export const commentEditSchema = z.strictObject({ content: plainText(3000) });
export const commentModerateSchema = z.strictObject({ status: z.enum(['VISIBLE', 'HIDDEN']) });
const integerQuery = (fallback: number, max: number) => z.string().regex(/^[1-9]\d*$/).transform(Number)
  .refine((n) => Number.isSafeInteger(n) && n <= max).optional().default(fallback);
const querySchema = (sort: 'newest' | 'oldest') => z.strictObject({
  page: integerQuery(1, 2147483647), limit: integerQuery(20, 100), sort: z.enum(['newest', 'oldest']).optional().default(sort),
}).refine((q) => (q.page - 1) * q.limit <= 2147483647);
const empty = z.strictObject({});
export function validateFeedbackParam(param: 'storyId' | 'id'): RequestHandler {
  return (req, res, next) => {
    const result = uuid.safeParse(req.params[param]);
    if (!result.success) throw new HttpError(400, 'INVALID_UUID', 'A valid UUID is required');
    res.locals[param] = result.data; next();
  };
}
export function validateFeedbackQuery(sort?: 'newest' | 'oldest'): RequestHandler {
  return (req, res, next) => {
    const result = (sort ? querySchema(sort) : empty).safeParse(req.query);
    if (!result.success) throw new HttpError(400, 'INVALID_QUERY', 'Invalid feedback query');
    res.locals.feedbackQuery = result.data; next();
  };
}
export function validateFeedbackBody(schema: z.ZodType = empty, allowEmpty = false): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(allowEmpty ? req.body ?? {} : req.body);
    if (!result.success) throw new HttpError(400, 'INVALID_BODY', 'Invalid feedback request body');
    res.locals.feedbackInput = result.data; next();
  };
}
