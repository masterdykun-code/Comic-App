import type { AuthSession, User } from '../generated/prisma/client';

export type PublicUser = Pick<User, 'id' | 'username' | 'email' | 'displayName' | 'avatarUrl' | 'role' | 'status' | 'createdAt' | 'updatedAt'>;
export type ProfileUpdate = { displayName?: string; avatarUrl?: string | null };
export type RegisterInput = { username: string; email: string; password: string };
export type ChangePasswordInput = { currentPassword: string; newPassword: string; confirmPassword: string };
export type AuthContext = { user: User; session: AuthSession };

// Persistence boundary: tests use an isolated in-memory implementation.
export interface AuthStore {
  findUserByEmail(email: string): Promise<User | null>;
  createUser(data: { username: string; email: string; passwordHash: string; displayName: string }): Promise<User>;
  createSession(userId: string, tokenHash: string, expiresAt: Date, verifiedPasswordHash: string): Promise<AuthContext | null>;
  changePassword(userId: string, sessionId: string, expectedHash: string, newHash: string, now: Date): Promise<boolean>;
  rotateRefresh(tokenHash: string, replacementHash: string, now: Date): Promise<AuthContext | null>;
  revokeRefresh(tokenHash: string, now: Date): Promise<void>;
  getActiveSession(userId: string, sessionId: string, now: Date): Promise<AuthContext | null>;
  updateProfile(userId: string, sessionId: string, data: ProfileUpdate, now: Date): Promise<User | null>;
}

export interface AuthLocals {
  auth: { user: PublicUser; sessionId: string };
  authInput: unknown;
}
