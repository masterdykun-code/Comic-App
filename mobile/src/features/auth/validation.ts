import { z } from 'zod';
const email = z.email().max(254).trim().toLowerCase();
const password = z.string().min(8).max(128);
export const loginSchema = z.strictObject({ email, password });
export const registerSchema = loginSchema
  .extend({
    username: z
      .string()
      .trim()
      .min(3)
      .max(30)
      .regex(/^[A-Za-z0-9_]+$/)
      .toLowerCase(),
    confirmPassword: password,
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Mật khẩu xác nhận chưa khớp.',
  });
export function fieldErrors(error: z.ZodError): Record<string, string> {
  const messages: Record<string, string> = {
    email: 'Email chưa hợp lệ (tối đa 254 ký tự).',
    username: 'Username gồm 3–30 chữ Latin, số hoặc dấu gạch dưới.',
    password: 'Mật khẩu cần từ 8 đến 128 ký tự.',
    confirmPassword: 'Mật khẩu xác nhận chưa khớp.',
  };
  return Object.fromEntries(
    error.issues.map((issue) => {
      const name = String(issue.path[0] ?? 'form');
      return [name, messages[name] ?? 'Thông tin chưa hợp lệ.'];
    }),
  );
}
