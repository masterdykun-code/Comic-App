import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/http-error';

export const readingUuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i).toLowerCase();
const integerQuery = (fallback: number, max: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).refine((n) => Number.isSafeInteger(n) && n <= max).optional().default(fallback);
export const readingQuerySchema = z.strictObject({ page: integerQuery(1, 2_147_483_647), limit: integerQuery(20, 100) })
  .refine((q) => (q.page - 1) * q.limit <= 2_147_483_647);
export const emptyReadingSchema = z.strictObject({});
export const favoriteInputSchema = z.strictObject({ storyId: readingUuid });
export const historyInputSchema = z.strictObject({ storyId: readingUuid, chapterId: readingUuid });
const offset = z.number().int().min(0).max(2_147_483_647).nullable().optional();
export const progressInputSchema = z.strictObject({
  chapterId: readingUuid,
  progressPercent: z.number().min(0).max(100).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-8),
  expectedUpdatedAt: z.iso.datetime({ offset: true }).transform((s) => new Date(s).toISOString()).nullable(),
  textOffset: offset,
  pageNumber: z.number().int().min(1).max(2_147_483_647).nullable().optional(),
  scrollOffset: offset,
});
export const validateReadingStoryId: RequestHandler = (req, res, next) => {
  const parsed = readingUuid.safeParse(req.params.storyId);
  if (!parsed.success) throw new HttpError(400, 'INVALID_UUID', 'A valid story UUID is required');
  res.locals.readingStoryId = parsed.data; next();
};
export function validateReadingQuery(pagination = false): RequestHandler {
  return (req, res, next) => {
    const parsed = (pagination ? readingQuerySchema : emptyReadingSchema).safeParse(req.query);
    if (!parsed.success) throw new HttpError(400, 'INVALID_QUERY', 'Invalid reading query');
    res.locals.readingQuery = parsed.data; next();
  };
}
export function validateReadingBody(schema: z.ZodType = emptyReadingSchema, allowEmpty = false): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(allowEmpty ? req.body ?? {} : req.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_BODY', 'Invalid reading request body');
    res.locals.readingInput = parsed.data; next();
  };
}
