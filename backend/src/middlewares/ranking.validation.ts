import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/http-error';
const integer = (fallback: number, max: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine((n) => Number.isSafeInteger(n) && n <= max)
    .optional()
    .default(fallback);
export const rankingQuerySchema = z
  .strictObject({
    kind: z.enum(['reads', 'rating', 'updated']).default('reads'),
    type: z.enum(['NOVEL', 'COMIC']).optional(),
    page: integer(1, 2147483647),
    limit: integer(20, 100),
  })
  .refine((q) => (q.page - 1) * q.limit <= 2147483647);
export const validateRankingQuery: RequestHandler = (req, res, next) => {
  const query = rankingQuerySchema.safeParse(req.query);
  if (!query.success)
    throw new HttpError(400, 'INVALID_QUERY', 'Invalid ranking parameters');
  res.locals.rankingQuery = query.data;
  next();
};
