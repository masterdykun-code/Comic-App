import { Router } from 'express';
import { createAuthenticate } from '../middlewares/auth.middleware';
import { authService, type AuthService } from '../services/auth.service';

export function privateReadingRouter(auth: AuthService = authService) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(createAuthenticate(auth));
  return router;
}
