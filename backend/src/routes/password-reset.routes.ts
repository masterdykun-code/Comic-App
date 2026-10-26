import { createHash } from "node:crypto";
import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { createAuthRateLimit } from "../middlewares/auth.rate-limit";
import { validateAuthBody } from "../middlewares/auth.validation";
import {
  forgotPasswordSchema,
  resetPasswordSchema,
} from "../middlewares/password-reset.validation";
import {
  passwordResetService,
  type PasswordResetService,
} from "../services/password-reset.service";
import { createPasswordResetController } from "../controllers/password-reset.controller";
import { HttpError } from "../utils/http-error";

export function createPasswordResetRouter(
  service: PasswordResetService = passwordResetService,
) {
  const router = Router();
  const controller = createPasswordResetController(service);
  router.use((_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  const perEmail = rateLimit({
    windowMs: 3600000,
    limit: 3,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (_req, res) =>
      createHash("sha256").update(res.locals.authInput.email).digest("hex"),
    handler: (_req, _res, next) =>
      next(
        new HttpError(
          429,
          "RATE_LIMITED",
          "Too many requests; try again later",
        ),
      ),
  });
  router.post(
    "/forgot-password",
    createAuthRateLimit(5),
    validateAuthBody(forgotPasswordSchema),
    perEmail,
    controller.request,
  );
  router.post(
    "/reset-password",
    createAuthRateLimit(20),
    validateAuthBody(resetPasswordSchema),
    controller.reset,
  );
  return router;
}
export default createPasswordResetRouter();
