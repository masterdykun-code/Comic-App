import type { InternalAxiosRequestConfig } from 'axios';
import type { AuthSession } from '../stores/auth';
import { ApiError, safeError } from '../lib/errors';
import { createHttp } from './http';
import { diagnostic, failureDetails } from '../lib/diagnostics';
type Request = InternalAxiosRequestConfig & {
  sessionEpoch?: number;
  retried?: boolean;
  sentToken?: string | null;
};
export function createApiClient(base: string | null, session: AuthSession) {
  const client = createHttp(base);
  client.interceptors.request.use(async (config: Request) => {
    if (config.retried && config.sessionEpoch !== session.generation())
      throw new ApiError(401, 'Phiên đã thay đổi.');
    config.sessionEpoch = session.generation();
    diagnostic('request.auth.start', { baseURL: base, url: config.url, method: config.method });
    try {
      config.sentToken = await session.token();
      diagnostic('request.auth.ready', { baseURL: base, url: config.url, method: config.method });
    } catch (error) {
      diagnostic('request.auth.fail', {
        baseURL: base,
        url: config.url,
        method: config.method,
        ...failureDetails(error),
      });
      throw error;
    }
    if (config.sessionEpoch !== session.generation()) throw new ApiError(401, 'Phiên đã thay đổi.');
    if (config.sentToken) config.headers.set('Authorization', `Bearer ${config.sentToken}`);
    else config.headers.delete('Authorization');
    return config;
  });
  client.interceptors.response.use(
    (value) => {
      if ((value.config as Request).sessionEpoch !== session.generation())
        throw new ApiError(401, 'Phiên đã thay đổi.');
      return value;
    },
    async (error: unknown) => {
      const failure = safeError(error);
      const raw = error as { config?: Request };
      const config = raw?.config;
      if (
        failure.status !== 401 ||
        !config?.sentToken ||
        config.sessionEpoch !== session.generation()
      )
        throw failure;
      if (config.retried || !['get', 'head'].includes(config.method?.toLowerCase() ?? 'get')) {
        await session.invalidate();
        throw failure;
      }
      config.retried = true;
      if (session.peek() === config.sentToken) await session.refresh();
      return client.request(config);
    },
  );
  return client;
}
