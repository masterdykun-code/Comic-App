import { isAxiosError } from 'axios';
import { Platform } from 'react-native';
import { ApiError } from './errors';

type Event =
  | 'api.config'
  | 'request.auth.start'
  | 'request.auth.ready'
  | 'request.auth.fail'
  | 'request.start'
  | 'request.complete'
  | 'request.fail'
  | 'catalog.parse.fail'
  | 'session.restore.start'
  | 'session.restore.empty'
  | 'session.restore.stored'
  | 'session.restore.complete'
  | 'session.restore.fail'
  | 'session.refresh.start'
  | 'session.refresh.join'
  | 'session.refresh.complete'
  | 'session.refresh.fail'
  | 'vault.read.start'
  | 'vault.read.complete'
  | 'vault.read.fail';
type Failure = {
  kind: 'network' | 'timeout' | 'http' | 'cancelled' | 'application';
  code?: string;
  status?: number;
};
type Fields = Partial<Failure> & {
  baseURL?: string | null;
  method?: string;
  url?: string;
  requestId?: number;
  timeoutMs?: number;
  durationMs?: number;
};
const codes = new Set([
  'ERR_NETWORK',
  'ECONNABORTED',
  'ETIMEDOUT',
  'ERR_CANCELED',
  'ERR_BAD_REQUEST',
  'ERR_BAD_RESPONSE',
  'API_NOT_CONFIGURED',
  'TIMEOUT',
]);
const routes = new Set([
  '/stories',
  '/genres',
  '/auth/login',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/me',
]);
export function failureDetails(error: unknown): Failure {
  if (isAxiosError(error)) {
    const code = codes.has(error.code ?? '') ? error.code : undefined;
    const status = error.response?.status;
    return {
      kind:
        error.code === 'ERR_CANCELED'
          ? 'cancelled'
          : ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code ?? '')
            ? 'timeout'
            : status
              ? 'http'
              : 'network',
      code,
      status,
    };
  }
  return {
    kind: 'application',
    status: error instanceof ApiError ? error.status : undefined,
    code: error instanceof ApiError && codes.has(error.code ?? '') ? error.code : undefined,
  };
}
function safeBase(value: string | null | undefined): string | undefined {
  try {
    const url = new URL(value ?? '');
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.pathname.replace(/\/$/, '') !== '/api'
    )
      return undefined;
    return url.origin + '/api';
  } catch {
    return undefined;
  }
}
// Fixed fields only: never log an Axios config/error, headers, payload, query, user or token.
export function diagnostic(event: Event, fields: Fields = {}) {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;
  try {
    const baseURL = safeBase(fields.baseURL);
    let path: string | undefined;
    if (fields.url) {
      const parsed = new URL(fields.url, (baseURL ?? 'http://redacted.invalid/api') + '/');
      const relative = parsed.pathname.replace(/^\/api(?=\/|$)/, '');
      path = routes.has(relative) ? '/api' + relative : '/api/[redacted]';
    }
    console.info(
      '[WebNovel diagnostic]',
      JSON.stringify({
        event,
        platform: ['android', 'ios', 'web'].includes(Platform.OS) ? Platform.OS : 'other',
        time: Date.now(),
        baseURL,
        path,
        method: ['get', 'head', 'post', 'put', 'patch', 'delete', 'options'].includes(
          fields.method?.toLowerCase() ?? '',
        )
          ? fields.method?.toUpperCase()
          : undefined,
        requestId: fields.requestId,
        timeoutMs: fields.timeoutMs,
        durationMs: fields.durationMs,
        kind: fields.kind,
        status: fields.status,
        code: codes.has(fields.code ?? '') ? fields.code : undefined,
      }),
    );
  } catch {
    /* Diagnostics must never interrupt application requests. */
  }
}
