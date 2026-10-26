import type { RequestHandler } from 'express';
import { coinService, type CoinService } from '../services/coin.service';
export function createCoinController(service: CoinService = coinService) {
  const wallet: RequestHandler = async (_req, res) =>
    res.json({
      success: true,
      data: await service.wallet(
        res.locals.auth.user.id,
        res.locals.coinQuery.page,
        res.locals.coinQuery.limit,
      ),
    });
  const tasks: RequestHandler = async (_req, res) =>
    res.json({
      success: true,
      data: await service.tasks(res.locals.auth.user.id),
    });
  const claim: RequestHandler = async (_req, res) =>
    res.json({
      success: true,
      data: await service.claim(res.locals.auth.user.id, res.locals.rewardKind),
    });
  const access: RequestHandler = async (_req, res) =>
    res.json({
      success: true,
      data: await service.access(
        res.locals.chapterId,
        res.locals.auth?.user.id,
      ),
    });
  const unlock: RequestHandler = async (_req, res) =>
    res.json({
      success: true,
      data: await service.unlock(
        res.locals.auth.user.id,
        res.locals.chapterId,
        res.locals.expectedCoinPrice,
      ),
    });
  return { wallet, tasks, claim, access, unlock };
}
