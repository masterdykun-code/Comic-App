import { privateReadingRouter } from './reading.router';
import {
  bookmarkService,
  type BookmarkService,
} from '../services/bookmark.service';
import type { AuthService } from '../services/auth.service';
import { createBookmarkController } from '../controllers/bookmark.controller';
import {
  bookmarkInputSchema,
  validateBookmarkId,
} from '../middlewares/bookmark.validation';
import {
  validateReadingBody,
  validateReadingQuery,
} from '../middlewares/reading.validation';
import { createAuthRateLimit } from '../middlewares/auth.rate-limit';
export function createBookmarkRouter(
  service: BookmarkService = bookmarkService,
  auth?: AuthService,
) {
  const router = privateReadingRouter(auth),
    c = createBookmarkController(service);
  router.get(
    '/',
    validateReadingQuery(true),
    validateReadingBody(undefined, true),
    c.list,
  );
  router.post(
    '/',
    createAuthRateLimit(60),
    validateReadingQuery(),
    validateReadingBody(bookmarkInputSchema),
    c.add,
  );
  router.get(
    '/:id',
    validateBookmarkId,
    validateReadingQuery(),
    validateReadingBody(undefined, true),
    c.resolve,
  );
  router.delete(
    '/:id',
    createAuthRateLimit(60),
    validateBookmarkId,
    validateReadingQuery(),
    validateReadingBody(undefined, true),
    c.remove,
  );
  return router;
}
export default createBookmarkRouter();
