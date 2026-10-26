import { rateLimit } from 'express-rate-limit';
import { HttpError } from '../utils/http-error';

export function createAuthRateLimit(limit: number, windowMs = 15 * 60 * 1000) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many requests; try again later')),
  });
}
