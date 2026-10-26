import { z } from 'zod';

export const loginSchema = z.object({
  email: z
    .email('Vui lòng nhập email hợp lệ.')
    .max(254)
    .transform((s) => s.toLowerCase()),
  password: z
    .string()
    .min(8, 'Mật khẩu cần ít nhất 8 ký tự.')
    .max(128, 'Mật khẩu không quá 128 ký tự.'),
});
export type LoginInput = z.infer<typeof loginSchema>;
export const userSchema = z.object({
  id: z.uuid(),
  username: z.string(),
  email: z.email(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  role: z.enum(['USER', 'ADMIN']),
  status: z.enum(['ACTIVE', 'BANNED']),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type AuthUser = z.infer<typeof userSchema>;
export const tokenSchema = z.object({
  user: userSchema,
  accessToken: z
    .string()
    .regex(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    .max(4096),
  refreshToken: z.string().regex(/^[A-Za-z0-9_-]{64}$/),
  tokenType: z.literal('Bearer'),
  expiresIn: z.number().int().positive().max(86400),
});
export type TokenResponse = z.infer<typeof tokenSchema>;
export interface AuthTransport {
  login(input: LoginInput): Promise<TokenResponse>;
  refresh(token: string): Promise<TokenResponse>;
  logout(token: string): Promise<void>;
  me(accessToken: string): Promise<AuthUser>;
}
