import { createReadingProgressController } from '../controllers/reading-progress.controller';
import { readingProgressService, type ReadingProgressService } from '../services/reading-progress.service';
import type { AuthService } from '../services/auth.service';
import { progressInputSchema, validateReadingBody, validateReadingQuery, validateReadingStoryId } from '../middlewares/reading.validation';
import { privateReadingRouter } from './reading.router';

export function createReadingProgressRouter(service: ReadingProgressService = readingProgressService, auth?: AuthService) {
  const router = privateReadingRouter(auth); const c = createReadingProgressController(service);
  router.get('/', validateReadingQuery(true), validateReadingBody(undefined, true), c.list);
  router.get('/:storyId', validateReadingStoryId, validateReadingQuery(), validateReadingBody(undefined, true), c.get);
  router.put('/:storyId', validateReadingStoryId, validateReadingQuery(), validateReadingBody(progressInputSchema), c.save);
  return router;
}
export default createReadingProgressRouter();
