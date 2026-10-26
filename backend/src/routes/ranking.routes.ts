import { Router } from 'express';
import { createRankingController } from '../controllers/ranking.controller';
import {
  rankingService,
  type RankingService,
} from '../services/ranking.service';
import { validateRankingQuery } from '../middlewares/ranking.validation';
export function createRankingRouter(service: RankingService = rankingService) {
  const router = Router();
  router.get(
    '/',
    (_req, res, next) => {
      res.setHeader('Cache-Control', 'no-store');
      next();
    },
    validateRankingQuery,
    createRankingController(service).list,
  );
  return router;
}
export default createRankingRouter();
