import axios, { type InternalAxiosRequestConfig } from 'axios';
import type { Session } from '../../features/auth/session';
import { apiBaseUrl } from './transport';
import { ApiError, safeError } from './errors';

type AuthConfig = InternalAxiosRequestConfig & {
  authGeneration?: number;
  authRetry?: boolean;
  sentAccessToken?: string;
};
export function createApiClient(session: Session) {
  const client = axios.create({ baseURL: apiBaseUrl, timeout: 12_000, withCredentials: false });
  client.interceptors.request.use(async (config: AuthConfig) => {
    if (config.authRetry && config.authGeneration !== session.generation())
      throw new ApiError(401, 'Phiên đăng nhập đã thay đổi.');
    const target = new URL(client.getUri(config));
    const base = new URL(apiBaseUrl);
    if (
      target.origin !== base.origin ||
      !target.pathname.startsWith(`${base.pathname.replace(/\/$/, '')}/`)
    )
      throw new ApiError(400, 'Địa chỉ API không được phép.');
    config.authGeneration = session.generation();
    config.sentAccessToken = await session.token();
    config.headers.set('Authorization', `Bearer ${config.sentAccessToken}`);
    return config;
  });
  client.interceptors.response.use(
    (response) => response,
    async (error: unknown) => {
      if (!axios.isAxiosError(error)) throw safeError(error);
      const config = error.config as AuthConfig | undefined;
      if (
        error.response?.status !== 401 ||
        !config ||
        config.authGeneration !== session.generation()
      )
        throw safeError(error);
      if (config.authRetry) {
        session.invalidate(config.authGeneration);
        throw safeError(error);
      }
      // Read-only retry by default. Future mutation APIs need an explicit retry /
      // idempotency policy before automatic replay is enabled.
      if (!['get', 'head'].includes(config.method?.toLowerCase() ?? 'get')) {
        session.invalidate(config.authGeneration);
        throw safeError(error);
      }
      config.authRetry = true;
      try {
        if (config.sentAccessToken === session.peek()) await session.refresh();
        return await client.request(config);
      } catch (failure) {
        throw safeError(failure);
      }
    },
  );
  return client;
}
