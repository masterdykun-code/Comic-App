import { getDatabaseUrl } from '../config/database-url';
import { disconnectPrisma, getPrismaClient } from '../config/prisma';

async function main(): Promise<void> {
  // Only print our own validation errors, never a driver error or connection URL.
  try {
    getDatabaseUrl();
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid DATABASE_URL.');
    process.exitCode = 1;
    return;
  }

  try {
    const rows = await getPrismaClient().$queryRaw<Array<{ result: number }>>`SELECT 1 AS result`;
    if (rows.length !== 1 || rows[0]?.result !== 1) {
      throw new Error('Unexpected SELECT 1 result');
    }
    console.log('PostgreSQL connection successful: SELECT 1 returned 1.');
  } catch {
    console.error('PostgreSQL check failed. Verify the local DATABASE_URL, PostgreSQL service, database, credentials and network. Connection details are hidden.');
    process.exitCode = 1;
  } finally {
    try {
      await disconnectPrisma();
    } catch {
      console.error('Could not close the PostgreSQL connection cleanly.');
      process.exitCode = 1;
    }
  }
}

void main();
