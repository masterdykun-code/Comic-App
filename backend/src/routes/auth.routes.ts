import { Router } from 'express';
import { createAuthController } from '../controllers/auth.controller';
import { createAuthenticate } from '../middlewares/auth.middleware';
import { createAuthRateLimit } from '../middlewares/auth.rate-limit';
import { changePasswordSchema, loginSchema, profileSchema, refreshSchema, registerSchema, validateAuthBody } from '../middlewares/auth.validation';
import { authService, type AuthService } from '../services/auth.service';

export function createAuthRouter(service: AuthService = authService) {
  const router = Router();
  const controller = createAuthController(service);
  const authenticate = createAuthenticate(service);
  router.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  router.post('/register', createAuthRateLimit(5, 60 * 60 * 1000), validateAuthBody(registerSchema), controller.register);
  router.post('/login', createAuthRateLimit(10), validateAuthBody(loginSchema), controller.login);
  router.post('/refresh', createAuthRateLimit(60), validateAuthBody(refreshSchema), controller.refresh);
  router.post('/logout', createAuthRateLimit(60), validateAuthBody(refreshSchema), controller.logout);
  router.get('/me', authenticate, controller.me);
  router.patch('/me', authenticate, validateAuthBody(profileSchema), controller.updateMe);
  router.post('/change-password', authenticate, createAuthRateLimit(5), validateAuthBody(changePasswordSchema), controller.changePassword);
  return router;
}

export default createAuthRouter();
