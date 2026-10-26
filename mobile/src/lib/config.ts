import { ApiError } from './errors';
export function parseApiBaseUrl(raw: string | undefined): string | null {
  if (!raw?.trim()) return null;
  try {
    const url = new URL(raw.trim());
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname.replace(/\/$/, '') !== '/api'
    )
      return null;
    return url.toString().replace(/\/$/, '');
  } catch {
    return null;
  }
}
export const apiBaseUrl = parseApiBaseUrl(process.env.EXPO_PUBLIC_API_BASE_URL);
export function requireApiBaseUrl(base: string | null): string {
  if (!base)
    throw new ApiError(0, 'Chưa cấu hình EXPO_PUBLIC_API_BASE_URL hợp lệ.', 'API_NOT_CONFIGURED');
  return base;
}
