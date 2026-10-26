import { configureIntegration } from '../integration/environment';
import { assertPrismaTest, runPrefix } from './fixtures';

async function main() {
  configureIntegration(); const prefix = runPrefix(process.env.E2E_RUN_ID ?? '');
  if (process.argv[2] !== 'expire-admin-session') throw new Error('Unsupported E2E control');
  const { getPrismaClient, disconnectPrisma }: typeof import('../../src/config/prisma') = require('../../src/config/prisma');
  const db = getPrismaClient();
  try {
    await assertPrismaTest(db);
    const admin = await db.user.findUniqueOrThrow({ where: { username: `${prefix}admin` }, select: { id: true, email: true } });
    if (admin.email !== `${prefix}admin@example.invalid`) throw new Error('Fixture identity mismatch');
    await db.authSession.updateMany({ where: { userId: admin.id }, data: { expiresAt: new Date(0) } });
    console.log('PASS: fixture sessions expired in verified test database');
  } finally { await disconnectPrisma(); }
}
main().catch(() => { console.error('E2E fixture control refused or failed; details suppressed'); process.exitCode = 1; });
