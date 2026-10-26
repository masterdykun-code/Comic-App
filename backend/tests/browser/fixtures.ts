import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import type { PrismaClient } from '../../src/generated/prisma/client';
import { APP_TABLES, assertTestDatabase } from '../integration/environment';
import { assertEmpty } from '../integration/database';
import { hashPassword } from '../../src/utils/password';

export function runPrefix(runId: string) {
  if (!/^[a-f0-9]{16}$/.test(runId)) throw new Error('Invalid E2E run identity');
  return `e2e_${runId}_`;
}
export async function assertPrismaTest(db: PrismaClient) {
  const rows = await db.$queryRaw<Array<{ name: string; schema: string }>>`SELECT current_database() AS name, current_schema() AS schema`;
  if (rows[0]?.name !== 'webnovel_test_db' || rows[0]?.schema !== 'public') throw new Error('E2E write target refused');
}
export async function createFixtures(db: PrismaClient, runId: string) {
  await assertPrismaTest(db);
  const prefix = runPrefix(runId);
  const password = `E2e!${randomBytes(24).toString('hex')}`;
  const passwordHash = await hashPassword(password);
  return db.$transaction(async (tx) => {
    const admin = await tx.user.create({ data: { username: `${prefix}admin`, email: `${prefix}admin@example.invalid`, displayName: 'E2E ADMIN', passwordHash, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true, email: true } });
    const user = await tx.user.create({ data: { username: `${prefix}reader`, email: `${prefix}reader@example.invalid`, displayName: 'E2E Reader', passwordHash, role: 'USER', status: 'ACTIVE' }, select: { id: true, email: true } });
    return { admin, user, password };
  });
}

// Stop on foreign data; every delete is scoped to the current run's proven ownership.
export async function cleanupFixtures(db: PrismaClient, guard: Client, runId: string) {
  await assertTestDatabase(guard); await assertPrismaTest(db);
  const prefix = runPrefix(runId);
  await db.$transaction(async (tx) => {
    const users = await tx.user.findMany({ select: { id: true, username: true, email: true } });
    if (users.some((u) => !['admin', 'reader'].some((suffix) => u.username === prefix + suffix && u.email === `${prefix}${suffix}@example.invalid`))) throw new Error('Foreign fixture users: cleanup refused');
    const owned = users.map((u) => u.id);
    const stories = await tx.story.findMany({ select: { id: true, createdBy: true, title: true } });
    if (stories.some((s) => !owned.includes(s.createdBy) || !s.title.startsWith(prefix))) throw new Error('Foreign stories: cleanup refused');
    const genres = await tx.genre.findMany({ select: { id: true, name: true } });
    if (genres.some((g) => !g.name.startsWith(prefix))) throw new Error('Foreign genres: cleanup refused');
    const storyIds = stories.map((s) => s.id); const genreIds = genres.map((g) => g.id);
    await tx.comment.deleteMany({ where: { storyId: { in: storyIds }, userId: { in: owned }, parentId: { not: null } } });
    await tx.comment.deleteMany({ where: { storyId: { in: storyIds }, userId: { in: owned }, parentId: null } });
    await tx.rating.deleteMany({ where: { storyId: { in: storyIds }, userId: { in: owned } } });
    await tx.favorite.deleteMany({ where: { storyId: { in: storyIds }, userId: { in: owned } } });
    await tx.readingHistory.deleteMany({ where: { storyId: { in: storyIds }, userId: { in: owned } } });
    await tx.readingProgress.deleteMany({ where: { storyId: { in: storyIds }, userId: { in: owned } } });
    await tx.chapterPage.deleteMany({ where: { chapter: { storyId: { in: storyIds } } } });
    await tx.chapter.deleteMany({ where: { storyId: { in: storyIds } } });
    await tx.storyGenre.deleteMany({ where: { storyId: { in: storyIds }, genreId: { in: genreIds } } });
    await tx.story.deleteMany({ where: { id: { in: storyIds } } });
    await tx.genre.deleteMany({ where: { id: { in: genreIds } } });
    await tx.passwordReset.deleteMany({ where: { userId: { in: owned } } });
    await tx.refreshToken.deleteMany({ where: { session: { userId: { in: owned } } } });
    await tx.authSession.deleteMany({ where: { userId: { in: owned } } });
    await tx.coinTransaction.deleteMany({ where: { userId: { in: owned } } });
    await tx.coinWallet.deleteMany({ where: { userId: { in: owned } } });
    await tx.coinDailyActivity.deleteMany({ where: { userId: { in: owned } } });
    await tx.chapterUnlock.deleteMany({ where: { userId: { in: owned } } });
    await tx.user.deleteMany({ where: { id: { in: owned } } });
    // Roll back cleanup too if any unknown resource remained.
    for (const table of APP_TABLES) {
      const rows = await tx.$queryRawUnsafe<Array<{ populated: boolean }>>(`SELECT EXISTS(SELECT 1 FROM public."${table}") AS populated`);
      if (rows[0].populated) throw new Error('Unexpected residual data: cleanup transaction rolled back');
    }
  }, { timeout: 15000 });
  await assertEmpty(guard);
}
