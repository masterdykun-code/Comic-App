import type { Request, Response } from "express";
import type { PasswordResetService } from "../services/password-reset.service";
import type { ResetPasswordInput } from "../types/password-reset.types";
export function createPasswordResetController(service: PasswordResetService) {
  return {
    request(_req: Request, res: Response) {
      service.request(res.locals.authInput.email);
      res
        .status(202)
        .json({
          success: true,
          message:
            "If the account is eligible, a verification code will be emailed. Check your inbox and spam folder.",
        });
    },
    async reset(_req: Request, res: Response) {
      await service.reset(res.locals.authInput as ResetPasswordInput);
      res.json({
        success: true,
        message: "Password reset. Sign in again.",
        data: { sessionsRevoked: true },
      });
    },
  };
}
