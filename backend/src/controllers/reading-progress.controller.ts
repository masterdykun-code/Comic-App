import type { Request, Response } from 'express';
import type { ReadingProgressService } from '../services/reading-progress.service';

export function createReadingProgressController(service: ReadingProgressService) {
  return {
    async list(_req: Request, res: Response) {
      const result = await service.list(res.locals.auth.user.id, res.locals.readingQuery);
      res.json({ success: true, message: 'Reading progress retrieved', ...result });
    },
    async get(_req: Request, res: Response) {
      const result = await service.get(res.locals.auth.user.id, res.locals.readingStoryId);
      res.json({ success: true, message: 'Reading position retrieved', ...result });
    },
    async save(_req: Request, res: Response) {
      const result = await service.save(res.locals.auth.user.id, res.locals.readingStoryId, res.locals.readingInput);
      res.json({ success: true, message: 'Reading position saved', ...result });
    },
  };
}
