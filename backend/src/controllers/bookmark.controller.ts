import type { Request, Response } from 'express';
import type { BookmarkService } from '../services/bookmark.service';
export function createBookmarkController(service: BookmarkService) {
  return {
    async list(_req: Request, res: Response) {
      res.json({
        success: true,
        ...(await service.list(
          res.locals.auth.user.id,
          res.locals.readingQuery,
        )),
      });
    },
    async add(_req: Request, res: Response) {
      const result = await service.add(
        res.locals.auth.user.id,
        res.locals.readingInput,
      );
      res.status(result.created ? 201 : 200).json({ success: true, ...result });
    },
    async resolve(_req: Request, res: Response) {
      res.json({
        success: true,
        data: await service.resolve(
          res.locals.auth.user.id,
          res.locals.bookmarkId,
        ),
      });
    },
    async remove(_req: Request, res: Response) {
      res.json({
        success: true,
        data: await service.remove(
          res.locals.auth.user.id,
          res.locals.bookmarkId,
        ),
      });
    },
  };
}
