import type { Request, Response } from 'express';
import type { FavoriteService } from '../services/favorite.service';

export function createFavoriteController(service: FavoriteService) {
  return {
    async list(_req: Request, res: Response) {
      const result = await service.list(res.locals.auth.user.id, res.locals.readingQuery);
      res.json({ success: true, message: 'Favorites retrieved', ...result });
    },
    async add(_req: Request, res: Response) {
      const data = await service.add(res.locals.auth.user.id, res.locals.readingInput.storyId);
      res.status(201).json({ success: true, message: 'Favorite added', data });
    },
    async remove(_req: Request, res: Response) {
      const data = await service.remove(res.locals.auth.user.id, res.locals.readingStoryId);
      res.json({ success: true, message: 'Favorite removed', data });
    },
  };
}
