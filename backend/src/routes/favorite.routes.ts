import { createFavoriteController } from '../controllers/favorite.controller';
import { favoriteService, type FavoriteService } from '../services/favorite.service';
import type { AuthService } from '../services/auth.service';
import { favoriteInputSchema, validateReadingBody, validateReadingQuery, validateReadingStoryId } from '../middlewares/reading.validation';
import { privateReadingRouter } from './reading.router';

export function createFavoriteRouter(service: FavoriteService = favoriteService, auth?: AuthService) {
  const router = privateReadingRouter(auth); const c = createFavoriteController(service);
  router.get('/', validateReadingQuery(true), validateReadingBody(undefined, true), c.list);
  router.post('/', validateReadingQuery(), validateReadingBody(favoriteInputSchema), c.add);
  router.delete('/:storyId', validateReadingStoryId, validateReadingQuery(), validateReadingBody(undefined, true), c.remove);
  return router;
}
export default createFavoriteRouter();
