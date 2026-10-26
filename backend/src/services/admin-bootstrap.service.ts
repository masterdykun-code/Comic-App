import { z } from 'zod';
import { registerSchema } from '../middlewares/auth.validation';
import type { AdminBootstrapStore } from '../types/admin-bootstrap.types';
import { AdminBootstrapError } from '../utils/admin-bootstrap-error';
import { hashPassword } from '../utils/password';
import { prismaAdminBootstrapStore } from './admin-bootstrap.store';

const inputSchema = registerSchema.extend({
  displayName: z.string().trim().min(1).max(100).refine((s) => !s.includes('\0')),
});
export function createAdminBootstrapService(store: AdminBootstrapStore = prismaAdminBootstrapStore) {
  return {
    async checkAvailable() {
      if (await store.hasAdmin()) throw new AdminBootstrapError('ADMIN_EXISTS');
    },
    async create(input: unknown) {
      const parsed = inputSchema.safeParse(input);
      if (!parsed.success) throw new AdminBootstrapError('INVALID_INPUT');
      const { password, ...identity } = parsed.data;
      // No locks or interactive prompts during expensive password hashing.
      const passwordHash = await hashPassword(password);
      try {
        return await store.transaction(async (tx) => {
          if (await tx.hasAdmin()) throw new AdminBootstrapError('ADMIN_EXISTS');
          if (await tx.identityExists(identity.username, identity.email)) throw new AdminBootstrapError('ACCOUNT_CONFLICT');
          return tx.create({ ...identity, passwordHash });
        });
      } catch (error) {
        if (error instanceof AdminBootstrapError) throw error;
        const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
        const meta = typeof error === 'object' && error !== null && 'meta' in error ? error.meta : undefined;
        const lockTimedOut = code === 'P2010' && typeof meta === 'object' && meta !== null && 'code' in meta && meta.code === '55P03';
        if (code === 'P2002') throw new AdminBootstrapError('ACCOUNT_CONFLICT');
        if (code === 'P2028' || code === 'P2034' || code === '55P03' || lockTimedOut) throw new AdminBootstrapError('BOOTSTRAP_BUSY');
        throw new AdminBootstrapError('BOOTSTRAP_FAILED');
      }
    },
  };
}
export type AdminBootstrapService = ReturnType<typeof createAdminBootstrapService>;
export const adminBootstrapService = createAdminBootstrapService();
