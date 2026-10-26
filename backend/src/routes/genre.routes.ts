import { Router } from 'express';
import * as genreController from '../controllers/genre.controller';
import { validateGenreId, validateGenreStoriesQuery } from '../middlewares/genre.validation';
import { HttpError } from '../utils/http-error';

const genreRouter = Router();

genreRouter.get('/', genreController.listGenres);
genreRouter.get('/:id', validateGenreId, genreController.getGenre);
genreRouter.get('/:id/stories', validateGenreId, validateGenreStoriesQuery, genreController.listGenreStories);

genreRouter.all(['/', '/:id', '/:id/stories'], (_req, res, next) => {
  res.setHeader('Allow', 'GET, HEAD, OPTIONS');
  next(new HttpError(405, 'METHOD_NOT_ALLOWED', 'Method not allowed'));
});

export default genreRouter;
