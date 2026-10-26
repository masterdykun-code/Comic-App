import { createReadingHistoryController } from '../controllers/reading-history.controller';
import { readingHistoryService, type ReadingHistoryService } from '../services/reading-history.service';
import type { AuthService } from '../services/auth.service';
import { historyInputSchema, validateReadingBody, validateReadingQuery } from '../middlewares/reading.validation';
import { privateReadingRouter } from './reading.router';

export function createReadingHistoryRouter(service: ReadingHistoryService = readingHistoryService, auth?: AuthService) {
  const router = privateReadingRouter(auth); const c = createReadingHistoryController(service);
  router.get('/', validateReadingQuery(true), validateReadingBody(undefined, true), c.list);
  router.post('/', validateReadingQuery(), validateReadingBody(historyInputSchema), c.record);
  router.delete('/', validateReadingQuery(), validateReadingBody(undefined, true), c.clear);
  return router;
}
export default createReadingHistoryRouter();
