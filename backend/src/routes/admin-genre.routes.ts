import { Router } from 'express';
import { createAuthenticate, authorizeRole } from '../middlewares/auth.middleware';
import { createAuthRateLimit } from '../middlewares/auth.rate-limit';
import { validateGenreId } from '../middlewares/genre.validation';
import { adminGenreInputSchema, adminGenreUpdateSchema, validateAdminGenreBody, validateAdminGenreEmpty } from '../middlewares/admin-genre.validation';
import { authService, type AuthService } from '../services/auth.service';
import { adminGenreService, type AdminGenreService } from '../services/admin-genre.service';
import { createAdminGenreController } from '../controllers/admin-genre.controller';
import { HttpError } from '../utils/http-error';
export function createAdminGenreRouter(service: AdminGenreService = adminGenreService, auth: AuthService = authService) {
  const router = Router(); const c = createAdminGenreController(service);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); }, createAuthenticate(auth), authorizeRole('ADMIN'), createAuthRateLimit(60, 60000));
  router.use((req, _res, next) => { if (Object.keys(req.query).length) throw new HttpError(400, 'INVALID_QUERY', 'Genre write query parameters are not supported'); next(); });
  router.post('/', validateAdminGenreBody(adminGenreInputSchema), c.create);
  router.patch('/:id', validateGenreId, validateAdminGenreBody(adminGenreUpdateSchema), c.update);
  router.delete('/:id', validateGenreId, validateAdminGenreEmpty, c.remove);
  return router;
}
export default createAdminGenreRouter();
