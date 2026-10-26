import type { RequestHandler } from 'express';
import { HttpError } from '../utils/http-error';
import type { GenreStoriesQuery } from '../types/genre.types';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxPrismaInt = 2_147_483_647;

function positiveInteger(value: unknown, fallback: number, max: number, name: string): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new HttpError(400, 'INVALID_QUERY', `${name} must be a positive integer`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new HttpError(400, 'INVALID_QUERY', `${name} must be between 1 and ${max}`);
  }
  return parsed;
}

export const validateGenreId: RequestHandler = (req, res, next) => {
  const id = req.params.id;
  if (typeof id !== 'string' || !uuidPattern.test(id)) {
    throw new HttpError(400, 'INVALID_UUID', 'Genre id must be a valid UUID');
  }
  res.locals.genreId = id;
  next();
};

export const validateGenreStoriesQuery: RequestHandler = (req, res, next) => {
  // Express's simple query parser treats page[x] as a literal unknown key.
  if (Object.keys(req.query).some((key) => !['page', 'limit', 'type'].includes(key))) {
    throw new HttpError(400, 'INVALID_QUERY', 'Only page, limit and type query parameters are supported');
  }
  const page = positiveInteger(req.query.page, 1, maxPrismaInt, 'page');
  const limit = positiveInteger(req.query.limit, 20, 100, 'limit');
  if ((page - 1) * limit > maxPrismaInt) {
    throw new HttpError(400, 'INVALID_QUERY', 'Pagination offset is too large');
  }
  const type = req.query.type;
  if (type !== undefined && type !== 'NOVEL' && type !== 'COMIC') {
    throw new HttpError(400, 'INVALID_QUERY', 'type must be NOVEL or COMIC');
  }
  const query: GenreStoriesQuery = { page, limit, type };
  res.locals.genreStoriesQuery = query;
  next();
};
