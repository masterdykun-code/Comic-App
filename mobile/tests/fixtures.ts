import type { AuthTransport, AuthUser, RefreshVault, TokenResponse } from '../src/types/auth';
export const user: AuthUser = {
  id: '10000000-0000-4000-8000-000000000001',
  username: 'test_reader',
  email: 'reader@example.invalid',
  displayName: 'Bạn đọc kiểm thử',
  avatarUrl: null,
  role: 'USER',
  status: 'ACTIVE',
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
};
export const input = { email: user.email, password: 'Synthetic-only-password' };
export const initial: TokenResponse = {
  user,
  accessToken: 'synthetic.access.signature',
  refreshToken: 'a'.repeat(64),
  expiresIn: 900,
  tokenType: 'Bearer',
};
export const rotated: TokenResponse = {
  ...initial,
  accessToken: 'rotated.access.signature',
  refreshToken: 'b'.repeat(64),
};
export function transport(): jest.Mocked<AuthTransport> {
  return {
    login: jest.fn().mockResolvedValue(initial),
    register: jest.fn().mockResolvedValue(user),
    refresh: jest.fn().mockResolvedValue(rotated),
    logout: jest.fn().mockResolvedValue(undefined),
    me: jest.fn().mockResolvedValue(user),
  };
}
export function vault(stored: string | null = null): RefreshVault & { value: () => string | null } {
  let value = stored;
  return {
    value: () => value,
    get: jest.fn(async () => value),
    set: jest.fn(async (next: string) => {
      value = next;
    }),
    remove: jest.fn(async () => {
      value = null;
    }),
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
