import { Router } from 'express';
import { createUploadController } from '../controllers/upload.controller';
import { createAuthenticate, authorizeRole } from '../middlewares/auth.middleware';
import { createAuthRateLimit } from '../middlewares/auth.rate-limit';
import { authService, type AuthService } from '../services/auth.service';
import { uploadService, type UploadService } from '../services/upload.service';
import type { UploadCapacity } from '../utils/upload-capacity';

export function createUploadRouter(service: UploadService = uploadService, auth: AuthService = authService, capacity?: UploadCapacity) {
  const router = Router();
  const controller = createUploadController(service, capacity);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  router.use(createAuthenticate(auth), authorizeRole('ADMIN'), createAuthRateLimit(30));
  router.post('/cover', controller.cover);
  router.post('/chapter-pages', controller.chapterPages);
  return router;
}
export default createUploadRouter();
