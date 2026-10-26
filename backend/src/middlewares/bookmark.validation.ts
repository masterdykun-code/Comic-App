import type { RequestHandler } from 'express';
import { z } from 'zod';
import { readingUuid } from './reading.validation';
import { HttpError } from '../utils/http-error';
export const bookmarkInputSchema = z.strictObject({
  storyId: readingUuid,
  chapterId: readingUuid,
  textOffset: z.number().int().min(0).max(2147483647).nullable().optional(),
  pageNumber: z.number().int().min(1).max(2147483647).nullable().optional(),
});
export const validateBookmarkId: RequestHandler = (req, res, next) => {
  const parsed = readingUuid.safeParse(req.params.id);
  if (!parsed.success)
    throw new HttpError(
      400,
      'INVALID_UUID',
      'A valid bookmark UUID is required',
    );
  res.locals.bookmarkId = parsed.data;
  next();
};
