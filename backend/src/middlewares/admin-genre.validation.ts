import { z } from 'zod';
import type { RequestHandler } from 'express';
import { HttpError } from '../utils/http-error';
export const adminGenreInputSchema = z.strictObject({
  name: z.string().trim().normalize('NFC').min(1).max(100)
    .refine((v) => !/[\x00-\x1f\x7f-\x9f<>]/.test(v) && v.replace(/[\s\p{Cf}]/gu, '').length > 0),
  slug: z.string().trim().toLowerCase().min(1).max(120).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
});
export const adminGenreUpdateSchema = adminGenreInputSchema.partial().refine((v) => Object.keys(v).length > 0);
export function validateAdminGenreBody(schema: z.ZodType): RequestHandler {
  return (req, res, next) => {
    const input = schema.safeParse(req.body);
    if (!input.success) throw new HttpError(400, 'INVALID_BODY', 'Invalid genre name or slug');
    res.locals.genreInput = input.data; next();
  };
}
export const validateAdminGenreEmpty: RequestHandler = (req, _res, next) => {
  if (Object.keys(req.query).length || (req.body !== undefined && !z.strictObject({}).safeParse(req.body).success)) throw new HttpError(400, 'INVALID_BODY', 'No query or delete body fields are supported');
  next();
};
