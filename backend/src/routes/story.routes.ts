import { Router } from 'express';
import { createStoryController } from '../controllers/story.controller';
import { createAuthenticate, authorizeRole } from '../middlewares/auth.middleware';
import { createStorySchema, updateStorySchema, validateDeleteStory, validatePublishBody, validateStoryBody, validateStoryId, validateStoryQuery } from '../middlewares/story.validation';
import { createAuthRateLimit } from '../middlewares/auth.rate-limit';
import { authService, type AuthService } from '../services/auth.service';
import { storyService, type StoryService } from '../services/story.service';

export function createStoryRouters(service: StoryService = storyService, auth: AuthService = authService) {
  const storyRouter = Router();
  const adminStoryRouter = Router();
  const controller = createStoryController(service);
  const authenticate = createAuthenticate(auth);
  const admin = authorizeRole('ADMIN');
  const noStore = Router().use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

  storyRouter.get('/', validateStoryQuery(), controller.list);
  storyRouter.get('/:id', validateStoryId, controller.detail);
  storyRouter.post('/', noStore, authenticate, admin, validateStoryBody(createStorySchema), controller.create);
  storyRouter.patch('/:id', noStore, authenticate, admin, validateStoryId, validateStoryBody(updateStorySchema), controller.update);
  storyRouter.patch('/:id/publish', noStore, authenticate, admin, validateStoryId, validatePublishBody, controller.publish);

  adminStoryRouter.use(noStore, authenticate, admin);
  adminStoryRouter.get('/', validateStoryQuery(true), controller.adminList);
  adminStoryRouter.get('/:id', validateStoryId, controller.adminDetail);
  adminStoryRouter.patch('/:id/unpublish', createAuthRateLimit(30), validateStoryId, validatePublishBody, controller.unpublish);
  adminStoryRouter.delete('/:id', createAuthRateLimit(30), validateStoryId, validateDeleteStory, controller.remove);
  return { storyRouter, adminStoryRouter };
}

export const { storyRouter, adminStoryRouter } = createStoryRouters();
