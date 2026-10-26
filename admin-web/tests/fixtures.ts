import { vi } from 'vitest';
import type { AuthTransport, AuthUser, TokenResponse } from '../src/types/auth';
export const admin: AuthUser = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'qa_admin',
  email: 'admin@example.test',
  displayName: 'QA Admin',
  avatarUrl: null,
  role: 'ADMIN',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};
export const input = { email: 'admin@example.test', password: 'Synthetic-password-123' };
export const initial: TokenResponse = {
  user: admin,
  accessToken: 'old.access.signature',
  refreshToken: 'a'.repeat(64),
  tokenType: 'Bearer',
  expiresIn: 900,
};
export const rotated: TokenResponse = {
  ...initial,
  accessToken: 'new.access.signature',
  refreshToken: 'b'.repeat(64),
};
export function transport() {
  return {
    login: vi.fn<AuthTransport['login']>().mockResolvedValue(initial),
    refresh: vi.fn<AuthTransport['refresh']>().mockResolvedValue(rotated),
    logout: vi.fn<AuthTransport['logout']>().mockResolvedValue(undefined),
    me: vi.fn<AuthTransport['me']>().mockResolvedValue(admin),
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
