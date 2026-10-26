import { Router } from 'express';
import { createCommentController } from '../controllers/comment.controller';
import { createAuthenticate, authorizeRole } from '../middlewares/auth.middleware';
import { createCommentRateLimit } from '../middlewares/comment.rate-limit';
import { createAuthRateLimit } from '../middlewares/auth.rate-limit';
import { commentEditSchema, commentInputSchema, commentModerateSchema, validateFeedbackBody, validateFeedbackParam, validateFeedbackQuery } from '../middlewares/feedback.validation';
import { authService, type AuthService } from '../services/auth.service';
import { commentService, type CommentService } from '../services/comment.service';
import { adminCommentService, type AdminCommentService } from '../services/admin-comment.service';
import { validateAdminCommentQuery } from '../middlewares/admin-comment.validation';

export function createCommentRouter(service: CommentService = commentService, auth: AuthService = authService, adminService: AdminCommentService = adminCommentService) {
  const router = Router(); const c = createCommentController(service, adminService); const authenticate = createAuthenticate(auth);
  const storyId = validateFeedbackParam('storyId'); const id = validateFeedbackParam('id');
  const limit = createCommentRateLimit(); const ipLimit = createAuthRateLimit(60, 60_000);
  const noStore: import('express').RequestHandler = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };
  router.get('/api/stories/:storyId/comments', noStore, storyId, validateFeedbackQuery('newest'), validateFeedbackBody(undefined, true), c.list);
  router.get('/api/comments/:id/replies', noStore, id, validateFeedbackQuery('oldest'), validateFeedbackBody(undefined, true), c.replies);
  router.post('/api/stories/:storyId/comments', noStore, authenticate, ipLimit, limit, storyId, validateFeedbackQuery(), validateFeedbackBody(commentInputSchema), c.create);
  router.patch('/api/comments/:id', noStore, authenticate, ipLimit, limit, id, validateFeedbackQuery(), validateFeedbackBody(commentEditSchema), c.edit);
  router.delete('/api/comments/:id', noStore, authenticate, id, validateFeedbackQuery(), validateFeedbackBody(undefined, true), c.remove);
  router.get('/api/admin/comments', noStore, authenticate, authorizeRole('ADMIN'), createAuthRateLimit(120, 60_000), validateAdminCommentQuery, validateFeedbackBody(undefined, true), c.adminList);
  router.patch('/api/admin/comments/:id/moderate', noStore, authenticate, authorizeRole('ADMIN'), createAuthRateLimit(60, 60_000), id, validateFeedbackQuery(), validateFeedbackBody(commentModerateSchema), c.moderate);
  return router;
}
export default createCommentRouter();
