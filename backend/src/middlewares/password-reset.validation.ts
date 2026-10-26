import { z } from "zod";
export const forgotPasswordSchema = z.strictObject({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
});
export const resetPasswordSchema = forgotPasswordSchema
  .extend({
    code: z.string().regex(/^\d{6}$/),
    newPassword: z.string().min(8).max(128),
    confirmPassword: z.string().min(8).max(128),
  })
  .refine((data) => data.newPassword === data.confirmPassword);
