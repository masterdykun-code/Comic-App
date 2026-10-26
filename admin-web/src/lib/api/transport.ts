import axios from 'axios';
import { z } from 'zod';
import { tokenSchema, userSchema, type AuthTransport } from '../../types/auth';
import { ApiError, safeError } from './errors';

const configured = import.meta.env.VITE_API_BASE_URL as string | undefined;
if (!configured) throw new Error('VITE_API_BASE_URL chưa được cấu hình.');
const parsed = new URL(configured);
if (
  !['http:', 'https:'].includes(parsed.protocol) ||
  parsed.username ||
  parsed.password ||
  parsed.search ||
  parsed.hash
)
  throw new Error('VITE_API_BASE_URL không hợp lệ.');
export const apiBaseUrl = configured.replace(/\/+$/, '');
export const authHttp = axios.create({
  baseURL: apiBaseUrl,
  timeout: 12_000,
  withCredentials: false,
});
const success = <T extends z.ZodType>(schema: T) =>
  z.object({ success: z.literal(true), data: schema });
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw error instanceof z.ZodError
      ? new ApiError(502, 'Phản hồi máy chủ không hợp lệ. Vui lòng thử lại sau.')
      : safeError(error);
  }
}
export const authTransport: AuthTransport = {
  login: (input) =>
    guarded(
      async () => success(tokenSchema).parse((await authHttp.post('/auth/login', input)).data).data,
    ),
  refresh: (refreshToken) =>
    guarded(
      async () =>
        success(tokenSchema).parse((await authHttp.post('/auth/refresh', { refreshToken })).data)
          .data,
    ),
  logout: (refreshToken) =>
    guarded(async () => {
      await authHttp.post('/auth/logout', { refreshToken });
    }),
  me: (token) =>
    guarded(
      async () =>
        success(userSchema).parse(
          (await authHttp.get('/auth/me', { headers: { Authorization: `Bearer ${token}` } })).data,
        ).data,
    ),
};
