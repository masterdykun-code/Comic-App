import express, { Router } from 'express';
import { createChapterController } from '../controllers/chapter.controller';
import { createAuthenticate, createOptionalAuthenticate, authorizeRole } from '../middlewares/auth.middleware';
import { chapterCreateSchema, chapterPagesSchema, chapterPublishSchema, chapterUpdateSchema,
  validateChapterBody, validateChapterParam, validateChapterQuery } from '../middlewares/chapter.validation';
import { authService, type AuthService } from '../services/auth.service';
import { chapterService, type ChapterService } from '../services/chapter.service';

export function createChapterRouter(service: ChapterService = chapterService, auth: AuthService = authService) {
  const router = Router();
  const controller = createChapterController(service);
  const authenticate = createAuthenticate(auth);
  const admin = authorizeRole('ADMIN');
  // Mounted before the app's 16kb parser. Larger chapter bodies are parsed only
  // after authentication + authorization; limits of other modules are unchanged.
  const chapterJson = express.json({ limit: '1mb' });
  const storyId = validateChapterParam('storyId');
  const chapterId = validateChapterParam('id');
  const noStore: express.RequestHandler = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };

  router.get('/api/stories/:storyId/chapters', storyId, validateChapterQuery, controller.list);
  router.get('/api/chapters/:id', noStore, createOptionalAuthenticate(auth), chapterId, controller.read);
  router.get('/api/admin/stories/:storyId/chapters', noStore, authenticate, admin, storyId, validateChapterQuery, controller.adminList);
  router.get('/api/admin/chapters/:id', noStore, authenticate, admin, chapterId, controller.adminRead);
  router.post('/api/admin/stories/:storyId/chapters', noStore, authenticate, admin, storyId, chapterJson, validateChapterBody(chapterCreateSchema), controller.create);
  router.patch('/api/admin/chapters/:id', noStore, authenticate, admin, chapterId, chapterJson, validateChapterBody(chapterUpdateSchema), controller.update);
  router.put('/api/admin/chapters/:id/pages', noStore, authenticate, admin, chapterId, chapterJson, validateChapterBody(chapterPagesSchema), controller.pages);
  router.patch('/api/admin/chapters/:id/publish', noStore, authenticate, admin, chapterId, chapterJson, validateChapterBody(chapterPublishSchema, true), controller.publish);
  return router;
}
export default createChapterRouter();
