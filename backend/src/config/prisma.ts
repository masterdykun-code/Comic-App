import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client';
import { getDatabaseUrl } from './database-url';

let client: PrismaClient | undefined;

// Lazily share one client/pool across services in this Node.js process.
export function getPrismaClient(): PrismaClient {
  if (!client) {
    const adapter = new PrismaPg({
      connectionString: getDatabaseUrl(),
      connectionTimeoutMillis: 5000,
    });
    client = new PrismaClient({ adapter, log: [] });
  }

  return client;
}

export async function disconnectPrisma(): Promise<void> {
  if (client) {
    await client.$disconnect();
    client = undefined;
  }
}
