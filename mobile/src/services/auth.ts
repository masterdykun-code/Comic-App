import type { AuthTransport, AuthUser, TokenResponse } from '../types/auth';
import { createHttp, safeRequest } from './http';
import type { AxiosInstance } from 'axios';
export function createAuthTransport(
  base: string | null,
  client: AxiosInstance = createHttp(base),
): AuthTransport {
  return {
    login: (input) =>
      safeRequest(
        async () =>
          (
            await client.post<{ data: TokenResponse }>('/auth/login', {
              email: input.email,
              password: input.password,
            })
          ).data.data,
      ),
    register: (input) =>
      safeRequest(
        async () =>
          (
            await client.post<{ data: AuthUser }>('/auth/register', {
              username: input.username,
              email: input.email,
              password: input.password,
            })
          ).data.data,
      ),
    refresh: (refreshToken) =>
      safeRequest(
        async () =>
          (await client.post<{ data: TokenResponse }>('/auth/refresh', { refreshToken })).data.data,
      ),
    logout: (refreshToken) =>
      safeRequest(async () => {
        await client.post('/auth/logout', { refreshToken });
      }),
    me: (accessToken) =>
      safeRequest(
        async () =>
          (
            await client.get<{ data: AuthUser }>('/auth/me', {
              headers: { Authorization: `Bearer ${accessToken}` },
            })
          ).data.data,
      ),
  };
}
