import { Router } from 'express';
import { createRatingController } from '../controllers/rating.controller';
import { createAuthenticate } from '../middlewares/auth.middleware';
import { ratingInputSchema, validateFeedbackBody, validateFeedbackParam, validateFeedbackQuery } from '../middlewares/feedback.validation';
import { authService, type AuthService } from '../services/auth.service';
import { ratingService, type RatingService } from '../services/rating.service';

export function createRatingRouter(service: RatingService = ratingService, auth: AuthService = authService) {
  const router = Router(); const c = createRatingController(service); const authenticate = createAuthenticate(auth);
  const storyId = validateFeedbackParam('storyId');
  const noStore: import('express').RequestHandler = (_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); };
  router.get('/api/stories/:storyId/ratings', noStore, storyId, validateFeedbackQuery('newest'), validateFeedbackBody(undefined, true), c.list);
  router.put('/api/stories/:storyId/my-rating', noStore, authenticate, storyId, validateFeedbackQuery(), validateFeedbackBody(ratingInputSchema), c.save);
  router.delete('/api/stories/:storyId/my-rating', noStore, authenticate, storyId, validateFeedbackQuery(), validateFeedbackBody(undefined, true), c.remove);
  return router;
}
export default createRatingRouter();
