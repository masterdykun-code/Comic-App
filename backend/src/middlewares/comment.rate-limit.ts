import { rateLimit } from 'express-rate-limit';
import { HttpError } from '../utils/http-error';

export function createCommentRateLimit() {
  return rateLimit({
    windowMs: 60_000, limit: 10,
    // Called only after Authentication; token rotation cannot reset this key.
    keyGenerator: (_req, res) => res.locals.auth.user.id,
    standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (_req, _res, next) => next(new HttpError(429, 'RATE_LIMITED', 'Too many comment writes; try again later')),
  });
}
