import express, { Router, type RequestHandler } from 'express';
import {
  createAuthenticate,
  authorizeRole,
} from '../middlewares/auth.middleware';
import { createAuthRateLimit } from '../middlewares/auth.rate-limit';
import { createEpubImportController } from '../controllers/epub-import.controller';
import {
  epubImportService,
  type EpubImportService,
} from '../services/epub-import.service';
import { authService, type AuthService } from '../services/auth.service';
import { HttpError } from '../utils/http-error';
export function createEpubImportRouter(
  service: EpubImportService = epubImportService,
  auth: AuthService = authService,
) {
  const router = Router(),
    admin = Router();
  const authenticate = createAuthenticate(auth),
    authorize = authorizeRole('ADMIN');
  const uuid: RequestHandler = (req, _res, next) => {
    if (
      !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
        String(req.params.id),
      )
    )
      throw new HttpError(400, 'INVALID_UUID', 'ID không hợp lệ.');
    next();
  };
  const controller = createEpubImportController(service);
  admin.use(
    authenticate,
    authorize,
    createAuthRateLimit(20),
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
  );
  admin.post('/preview', controller.preview);
  admin.get('/:id', uuid, controller.status);
  admin.post(
    '/:id/confirm',
    uuid,
    express.json({ limit: '16kb' }),
    controller.confirm,
  );
  admin.delete('/:id', uuid, controller.cancel);
  router.use('/api/admin/epub-imports', admin);
  router.get(
    '/api/epub-covers/:id',
    uuid,
    async (req, res, next) => {
      res.setHeader('Cache-Control', 'private, no-store');
      const visibility = await service.visibility(String(req.params.id));
      if (!visibility)
        throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy ảnh.');
      if (visibility === 'PUBLISHED') {
        next();
        return;
      }
      await authenticate(req, res, (error) => {
        if (error) {
          next(error);
          return;
        }
        authorize(req, res, next);
      });
    },
    async (req, res) => {
      const image = await service.cover(String(req.params.id));
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.type(image.type).send(image.bytes);
    },
  );
  return router;
}
export default createEpubImportRouter();
