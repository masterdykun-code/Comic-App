import type { Request, Response } from 'express';
import * as genreService from '../services/genre.service';
import type { GenreLocals } from '../types/genre.types';

export async function listGenres(_req: Request, res: Response) {
  const data = await genreService.listGenres();
  res.json({ success: true, message: 'Genres retrieved successfully', data });
}

export async function getGenre(_req: Request, res: Response<unknown, GenreLocals>) {
  const data = await genreService.getGenreById(res.locals.genreId);
  res.json({ success: true, message: 'Genre retrieved successfully', data });
}

export async function listGenreStories(_req: Request, res: Response<unknown, GenreLocals>) {
  const result = await genreService.listGenreStories(res.locals.genreId, res.locals.genreStoriesQuery);
  res.json({ success: true, message: 'Genre stories retrieved successfully', ...result });
}
