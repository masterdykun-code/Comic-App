import { getPrismaClient } from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import type { AdminBootstrapStore } from '../types/admin-bootstrap.types';

export const prismaAdminBootstrapStore: AdminBootstrapStore = {
  async hasAdmin() {
    return Boolean(await getPrismaClient().user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } }));
  },
  transaction(work) {
    return getPrismaClient().$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL lock_timeout = '5s'`;
      // Reserved WebNovel ADMIN-bootstrap namespace/key. Transaction-scoped lock
      // releases automatically on commit/rollback, including across processes.
      // Select an int instead of returning PostgreSQL's unsupported void type.
      await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(1464746308, 1)`;
      return work({
        async hasAdmin() {
          return Boolean(await tx.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } }));
        },
        async identityExists(username, email) {
          return Boolean(await tx.user.findFirst({ where: { OR: [
            { username: { equals: username, mode: 'insensitive' } },
            { email: { equals: email, mode: 'insensitive' } },
          ] }, select: { id: true } }));
        },
        async create(data) {
          const user = await tx.user.create({ data: { ...data, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } });
          return { id: user.id, role: 'ADMIN', status: 'ACTIVE' };
        },
      });
    }, {
      // Fresh snapshots after waiting for the lock are required to see the ADMIN
      // just committed by another CLI. Do not replace with RepeatableRead here.
      isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
      maxWait: 5000, timeout: 10000,
    });
  },
};
