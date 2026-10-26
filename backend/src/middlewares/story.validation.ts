import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/http-error';

// UUID syntax, including PostgreSQL-valid nil UUIDs; normalize before uniqueness checks.
const uuid = z.string().regex(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i).toLowerCase();
const title = z.string().trim().min(1).max(200);
const authorName = z.string().trim().min(1).max(100);
const description = z.string().trim().max(10000);
const coverUrl = z.union([z.literal(''), z.url({ protocol: /^https?$/ }).max(2048)]);
const genreIds = z.array(uuid).max(50).refine((ids) => new Set(ids).size === ids.length);

export const createStorySchema = z.strictObject({
  title, type: z.enum(['NOVEL', 'COMIC']), authorName,
  description: description.optional(), coverUrl: coverUrl.optional(),
  status: z.enum(['ONGOING', 'COMPLETED']).optional(), genreIds: genreIds.optional(),
});
export const updateStorySchema = createStorySchema.partial().refine((body) => Object.keys(body).length > 0);
export const publicationSchema = createStorySchema.extend({
  description: description.min(1),
  coverUrl: z.url({ protocol: /^https?$/ }).max(2048),
  genreIds: genreIds.refine((ids) => ids.length > 0),
});

const integer = (fallback: number, max: number) => z.string().regex(/^[1-9]\d*$/)
  .transform(Number).refine((n) => Number.isSafeInteger(n) && n <= max).optional().default(fallback);
const queryFields = {
  page: integer(1, 2_147_483_647), limit: integer(20, 100),
  search: z.string().trim().min(1).max(200).optional(),
  type: z.enum(['NOVEL', 'COMIC']).optional(), genreId: uuid.optional(),
  status: z.enum(['ONGOING', 'COMPLETED']).optional(),
  sort: z.enum(['newest', 'updated', 'title']).optional().default('newest'),
};
const offsetValid = (q: { page: number; limit: number }) => (q.page - 1) * q.limit <= 2_147_483_647;
const publicQuery = z.strictObject(queryFields).refine(offsetValid);
const adminQuery = z.strictObject({ ...queryFields, publishStatus: z.enum(['DRAFT', 'PUBLISHED']).optional() }).refine(offsetValid);

export const validateStoryId: RequestHandler = (req, res, next) => {
  const result = uuid.safeParse(req.params.id);
  if (!result.success) throw new HttpError(400, 'INVALID_UUID', 'Story id must be a valid UUID');
  res.locals.storyId = result.data;
  next();
};

export function validateStoryQuery(admin = false): RequestHandler {
  return (req, res, next) => {
    const result = (admin ? adminQuery : publicQuery).safeParse(req.query);
    if (!result.success) throw new HttpError(400, 'INVALID_QUERY', 'Invalid story query parameters');
    res.locals.storyQuery = result.data;
    next();
  };
}

export function validateStoryBody(schema: z.ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) throw new HttpError(400, 'INVALID_BODY', 'Invalid story request body');
    res.locals.storyInput = result.data;
    next();
  };
}

export const validatePublishBody: RequestHandler = (req, _res, next) => {
  if (!z.strictObject({}).safeParse(req.body ?? {}).success) {
    throw new HttpError(400, 'INVALID_BODY', 'Publish request accepts no fields');
  }
  next();
};

export const validateDeleteStory: RequestHandler = (req, res, next) => {
  const body = z.strictObject({ confirm: z.literal(true), expectedUpdatedAt: z.iso.datetime({ offset: true }) }).safeParse(req.body);
  if (!body.success || !z.strictObject({}).safeParse(req.query).success)
    throw new HttpError(400, 'INVALID_BODY', 'Deletion requires explicit confirmation and the story version');
  res.locals.storyDeleteInput = body.data;
  next();
};
