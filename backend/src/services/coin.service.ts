import { getPrismaClient } from '../config/prisma';
import type { Prisma, PrismaClient } from '../generated/prisma/client';
import { HttpError } from '../utils/http-error';
import { isTransactionConflict } from '../utils/transaction-conflict';
import { canReadVip } from './vip-access';
export const coinDay = (now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
export const COIN_REWARDS = {
  CHECK_IN: 10,
  READ_THREE: 20,
  FAVORITE: 5,
} as const;
export type RewardKind = keyof typeof COIN_REWARDS;
export function createCoinService(
  client: () => PrismaClient = getPrismaClient,
  clock: () => number = Date.now,
) {
  async function run<T>(
    userId: string,
    write: boolean,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await client().$transaction(
        async (tx) => {
          if (write) {
            await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
            await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${userId}::text, 1464746311::bigint))`;
          }
          if (
            !(await tx.user.findFirst({
              where: { id: userId, status: 'ACTIVE' },
              select: { id: true },
            }))
          )
            throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
          return work(tx);
        },
        {
          isolationLevel: write ? 'ReadCommitted' : 'RepeatableRead',
          timeout: 15000,
          maxWait: 5000,
        },
      );
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (
        isTransactionConflict(error) ||
        ['P2002', 'P2034', 'P2028', '55P03'].includes(code ?? '') ||
        (code === 'P2010' &&
          (error as { meta?: { code?: string } }).meta?.code === '55P03')
      )
        throw new HttpError(409, 'COIN_BUSY', 'Check wallet and retry');
      if (['P2003', 'P2025'].includes(code ?? ''))
        throw new HttpError(404, 'CHAPTER_NOT_FOUND', 'Chapter unavailable');
      throw error;
    }
  }
  async function progress(
    tx: Prisma.TransactionClient,
    userId: string,
    day: string,
  ) {
    const reads = await tx.coinDailyActivity.count({
      where: { userId, day, kind: 'READ' },
    });
    const favorites = await tx.coinDailyActivity.count({
      where: { userId, day, kind: 'FAVORITE' },
    });
    return { READ_THREE: Math.min(reads, 3), FAVORITE: Math.min(favorites, 1) };
  }
  async function move(
    tx: Prisma.TransactionClient,
    userId: string,
    amount: number,
    eventKey: string,
    kind: string,
    description: string,
  ) {
    const wallet = await tx.coinWallet.upsert({
      where: { userId },
      create: { userId },
      update: {},
    });
    if (wallet.balance + amount < 0)
      throw new HttpError(409, 'INSUFFICIENT_COINS', 'Not enough coins');
    if (wallet.balance + amount > 2147483647)
      throw new HttpError(409, 'COIN_BALANCE_LIMIT', 'Wallet balance limit');
    const next = await tx.coinWallet.update({
      where: { userId },
      data: { balance: { increment: amount } },
    });
    await tx.coinTransaction.create({
      data: {
        userId,
        eventKey,
        kind,
        amount,
        balanceAfter: next.balance,
        description,
      },
    });
    return next.balance;
  }
  async function published(
    tx: Prisma.TransactionClient,
    id: string,
    lock = false,
  ) {
    let chapter = await tx.chapter.findUnique({
      where: { id },
      select: {
        id: true,
        storyId: true,
        title: true,
        isVip: true,
        coinPrice: true,
        publishStatus: true,
        story: { select: { publishStatus: true, type: true } },
      },
    });
    if (chapter && lock) {
      await tx.$queryRaw`SELECT id FROM public.stories WHERE id = ${chapter.storyId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM public.chapters WHERE id = ${id}::uuid FOR SHARE`;
      chapter = await tx.chapter.findUnique({
        where: { id },
        select: {
          id: true,
          storyId: true,
          title: true,
          isVip: true,
          coinPrice: true,
          publishStatus: true,
          story: { select: { publishStatus: true, type: true } },
        },
      });
    }
    if (
      !chapter ||
      chapter.publishStatus !== 'PUBLISHED' ||
      chapter.story.publishStatus !== 'PUBLISHED'
    )
      throw new HttpError(404, 'CHAPTER_NOT_FOUND', 'Chapter unavailable');
    return chapter;
  }
  return {
    wallet(userId: string, page = 1, limit = 20) {
      return run(userId, false, async (tx) => {
        const wallet = await tx.coinWallet.findUnique({ where: { userId } });
        const total = await tx.coinTransaction.count({ where: { userId } });
        const transactions = await tx.coinTransaction.findMany({
          where: { userId },
          select: {
            id: true,
            kind: true,
            amount: true,
            balanceAfter: true,
            description: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * limit,
          take: limit,
        });
        return {
          balance: wallet?.balance ?? 0,
          transactions,
          pagination: {
            page,
            limit,
            total,
            totalPages: Math.ceil(total / limit),
          },
        };
      });
    },
    tasks(userId: string) {
      return run(userId, false, async (tx) => {
        const day = coinDay(new Date(clock())),
          counts = await progress(tx, userId, day);
        const claimed = await tx.coinTransaction.findMany({
          where: {
            userId,
            eventKey: {
              in: (Object.keys(COIN_REWARDS) as RewardKind[]).map(
                (kind) => `${kind}:${userId}:${day}`,
              ),
            },
          },
          select: { kind: true },
        });
        const has = (kind: string) => claimed.some((r) => r.kind === kind);
        return {
          day,
          timeZone: 'Asia/Ho_Chi_Minh',
          checkedIn: has('CHECK_IN'),
          checkInReward: 10,
          missions: [
            {
              kind: 'READ_THREE',
              title: 'Đọc 3 chương khác nhau',
              progress: counts.READ_THREE,
              target: 3,
              reward: 20,
              claimed: has('READ_THREE'),
            },
            {
              kind: 'FAVORITE',
              title: 'Thêm một truyện vào yêu thích',
              progress: counts.FAVORITE,
              target: 1,
              reward: 5,
              claimed: has('FAVORITE'),
            },
          ],
        };
      });
    },
    claim(userId: string, kind: RewardKind) {
      return run(userId, true, async (tx) => {
        const day = coinDay(new Date(clock())),
          eventKey = `${kind}:${userId}:${day}`;
        const previous = await tx.coinTransaction.findUnique({
          where: { eventKey },
        });
        if (previous)
          return {
            received: false,
            reward: 0,
            balance: (await tx.coinWallet.findUnique({ where: { userId } }))!
              .balance,
          };
        if (kind !== 'CHECK_IN') {
          const counts = await progress(tx, userId, day);
          if (counts[kind] < (kind === 'READ_THREE' ? 3 : 1))
            throw new HttpError(
              409,
              'MISSION_NOT_READY',
              'Mission not completed',
            );
        }
        const label = {
          CHECK_IN: 'Điểm danh',
          READ_THREE: 'Nhiệm vụ đọc 3 chương',
          FAVORITE: 'Nhiệm vụ yêu thích truyện',
        }[kind];
        const balance = await move(
          tx,
          userId,
          COIN_REWARDS[kind],
          eventKey,
          kind,
          `${label} · ${day}`,
        );
        return { received: true, reward: COIN_REWARDS[kind], balance };
      });
    },
    async access(id: string, userId?: string) {
      return client().$transaction(
        async (tx) => {
          const chapter = await published(tx, id);
          const canRead = !chapter.isVip || (await canReadVip(tx, id, userId));
          return {
            id,
            storyId: chapter.storyId,
            title: chapter.title,
            type: chapter.story.type,
            isVip: chapter.isVip,
            coinPrice: chapter.isVip ? chapter.coinPrice : 0,
            canRead,
          };
        },
        { isolationLevel: 'RepeatableRead' },
      );
    },
    unlock(userId: string, id: string, expectedCoinPrice: number) {
      return run(userId, true, async (tx) => {
        const chapter = await published(tx, id, true);
        if (!chapter.isVip || (await canReadVip(tx, id, userId)))
          return {
            unlocked: true,
            charged: 0,
            balance:
              (await tx.coinWallet.findUnique({ where: { userId } }))
                ?.balance ?? 0,
          };
        if (chapter.coinPrice !== expectedCoinPrice)
          throw new HttpError(
            409,
            'VIP_PRICE_CHANGED',
            'Chapter price changed; confirm current price',
          );
        const eventKey = `UNLOCK:${userId}:${id}`;
        const old = await tx.coinTransaction.findUnique({
          where: { eventKey },
        });
        const balance = old
          ? (await tx.coinWallet.findUnique({ where: { userId } }))!.balance
          : await move(
              tx,
              userId,
              -chapter.coinPrice,
              eventKey,
              'UNLOCK',
              `Mở khóa: ${chapter.title}`,
            );
        await tx.chapterUnlock.create({
          data: {
            userId,
            chapterId: id,
            paidCoins: old ? -old.amount : chapter.coinPrice,
          },
        });
        return {
          unlocked: true,
          charged: old ? 0 : chapter.coinPrice,
          balance,
        };
      });
    },
  };
}
export type CoinService = ReturnType<typeof createCoinService>;
export const coinService = createCoinService();
