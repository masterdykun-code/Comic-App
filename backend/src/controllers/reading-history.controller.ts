import type { Request, Response } from 'express';
import type { ReadingHistoryService } from '../services/reading-history.service';

export function createReadingHistoryController(service: ReadingHistoryService) {
  return {
    async list(_req: Request, res: Response) {
      const result = await service.list(res.locals.auth.user.id, res.locals.readingQuery);
      res.json({ success: true, message: 'Reading history retrieved', ...result });
    },
    async record(_req: Request, res: Response) {
      const { storyId, chapterId } = res.locals.readingInput;
      const result = await service.record(res.locals.auth.user.id, storyId, chapterId);
      res.status(result.recorded ? 201 : 200).json({ success: true, message: 'Chapter visit recorded', ...result });
    },
    async clear(_req: Request, res: Response) {
      const data = await service.clear(res.locals.auth.user.id);
      res.json({ success: true, message: 'Reading history cleared', data });
    },
  };
}
