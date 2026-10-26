import type { Prisma } from '../generated/prisma/client';
export async function canReadVip(
  tx: Prisma.TransactionClient,
  chapterId: string,
  userId?: string,
) {
  if (!userId) return false;
  const user = await tx.user.findFirst({
    where: { id: userId, status: 'ACTIVE' },
    select: { role: true },
  });
  if (!user) return false;
  return (
    user.role === 'ADMIN' ||
    Boolean(
      await tx.chapterUnlock.findUnique({
        where: { userId_chapterId: { userId, chapterId } },
        select: { userId: true },
      }),
    )
  );
}
