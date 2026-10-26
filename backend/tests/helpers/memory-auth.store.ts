import { randomUUID } from 'node:crypto';
import type { AuthSession, User } from '../../src/generated/prisma/client';
import type { AuthContext, AuthStore, ProfileUpdate } from '../../src/types/auth.types';

// No Prisma client or database connection is used by this test double.
export class MemoryAuthStore implements AuthStore {
  users = new Map<string, User>();
  sessions = new Map<string, AuthSession>();
  tokens = new Map<string, { sessionId: string; consumedAt: Date | null; expiresAt: Date }>();

  async findUserByEmail(email: string) {
    return [...this.users.values()].find((u) => u.email === email) ?? null;
  }
  async createUser(data: { username: string; email: string; passwordHash: string; displayName: string }) {
    if ([...this.users.values()].some((u) => u.email === data.email || u.username === data.username)) {
      throw Object.assign(new Error('Unique conflict'), { code: 'P2002' });
    }
    const user: User = { ...data, id: randomUUID(), avatarUrl: null, role: 'USER', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() };
    this.users.set(user.id, user);
    return user;
  }
  async createSession(userId: string, tokenHash: string, expiresAt: Date, verifiedPasswordHash: string) {
    const user = this.users.get(userId);
    if (!user || user.status !== 'ACTIVE' || user.passwordHash !== verifiedPasswordHash) return null;
    const session: AuthSession = { id: randomUUID(), userId, expiresAt, createdAt: new Date(), revokedAt: null };
    this.sessions.set(session.id, session);
    this.tokens.set(tokenHash, { sessionId: session.id, consumedAt: null, expiresAt });
    return { user, session };
  }
  async rotateRefresh(hash: string, replacement: string, now: Date) {
    const token = this.tokens.get(hash);
    const session = token && this.sessions.get(token.sessionId);
    const user = session && this.users.get(session.userId);
    if (!token || !session || session.revokedAt || !user) return null;
    if (token.consumedAt || token.expiresAt <= now || session.expiresAt <= now || user.status !== 'ACTIVE') {
      session.revokedAt = now;
      return null;
    }
    token.consumedAt = now;
    this.tokens.set(replacement, { sessionId: session.id, consumedAt: null, expiresAt: session.expiresAt });
    return { user, session };
  }
  async revokeRefresh(hash: string, now: Date) {
    const token = this.tokens.get(hash);
    const session = token && this.sessions.get(token.sessionId);
    if (session && !session.revokedAt) session.revokedAt = now;
  }
  async getActiveSession(userId: string, sessionId: string, now: Date): Promise<AuthContext | null> {
    const user = this.users.get(userId);
    const session = this.sessions.get(sessionId);
    return user?.status === 'ACTIVE' && session?.userId === userId && !session.revokedAt && session.expiresAt > now ? { user, session } : null;
  }
  async updateProfile(userId: string, sessionId: string, data: ProfileUpdate, now: Date) {
    const context = await this.getActiveSession(userId, sessionId, now);
    if (!context) return null;
    Object.assign(context.user, data, { updatedAt: now });
    return context.user;
  }
  async changePassword(userId: string, sessionId: string, expectedHash: string, newHash: string, now: Date) {
    // No awaits between compare/update: models the atomic persistence boundary.
    const user = this.users.get(userId), session = this.sessions.get(sessionId);
    if (!user || user.status !== 'ACTIVE' || user.passwordHash !== expectedHash ||
        !session || session.userId !== userId || session.revokedAt || session.expiresAt <= now) return false;
    user.passwordHash = newHash;
    user.updatedAt = now;
    for (const value of this.sessions.values()) if (value.userId === userId && !value.revokedAt) value.revokedAt = now;
    return true;
  }
}
