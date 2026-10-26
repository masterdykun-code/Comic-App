import { z } from 'zod';
import { isAxiosError, type AxiosInstance } from 'axios';
import { api } from '../../services/runtime';
import { ApiError, safeError } from '../../lib/errors';

const password = z.string().min(8).max(128);
export const changePasswordInput = z
  .strictObject({
    currentPassword: password,
    newPassword: password,
    confirmPassword: password,
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Mật khẩu xác nhận chưa khớp.',
  })
  .refine((value) => value.newPassword !== value.currentPassword, {
    path: ['newPassword'],
    message: 'Mật khẩu mới phải khác mật khẩu hiện tại.',
  });
export type ChangePasswordInput = z.infer<typeof changePasswordInput>;
export function createPasswordApi(client: AxiosInstance) {
  return {
    async change(input: ChangePasswordInput, signal?: AbortSignal): Promise<void> {
      const parsed = changePasswordInput.safeParse(input);
      if (!parsed.success) throw new ApiError(400, 'Kiểm tra lại mật khẩu và xác nhận.');
      try {
        const response = await client.post('/auth/change-password', parsed.data, { signal });
        if (response.data?.success !== true || response.data?.data?.sessionsRevoked !== true)
          throw new ApiError(
            502,
            'Chưa xác nhận kết quả đổi mật khẩu. Hãy thử đăng nhập bằng mật khẩu mới.',
          );
      } catch (error) {
        // Whitelist the error code only. Never retain response bodies or request config.
        if (
          isAxiosError(error) &&
          error.response?.status === 403 &&
          error.response.data?.error?.code === 'CURRENT_PASSWORD_INCORRECT'
        )
          throw new ApiError(403, 'Mật khẩu hiện tại chưa đúng.', 'CURRENT_PASSWORD_INCORRECT');
        const safe = safeError(error);
        // The shared API interceptor intentionally strips raw server bodies.
        if (safe.status === 403)
          throw new ApiError(403, 'Mật khẩu hiện tại chưa đúng.', 'CURRENT_PASSWORD_INCORRECT');
        if (safe.status === 0)
          throw new ApiError(
            0,
            'Chưa xác nhận kết quả do lỗi kết nối. Hãy thử đăng nhập bằng mật khẩu mới trước khi gửi lại.',
          );
        throw safe;
      }
    },
  };
}
export const passwordApi = createPasswordApi(api);
