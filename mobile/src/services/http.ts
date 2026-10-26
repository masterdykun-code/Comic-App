import { create } from 'axios';
import { ApiError, safeError } from '../lib/errors';
import { requireApiBaseUrl } from '../lib/config';
import { diagnostic, failureDetails } from '../lib/diagnostics';
let requestSequence = 0;
export function createHttp(base: string | null) {
  diagnostic('api.config', { baseURL: base, timeoutMs: 12000 });
  const active = new WeakMap<object, { requestId: number; started: number }>();
  const client = create({
    ...(base ? { baseURL: base } : {}),
    timeout: 12000,
    withCredentials: false,
  });
  client.interceptors.request.use((config) => {
    const origin = new URL(requireApiBaseUrl(base));
    const target = new URL(client.getUri(config));
    if (
      target.origin !== origin.origin ||
      !target.pathname.startsWith(origin.pathname.replace(/\/$/, '') + '/')
    )
      throw new ApiError(400, 'Địa chỉ API không được phép.');
    const metadata = { requestId: ++requestSequence, started: Date.now() };
    active.set(config, metadata);
    diagnostic('request.start', {
      baseURL: base,
      url: config.url,
      method: config.method,
      requestId: metadata.requestId,
      timeoutMs: config.timeout,
    });
    return config;
  });
  client.interceptors.response.use(
    (response) => {
      const metadata = active.get(response.config);
      diagnostic('request.complete', {
        baseURL: base,
        url: response.config.url,
        method: response.config.method,
        status: response.status,
        requestId: metadata?.requestId,
        durationMs: metadata ? Date.now() - metadata.started : undefined,
      });
      return response;
    },
    (error: unknown) => {
      // Only inspect config to select safe scalar fields; never pass it to the logger.
      const config = (error as { config?: { url?: string; method?: string; timeout?: number } })
        ?.config;
      const metadata = config ? active.get(config) : undefined;
      diagnostic('request.fail', {
        baseURL: base,
        url: config?.url,
        method: config?.method,
        requestId: metadata?.requestId,
        timeoutMs: config?.timeout,
        durationMs: metadata ? Date.now() - metadata.started : undefined,
        ...failureDetails(error),
      });
      return Promise.reject(error);
    },
  );
  return client;
}
export async function safeRequest<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw safeError(error);
  }
}
