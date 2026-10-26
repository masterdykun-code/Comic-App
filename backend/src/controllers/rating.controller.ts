import type { Request, Response } from 'express';
import type { RatingService } from '../services/rating.service';

export function createRatingController(service: RatingService) {
  return {
    async list(_req: Request, res: Response) {
      const result = await service.list(res.locals.storyId, res.locals.feedbackQuery);
      res.json({ success: true, message: 'Ratings retrieved', ...result });
    },
    async save(_req: Request, res: Response) {
      const data = await service.save(res.locals.auth.user.id, res.locals.storyId, res.locals.feedbackInput);
      res.json({ success: true, message: 'Rating saved', data });
    },
    async remove(_req: Request, res: Response) {
      const data = await service.remove(res.locals.auth.user.id, res.locals.storyId);
      res.json({ success: true, message: 'Rating removed', data });
    },
  };
}
