import type { RequestHandler } from 'express';
import {
  rankingService,
  type RankingService,
} from '../services/ranking.service';
export function createRankingController(
  service: RankingService = rankingService,
) {
  const list: RequestHandler = async (_req, res) => {
    res.json({
      success: true,
      ...(await service.list(res.locals.rankingQuery)),
    });
  };
  return { list };
}
