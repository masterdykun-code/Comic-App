import nodemailer from "nodemailer";
import { z } from "zod";
import { HttpError } from "../utils/http-error";
import type { ResetMailer } from "../types/password-reset.types";

export function readMailConfig(env: NodeJS.ProcessEnv = process.env) {
  const parsed = z
    .object({
      SMTP_HOST: z
        .string()
        .trim()
        .min(1)
        .max(253)
        .regex(/^[a-zA-Z0-9.-]+$/),
      SMTP_PORT: z.enum(["465", "587"]),
      SMTP_USER: z.email().max(254),
      SMTP_PASS: z.string().min(1).max(1024),
      SMTP_FROM: z.email().max(254),
    })
    .safeParse({
      ...env,
      SMTP_PORT: env.SMTP_PORT ?? "465",
      SMTP_FROM: env.SMTP_FROM || env.SMTP_USER,
    });
  if (
    !parsed.success ||
    /YOUR_|replace_with|app_password/i.test(parsed.data.SMTP_PASS)
  )
    throw new HttpError(
      503,
      "EMAIL_UNAVAILABLE",
      "Password recovery email is not configured",
    );
  return parsed.data;
}
export const smtpResetMailer: ResetMailer = {
  assertConfigured() {
    readMailConfig();
  },
  async send(to, code) {
    const config = readMailConfig();
    const transport = createMailTransport(config);
    try {
      const result = await transport.sendMail({
        from: { name: "WebNovel", address: config.SMTP_FROM },
        to,
        subject: "WebNovel — Mã đặt lại mật khẩu",
        text: `Mã xác minh WebNovel của bạn: ${code}\n\nMã có hiệu lực 10 phút và chỉ dùng một lần. Không chia sẻ mã này.\nNếu bạn không yêu cầu, hãy bỏ qua email. Mật khẩu của bạn chưa thay đổi.`,
        disableFileAccess: true,
        disableUrlAccess: true,
      });
      if (!result.accepted?.length) throw new Error("Email not accepted");
    } finally {
      transport.close();
    }
  },
};

export function createMailTransport(config = readMailConfig()) {
  return nodemailer.createTransport({
    host: config.SMTP_HOST,
    port: Number(config.SMTP_PORT),
    secure: config.SMTP_PORT === "465",
    requireTLS: true,
    tls: { minVersion: "TLSv1.2" },
    auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    logger: false,
    debug: false,
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
  });
}
