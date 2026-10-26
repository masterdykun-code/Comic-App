import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/http-error';

const uuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i).toLowerCase();
const positiveInt = z.number().int().min(1).max(2_147_483_647);
export const novelContentSchema = z.string().max(200000).refine((s) => !s.includes('\0'));
export const chapterCreateSchema = z.strictObject({
  chapterNumber: positiveInt,
  title: z.string().trim().min(1).max(200).refine((s) => !s.includes('\0')),
  content: novelContentSchema.nullable().optional(),
  isVip: z.boolean().optional(),
  coinPrice: z.number().int().min(1).max(100000).optional(),
});
const expectedUpdatedAt = z.iso.datetime({ offset: true }).optional();
export const chapterUpdateSchema = chapterCreateSchema.partial().extend({ expectedUpdatedAt })
  .refine(({ expectedUpdatedAt: _version, ...data }) => Object.keys(data).length > 0);
export const pageInputSchema = z.strictObject({
  pageNumber: positiveInt,
  imageUrl: z.url({ protocol: /^https?$/ }).max(2048).refine((s) => !s.includes('\0')),
  storagePublicId: z.string().trim().min(1).max(512).refine((s) => !s.includes('\0')).nullable().optional(),
});
export const chapterPagesSchema = z.strictObject({
  expectedUpdatedAt,
  pages: z.array(pageInputSchema).max(200).refine((pages) => new Set(pages.map((p) => p.pageNumber)).size === pages.length),
});
export const chapterPublishSchema = z.strictObject({ expectedUpdatedAt });
const integerQuery = (fallback: number, max: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).refine((n) => Number.isSafeInteger(n) && n <= max).optional().default(fallback);
const querySchema = z.strictObject({ page: integerQuery(1, 2_147_483_647), limit: integerQuery(20, 100) })
  .refine((q) => (q.page - 1) * q.limit <= 2_147_483_647);

export function validateChapterParam(param: 'id' | 'storyId'): RequestHandler {
  return (req, res, next) => {
    const parsed = uuid.safeParse(req.params[param]);
    if (!parsed.success) throw new HttpError(400, 'INVALID_UUID', 'A valid UUID is required');
    res.locals[param === 'id' ? 'chapterId' : 'storyId'] = parsed.data;
    next();
  };
}
export const validateChapterQuery: RequestHandler = (req, res, next) => {
  const parsed = querySchema.safeParse(req.query);
  if (!parsed.success) throw new HttpError(400, 'INVALID_QUERY', 'Invalid chapter pagination');
  res.locals.chapterQuery = parsed.data;
  next();
};
export function validateChapterBody(schema: z.ZodType, allowEmpty = false): RequestHandler {
  return (req, res, next) => {
    const parsed = schema.safeParse(allowEmpty ? req.body ?? {} : req.body);
    if (!parsed.success) throw new HttpError(400, 'INVALID_BODY', 'Invalid chapter request body');
    // A version is a write precondition, never a Prisma model field.
    const { expectedUpdatedAt: version, ...input } = parsed.data as Record<string, unknown>;
    res.locals.chapterExpectedUpdatedAt = version;
    res.locals.chapterInput = input;
    next();
  };
}
