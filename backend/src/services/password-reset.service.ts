import { createHmac, randomInt } from "node:crypto";
import { getJwtSecret } from "../config/auth";
import { smtpResetMailer } from "../config/mail";
import type {
  PasswordResetStore,
  ResetMailer,
  ResetPasswordInput,
} from "../types/password-reset.types";
import { hashPassword } from "../utils/password";
import { HttpError } from "../utils/http-error";
import { prismaPasswordResetStore } from "./password-reset.store";

export function resetCodeHash(userId: string, code: string) {
  // An offline DB dump alone cannot cheaply brute-force a six-digit PIN.
  return createHmac("sha256", getJwtSecret())
    .update(`password-reset\0${userId}\0${code}`)
    .digest("hex");
}
export function createPasswordResetService(
  store: PasswordResetStore = prismaPasswordResetStore,
  mailer: ResetMailer = smtpResetMailer,
  clock: () => Date = () => new Date(),
  onDeliveryError: () => void = () =>
    console.warn(
      "[WebNovel] Password recovery delivery failed; details suppressed.",
    ),
) {
  const pending = new Set<Promise<void>>();
  return {
    request(email: string) {
      // Configuration/queue failures apply equally to all emails, not only existing users.
      getJwtSecret();
      mailer.assertConfigured();
      if (pending.size >= 20)
        throw new HttpError(
          503,
          "EMAIL_UNAVAILABLE",
          "Password recovery is temporarily unavailable",
        );
      // Account lookup and SMTP both run after acceptance, avoiding account-dependent latency.
      const task = Promise.resolve()
        .then(async () => {
          const code = randomInt(0, 1000000).toString().padStart(6, "0");
          const target = await store.issue(
            email,
            (id) => resetCodeHash(id, code),
            clock(),
          );
          if (target) await mailer.send(target.email, code);
        })
        .catch(() => {
          onDeliveryError();
        })
        .finally(() => {
          pending.delete(task);
        });
      pending.add(task);
    },
    async reset(input: ResetPasswordInput) {
      const newHash = await hashPassword(input.newPassword);
      const accepted = await store.consume(
        input.email,
        (id) => resetCodeHash(id, input.code),
        newHash,
        clock(),
      );
      if (!accepted)
        throw new HttpError(
          400,
          "INVALID_RESET_CODE",
          "Invalid or expired verification code",
        );
    },
    // Test/shutdown synchronization only; never exposed over HTTP.
    async idle() {
      await Promise.all([...pending]);
    },
  };
}
export type PasswordResetService = ReturnType<
  typeof createPasswordResetService
>;
export const passwordResetService = createPasswordResetService();
