import { z } from 'zod';
import { isAxiosError, type AxiosInstance } from 'axios';
import { apiBaseUrl } from '../../lib/config';
import { ApiError, safeError } from '../../lib/errors';
import { createHttp } from '../../services/http';

export const recoveryEmailInput = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
});
export const recoveryResetInput = recoveryEmailInput
  .extend({
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128),
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: 'Mật khẩu xác nhận chưa khớp.',
    path: ['confirmPassword'],
  });
export function createPasswordRecoveryApi(client: AxiosInstance) {
  async function send(path: string, input: unknown, signal?: AbortSignal) {
    try {
      const response = await client.post(path, input, { signal });
      if (
        response.data?.success !== true ||
        (path === '/auth/reset-password' && response.data?.data?.sessionsRevoked !== true)
      )
        throw new ApiError(
          502,
          'Chưa xác nhận kết quả. Hãy kiểm tra email hoặc thử đăng nhập bằng mật khẩu mới.',
        );
    } catch (error) {
      if (
        isAxiosError(error) &&
        error.response?.status === 400 &&
        error.response.data?.error?.code === 'INVALID_RESET_CODE'
      )
        throw new ApiError(
          400,
          'Mã không đúng, đã hết hạn hoặc đã được sử dụng. Hãy kiểm tra mã mới nhất.',
          'INVALID_RESET_CODE',
        );
      const safe = safeError(error);
      if (safe.status === 503)
        throw new ApiError(
          503,
          'Dịch vụ email chưa sẵn sàng. Vui lòng thử lại sau hoặc liên hệ quản trị viên.',
        );
      if (safe.status === 0)
        throw new ApiError(
          0,
          'Chưa xác nhận kết quả do lỗi kết nối. Kiểm tra hộp thư hoặc thử đăng nhập bằng mật khẩu mới trước khi gửi lại.',
        );
      throw safe;
    }
  }
  return {
    async request(email: string, signal?: AbortSignal) {
      const parsed = recoveryEmailInput.safeParse({ email });
      if (!parsed.success) throw new ApiError(400, 'Địa chỉ email chưa hợp lệ.');
      await send('/auth/forgot-password', parsed.data, signal);
    },
    async reset(input: z.infer<typeof recoveryResetInput>, signal?: AbortSignal) {
      const parsed = recoveryResetInput.safeParse(input);
      if (!parsed.success)
        throw new ApiError(400, 'Kiểm tra mã 6 chữ số, mật khẩu 8–128 ký tự và xác nhận.');
      await send('/auth/reset-password', parsed.data, signal);
    },
  };
}
// Recovery is anonymous: it must not wait for an old account's refresh interceptor.
export const passwordRecoveryApi = createPasswordRecoveryApi(createHttp(apiBaseUrl));
