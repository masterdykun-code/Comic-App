import { createHash, randomBytes, randomUUID } from 'node:crypto';
import argon2 from 'argon2';
import jwt from 'jsonwebtoken';
import { ACCESS_TOKEN_SECONDS, getJwtSecret, JWT_AUDIENCE, JWT_ISSUER, SESSION_SECONDS } from '../config/auth';
import type { User } from '../generated/prisma/client';
import type { AuthContext, AuthStore, ChangePasswordInput, ProfileUpdate, PublicUser, RegisterInput } from '../types/auth.types';
import { HttpError } from '../utils/http-error';
import { prismaAuthStore } from './auth.store';
import { hashPassword } from '../utils/password';

export const hashRefreshToken = (token: string) => createHash('sha256').update(token).digest('hex');
const unauthorized = () => new HttpError(401, 'UNAUTHORIZED', 'Invalid credentials or session');
const newRefreshToken = () => randomBytes(48).toString('base64url');
let dummyHash: Promise<string> | undefined;

function publicUser(user: User): PublicUser {
  const { id, username, email, displayName, avatarUrl, role, status, createdAt, updatedAt } = user;
  return { id, username, email, displayName, avatarUrl, role, status, createdAt, updatedAt };
}

export function createAuthService(store: AuthStore = prismaAuthStore) {
  function tokens(context: AuthContext, refreshToken: string) {
    const accessToken = jwt.sign({ sid: context.session.id, tokenUse: 'access' }, getJwtSecret(), {
      algorithm: 'HS256', expiresIn: ACCESS_TOKEN_SECONDS, subject: context.user.id,
      issuer: JWT_ISSUER, audience: JWT_AUDIENCE, jwtid: randomUUID(),
    });
    return { user: publicUser(context.user), accessToken, refreshToken, tokenType: 'Bearer', expiresIn: ACCESS_TOKEN_SECONDS };
  }
  return {
    async register(input: RegisterInput) {
      const passwordHash = await hashPassword(input.password);
      try {
        return publicUser(await store.createUser({ username: input.username, email: input.email, passwordHash, displayName: input.username }));
      } catch (error) {
        if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') {
          throw new HttpError(409, 'ACCOUNT_CONFLICT', 'Email or username is already in use');
        }
        throw error;
      }
    },
    async login(email: string, password: string) {
      getJwtSecret(); // Fail before persisting a session if configuration is missing.
      const user = await store.findUserByEmail(email);
      dummyHash ??= hashPassword(randomBytes(32).toString('hex'));
      const valid = await argon2.verify(user?.passwordHash ?? await dummyHash, password);
      if (!user || !user.passwordHash || !valid || user.status !== 'ACTIVE') throw unauthorized();
      const refreshToken = newRefreshToken();
      const context = await store.createSession(user.id, hashRefreshToken(refreshToken), new Date(Date.now() + SESSION_SECONDS * 1000), user.passwordHash);
      if (!context) throw unauthorized();
      return tokens(context, refreshToken);
    },
    async refresh(refreshToken: string) {
      getJwtSecret();
      const replacement = newRefreshToken();
      const context = await store.rotateRefresh(hashRefreshToken(refreshToken), hashRefreshToken(replacement), new Date());
      if (!context) throw unauthorized();
      return tokens(context, replacement);
    },
    async logout(refreshToken: string) {
      await store.revokeRefresh(hashRefreshToken(refreshToken), new Date());
    },
    async authenticate(accessToken: string) {
      const secret = getJwtSecret();
      let claims: jwt.JwtPayload;
      try {
        const decoded = jwt.verify(accessToken, secret, {
          algorithms: ['HS256'], issuer: JWT_ISSUER, audience: JWT_AUDIENCE, maxAge: ACCESS_TOKEN_SECONDS,
        });
        if (typeof decoded === 'string' || typeof decoded.sub !== 'string' || typeof decoded.sid !== 'string' ||
            decoded.tokenUse !== 'access' || typeof decoded.exp !== 'number' ||
            !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(decoded.sub) ||
            !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(decoded.sid)) throw unauthorized();
        claims = decoded;
      } catch { throw unauthorized(); }
      const context = await store.getActiveSession(claims.sub!, claims.sid as string, new Date());
      if (!context) throw unauthorized();
      return { user: publicUser(context.user), sessionId: context.session.id };
    },
    async updateProfile(userId: string, sessionId: string, data: ProfileUpdate) {
      const user = await store.updateProfile(userId, sessionId, data, new Date());
      if (!user) throw unauthorized();
      return publicUser(user);
    },
    async changePassword(userId: string, sessionId: string, input: ChangePasswordInput) {
      const context = await store.getActiveSession(userId, sessionId, new Date());
      if (!context) throw unauthorized();
      const previousHash = context.user.passwordHash;
      if (!previousHash || !(await argon2.verify(previousHash, input.currentPassword)))
        throw new HttpError(403, 'CURRENT_PASSWORD_INCORRECT', 'Current password is incorrect');
      const newHash = await hashPassword(input.newPassword);
      if (!(await store.changePassword(userId, sessionId, previousHash, newHash, new Date())))
        throw unauthorized();
    },
  };
}

export type AuthService = ReturnType<typeof createAuthService>;
export const authService = createAuthService();
