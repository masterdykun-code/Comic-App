import type { Request, Response } from 'express';
import type { AdminGenreService } from '../services/admin-genre.service';
export function createAdminGenreController(service: AdminGenreService) {
  return {
    async create(_req: Request, res: Response) { const data = await service.create(res.locals.auth.user.id, res.locals.genreInput); res.status(201).json({ success: true, message: 'Genre created', data }); },
    async update(_req: Request, res: Response) { const data = await service.update(res.locals.auth.user.id, res.locals.genreId, res.locals.genreInput); res.json({ success: true, message: 'Genre updated', data }); },
    async remove(_req: Request, res: Response) { const data = await service.remove(res.locals.auth.user.id, res.locals.genreId); res.json({ success: true, message: 'Genre removed', data }); },
  };
}
