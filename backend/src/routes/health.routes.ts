import { Router } from 'express';

const healthRouter = Router();

healthRouter.get('/', (_req, res) => {
  res.json({
    success: true,
    message: 'WebNovel API is running',
  });
});

export default healthRouter;
