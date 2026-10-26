import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../utils/http-error';

const email = z.email().max(254).trim().toLowerCase();
const password = z.string().min(8).max(128);
export const registerSchema = z.strictObject({
  username: z.string().trim().min(3).max(30).regex(/^[A-Za-z0-9_]+$/).toLowerCase(),
  email,
  password,
});
export const loginSchema = z.strictObject({ email, password });
export const changePasswordSchema = z.strictObject({
  currentPassword: password,
  newPassword: password,
  confirmPassword: password,
}).refine(data => data.newPassword === data.confirmPassword)
  .refine(data => data.newPassword !== data.currentPassword);
export const refreshSchema = z.strictObject({ refreshToken: z.string().regex(/^[A-Za-z0-9_-]{64}$/) });
export const profileSchema = z.strictObject({
  displayName: z.string().trim().min(1).max(100).optional(),
  avatarUrl: z.url({ protocol: /^https?$/ }).max(2048).nullable().optional(),
}).refine((data) => Object.keys(data).length > 0);

export function validateAuthBody(schema: z.ZodType): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      // Do not echo input values, including secrets or untrusted field names.
      throw new HttpError(400, 'INVALID_BODY', 'Invalid request body');
    }
    res.locals.authInput = result.data;
    next();
  };
}
