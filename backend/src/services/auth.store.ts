import { getPrismaClient } from '../config/prisma';
import type { AuthStore } from '../types/auth.types';
import type { PrismaClient } from '../generated/prisma/client';

export function createPrismaAuthStore(client: () => PrismaClient = getPrismaClient): AuthStore {
  return {
  findUserByEmail(email) {
    return client().user.findUnique({ where: { email } });
  },
  createUser(data) {
    return client().user.create({ data: { ...data, role: 'USER', status: 'ACTIVE' } });
  },
  createSession(userId, tokenHash, expiresAt, verifiedPasswordHash) {
    return client().$transaction(async (tx) => {
      // Serialize session creation with password changes; a verified old hash is not enough.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findUnique({ where: { id: userId } });
      if (!user || user.status !== 'ACTIVE' || user.passwordHash !== verifiedPasswordHash) return null;
      const session = await tx.authSession.create({ data: {
        userId, expiresAt, refreshTokens: { create: { tokenHash, expiresAt } },
      } });
      return { user, session };
    });
  },
  rotateRefresh(tokenHash, replacementHash, now) {
    return client().$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!token) return null;
      // Serialize refresh and logout on the session, including across processes.
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${token.sessionId}::uuid FOR UPDATE`;
      const current = await tx.refreshToken.findUnique({ where: { tokenHash } });
      const session = await tx.authSession.findUnique({ where: { id: token.sessionId }, include: { user: true } });
      if (!current || !session || session.revokedAt) return null;
      if (current.consumedAt || current.expiresAt <= now || session.expiresAt <= now || session.user.status !== 'ACTIVE') {
        // Return instead of throwing so revocation commits on replay.
        await tx.authSession.update({ where: { id: session.id }, data: { revokedAt: now } });
        return null;
      }
      await tx.refreshToken.update({ where: { id: current.id }, data: { consumedAt: now } });
      await tx.refreshToken.create({ data: { sessionId: session.id, tokenHash: replacementHash, expiresAt: session.expiresAt } });
      return { user: session.user, session };
    });
  },
  async revokeRefresh(tokenHash, now) {
    await client().$transaction(async (tx) => {
      const token = await tx.refreshToken.findUnique({ where: { tokenHash } });
      if (!token) return;
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${token.sessionId}::uuid FOR UPDATE`;
      await tx.authSession.updateMany({ where: { id: token.sessionId, revokedAt: null }, data: { revokedAt: now } });
    });
  },
  async getActiveSession(userId, sessionId, now) {
    const session = await client().authSession.findFirst({ where: {
      id: sessionId, userId, revokedAt: null, expiresAt: { gt: now }, user: { status: 'ACTIVE' },
    }, include: { user: true } });
    return session ? { user: session.user, session } : null;
  },
  updateProfile(userId, sessionId, data, now) {
    return client().$transaction(async (tx) => {
      // Keep the same user -> session lock order as password changes.
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM auth_sessions WHERE id = ${sessionId}::uuid FOR UPDATE`;
      const session = await tx.authSession.findFirst({ where: {
        id: sessionId, userId, revokedAt: null, expiresAt: { gt: now }, user: { status: 'ACTIVE' },
      } });
      if (!session) return null;
      const result = await tx.user.updateMany({ where: { id: userId, status: 'ACTIVE' }, data });
      return result.count ? tx.user.findUnique({ where: { id: userId } }) : null;
    });
  },
  changePassword(userId, sessionId, expectedHash, newHash, now) {
    return client().$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const session = await tx.authSession.findFirst({ where: {
        id: sessionId, userId, revokedAt: null, expiresAt: { gt: now }, user: { status: 'ACTIVE' },
      } });
      if (!session) return false;
      const changed = await tx.user.updateMany({
        where: { id: userId, status: 'ACTIVE', passwordHash: expectedHash },
        data: { passwordHash: newHash },
      });
      if (!changed.count) return false;
      // Atomic with the hash change. Access JWTs are checked against these sessions too.
      await tx.authSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } });
      await tx.passwordReset.updateMany({ where: { userId, consumedAt: null }, data: { consumedAt: now } });
      return true;
    });
  },
  };
}
export const prismaAuthStore = createPrismaAuthStore();
