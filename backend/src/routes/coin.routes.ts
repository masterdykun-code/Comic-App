import { Router } from 'express';
import type { RequestHandler } from 'express';
import { z } from 'zod';
import {
  createAuthenticate,
  createOptionalAuthenticate,
} from '../middlewares/auth.middleware';
import { createAuthRateLimit } from '../middlewares/auth.rate-limit';
import { validateChapterParam } from '../middlewares/chapter.validation';
import { createCoinController } from '../controllers/coin.controller';
import { coinService, type CoinService } from '../services/coin.service';
import { authService, type AuthService } from '../services/auth.service';
import { HttpError } from '../utils/http-error';
const empty: RequestHandler = (req, _res, next) => {
  if (
    Object.keys(req.query).length ||
    !z.strictObject({}).safeParse(req.body ?? {}).success
  )
    throw new HttpError(400, 'INVALID_BODY', 'No extra parameters allowed');
  next();
};
export function createCoinRouter(
  service: CoinService = coinService,
  auth: AuthService = authService,
) {
  const router = Router(),
    c = createCoinController(service),
    authenticate = createAuthenticate(auth),
    rate = createAuthRateLimit(60);
  router.use(['/api/me/coins', '/api/chapters'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.get(
    '/api/chapters/:id/access',
    createOptionalAuthenticate(auth),
    validateChapterParam('id'),
    empty,
    c.access,
  );
  router.post(
    '/api/chapters/:id/unlock',
    authenticate,
    rate,
    validateChapterParam('id'),
    (req, res, next) => {
      const body = z
        .strictObject({
          expectedCoinPrice: z.number().int().min(1).max(100000),
        })
        .safeParse(req.body);
      if (!body.success || Object.keys(req.query).length)
        throw new HttpError(
          400,
          'INVALID_BODY',
          'Confirm current chapter price',
        );
      res.locals.expectedCoinPrice = body.data.expectedCoinPrice;
      next();
    },
    c.unlock,
  );
  router.get(
    '/api/me/coins',
    authenticate,
    (req, res, next) => {
      const num = (fallback: number, max: number) =>
        z
          .string()
          .regex(/^[1-9]\d*$/)
          .transform(Number)
          .refine((n) => Number.isSafeInteger(n) && n <= max)
          .optional()
          .default(fallback);
      const parsed = z
        .strictObject({ page: num(1, 2147483647), limit: num(20, 100) })
        .refine((q) => (q.page - 1) * q.limit <= 2147483647)
        .safeParse(req.query);
      if (!parsed.success)
        throw new HttpError(400, 'INVALID_QUERY', 'Invalid coin pagination');
      res.locals.coinQuery = parsed.data;
      next();
    },
    c.wallet,
  );
  router.get('/api/me/coins/tasks', authenticate, empty, c.tasks);
  router.post(
    '/api/me/coins/check-in',
    authenticate,
    rate,
    empty,
    (_req, res, next) => {
      res.locals.rewardKind = 'CHECK_IN';
      next();
    },
    c.claim,
  );
  router.post(
    '/api/me/coins/missions/:kind/claim',
    authenticate,
    rate,
    empty,
    (req, res, next) => {
      const kind = z
        .enum(['READ_THREE', 'FAVORITE'])
        .safeParse(req.params.kind);
      if (!kind.success)
        throw new HttpError(400, 'INVALID_MISSION', 'Invalid mission');
      res.locals.rewardKind = kind.data;
      next();
    },
    c.claim,
  );
  return router;
}
export default createCoinRouter();
