import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import express from "express";
import argon2 from "argon2";
import nodemailer from "nodemailer";
import { createPasswordResetRouter } from "../src/routes/password-reset.routes";
import {
  createPasswordResetService,
  resetCodeHash,
} from "../src/services/password-reset.service";
import { createAuthService } from "../src/services/auth.service";
import { errorHandler } from "../src/middlewares/error-handler";
import { readMailConfig, smtpResetMailer } from "../src/config/mail";
import { MemoryAuthStore } from "./helpers/memory-auth.store";
import { MemoryPasswordResetStore } from "./helpers/memory-password-reset.store";
import { HttpError } from "../src/utils/http-error";
process.env.JWT_SECRET = randomBytes(48).toString("hex");
const account = {
  username: "reset_reader",
  email: "reset@example.test",
  password: "Previous-test-password",
};
const next = "Next-test-password";
async function fixture(
  run: (f: {
    auth: ReturnType<typeof createAuthService>;
    users: MemoryAuthStore;
    store: MemoryPasswordResetStore;
    service: ReturnType<typeof createPasswordResetService>;
    emails: Array<{ to: string; code: string }>;
    mailer: {
      assertConfigured: () => void;
      send: (to: string, code: string) => Promise<void>;
    };
    errors: unknown[];
    advance: (ms: number) => void;
    request: (
      path: string,
      body: unknown,
    ) => Promise<{ status: number; body: any; cache: string | undefined }>;
  }) => Promise<void>,
) {
  const users = new MemoryAuthStore(),
    auth = createAuthService(users),
    store = new MemoryPasswordResetStore(users);
  await auth.register(account);
  let time = Date.now();
  const emails: Array<{ to: string; code: string }> = [],
    errors: unknown[] = [];
  const mailer = {
    assertConfigured: () => {},
    send: async (to: string, code: string) => {
      emails.push({ to, code });
    },
  };
  const service = createPasswordResetService(
    store,
    mailer,
    () => new Date(time),
    () => {
      errors.push("DELIVERY_FAILED");
    },
  );
  const app = express();
  app.use(express.json({ limit: "16kb" }));
  app.use("/api/auth", createPasswordResetRouter(service));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const request = (path: string, body: unknown) =>
    new Promise<{ status: number; body: any; cache: string | undefined }>(
      (resolve, reject) => {
        const req = httpRequest(
          {
            hostname: "127.0.0.1",
            port: address.port,
            path: "/api/auth/" + path,
            method: "POST",
            headers: { "Content-Type": "application/json" },
          },
          (res) => {
            let text = "";
            res.setEncoding("utf8");
            res.on("data", (s) => {
              text += s;
            });
            res.on("end", () => {
              try {
                resolve({
                  status: res.statusCode!,
                  body: JSON.parse(text),
                  cache: res.headers["cache-control"],
                });
              } catch {
                reject(Error("Invalid test response"));
              }
            });
          },
        );
        req.on("error", reject);
        req.end(JSON.stringify(body));
      },
    );
  try {
    await run({
      auth,
      users,
      store,
      service,
      emails,
      mailer,
      errors,
      advance: (ms) => {
        time += ms;
      },
      request,
    });
  } finally {
    await service.idle();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
      server.closeAllConnections();
    });
  }
}
test("known/unknown/BANNED/passwordless emails have identical accepted responses and no account disclosure", async () =>
  fixture(async (f) => {
    const known = await f.request("forgot-password", { email: account.email });
    await f.service.idle();
    const missing = await f.request("forgot-password", {
      email: "missing@example.test",
    });
    await f.service.idle();
    assert.equal(known.status, 202);
    assert.equal(known.cache, "no-store");
    assert.deepEqual(known.body, missing.body);
    const user = [...f.users.users.values()][0]!;
    user.status = "BANNED";
    assert.deepEqual(
      (await f.request("forgot-password", { email: account.email })).body,
      known.body,
    );
    await f.service.idle();
    user.status = "ACTIVE";
    user.passwordHash = null;
    assert.deepEqual(
      (await f.request("forgot-password", { email: account.email })).body,
      known.body,
    );
    await f.service.idle();
    assert.equal(f.emails.length, 1);
    assert(!JSON.stringify(known.body).includes(account.email));
  }));
test("six-digit code is HMAC-only in storage; reset is single-use, Argon2id and revokes every old session", async () =>
  fixture(async (f) => {
    const first = await f.auth.login(account.email, account.password),
      second = await f.auth.login(account.email, account.password);
    await f.request("forgot-password", { email: account.email.toUpperCase() });
    await f.service.idle();
    const code = f.emails[0]!.code;
    assert.match(code, /^\d{6}$/);
    const user = [...f.users.users.values()][0]!,
      row = f.store.rows.get(user.id)!;
    assert.equal(row.codeHash, resetCodeHash(user.id, code));
    assert.equal(row.codeHash.length, 64);
    assert(!JSON.stringify(row).includes(`"${code}"`));
    const input = {
      email: account.email,
      code,
      newPassword: next,
      confirmPassword: next,
    };
    const response = await f.request("reset-password", input);
    assert.equal(response.status, 200);
    assert.equal(response.body.data.sessionsRevoked, true);
    assert.equal(response.cache, "no-store");
    assert(user.passwordHash?.startsWith("$argon2id$"));
    assert(await argon2.verify(user.passwordHash!, next));
    for (const old of [first, second]) {
      await assert.rejects(f.auth.authenticate(old.accessToken), {
        statusCode: 401,
      });
      await assert.rejects(f.auth.refresh(old.refreshToken), {
        statusCode: 401,
      });
    }
    await assert.rejects(f.auth.login(account.email, account.password), {
      statusCode: 401,
    });
    await f.auth.login(account.email, next);
    assert.equal((await f.request("reset-password", input)).status, 400);
    for (const value of [
      next,
      code,
      user.passwordHash!,
      first.accessToken,
      first.refreshToken,
    ])
      assert(!JSON.stringify(response.body).includes(value));
  }));
test("expired codes fail without changing password or ending valid sessions", async () =>
  fixture(async (f) => {
    const login = await f.auth.login(account.email, account.password);
    await f.request("forgot-password", { email: account.email });
    await f.service.idle();
    f.advance(600001);
    const r = await f.request("reset-password", {
      email: account.email,
      code: f.emails[0]!.code,
      newPassword: next,
      confirmPassword: next,
    });
    assert.equal(r.status, 400);
    assert.equal(r.body.error.code, "INVALID_RESET_CODE");
    await f.auth.authenticate(login.accessToken);
  }));
test("five wrong PINs consume only the challenge; correct PIN cannot bypass the attempt limit", async () =>
  fixture(async (f) => {
    await f.request("forgot-password", { email: account.email });
    await f.service.idle();
    const code = f.emails[0]!.code;
    const wrong = code === "000000" ? "999999" : "000000";
    const input = {
      email: account.email,
      code: wrong,
      newPassword: next,
      confirmPassword: next,
    };
    for (let n = 0; n < 5; n++)
      assert.equal((await f.request("reset-password", input)).status, 400);
    assert.equal(
      (await f.request("reset-password", { ...input, code })).status,
      400,
    );
    assert.equal([...f.store.rows.values()][0]!.attempts, 5);
    await f.auth.login(account.email, account.password);
  }));
test("resend cooldown prevents email spam and a replacement challenge invalidates the old code", async () =>
  fixture(async (f) => {
    await f.request("forgot-password", { email: account.email });
    await f.service.idle();
    const first = f.emails[0]!.code;
    await f.request("forgot-password", { email: account.email });
    await f.service.idle();
    assert.equal(f.emails.length, 1);
    f.advance(61000);
    await f.request("forgot-password", { email: account.email });
    await f.service.idle();
    assert.equal(f.emails.length, 2);
    const input = {
      email: account.email,
      code: first,
      newPassword: next,
      confirmPassword: next,
    };
    assert.equal((await f.request("reset-password", input)).status, 400);
    assert.equal(
      (await f.request("reset-password", { ...input, code: f.emails[1]!.code }))
        .status,
      200,
    );
  }));
test("concurrent use accepts one reset only", async () =>
  fixture(async (f) => {
    await f.request("forgot-password", { email: account.email });
    await f.service.idle();
    const input = {
      email: account.email,
      code: f.emails[0]!.code,
      newPassword: next,
      confirmPassword: next,
    };
    const responses = await Promise.all([
      f.request("reset-password", input),
      f.request("reset-password", input),
    ]);
    assert.deepEqual(responses.map((r) => r.status).sort(), [200, 400]);
  }));
test("validation blocks malformed email, code, mismatched passwords and mass assignment", async () =>
  fixture(async (f) => {
    assert.equal(
      (await f.request("forgot-password", { email: "invalid" })).status,
      400,
    );
    assert.equal(
      (
        await f.request("forgot-password", {
          email: account.email,
          role: "ADMIN",
        })
      ).status,
      400,
    );
    const input = {
      email: account.email,
      code: "123456",
      newPassword: next,
      confirmPassword: next,
    };
    for (const bad of [
      { ...input, code: "123" },
      { ...input, newPassword: "short" },
      { ...input, newPassword: "x".repeat(129) },
      { ...input, confirmPassword: "Different-value" },
      { ...input, role: "ADMIN" },
    ])
      assert.equal((await f.request("reset-password", bad)).status, 400);
    assert.equal(f.emails.length, 0);
    assert.equal(f.store.rows.size, 0);
  }));
test("email and IP rate limits apply equally to unknown accounts", async () =>
  fixture(async (f) => {
    for (let n = 0; n < 3; n++)
      assert.equal(
        (await f.request("forgot-password", { email: "unknown@example.test" }))
          .status,
        202,
      );
    assert.equal(
      (await f.request("forgot-password", { email: "unknown@example.test" }))
        .status,
      429,
    );
    assert.equal(
      (await f.request("forgot-password", { email: "different@example.test" }))
        .status,
      202,
    );
    assert.equal(
      (await f.request("forgot-password", { email: "third@example.test" }))
        .status,
      429,
    );
    for (let n = 0; n < 20; n++)
      assert.equal(
        (
          await f.request("reset-password", {
            email: "unknown@example.test",
            code: "123456",
            newPassword: next,
            confirmPassword: next,
          })
        ).status,
        400,
      );
    assert.equal(
      (
        await f.request("reset-password", {
          email: "unknown@example.test",
          code: "123456",
          newPassword: next,
          confirmPassword: next,
        })
      ).status,
      429,
    );
  }));
test("missing SMTP config fails safely for all emails; background delivery/storage errors stay sanitized", async () =>
  fixture(async (f) => {
    f.mailer.assertConfigured = () => {
      throw new HttpError(503, "EMAIL_UNAVAILABLE", "Email unavailable");
    };
    const first = await f.request("forgot-password", { email: account.email });
    const second = await f.request("forgot-password", {
      email: "unknown@example.test",
    });
    assert.equal(first.status, 503);
    assert.deepEqual(first.body, second.body);
    assert.equal(f.emails.length, 0);
    f.mailer.assertConfigured = () => {};
    f.mailer.send = async () => {
      throw Error("secret SMTP authentication detail");
    };
    assert.equal(
      (await f.request("forgot-password", { email: account.email })).status,
      202,
    );
    await f.service.idle();
    assert.deepEqual(f.errors, ["DELIVERY_FAILED"]);
    f.store.consume = async () => {
      throw Error("private SQL detail");
    };
    const failed = await f.request("reset-password", {
      email: account.email,
      code: "123456",
      newPassword: next,
      confirmPassword: next,
    });
    assert.equal(failed.status, 500);
    assert(!JSON.stringify(failed.body).includes("private"));
  }));
test("SMTP configuration is optional until used and never exposes credentials on error", () => {
  assert.throws(() => readMailConfig({}), { statusCode: 503 });
  assert.throws(
    () =>
      readMailConfig({
        SMTP_HOST: "smtp.gmail.com",
        SMTP_USER: "sender@example.test",
        SMTP_PASS: "YOUR_GOOGLE_APP_PASSWORD",
      }),
    { statusCode: 503 },
  );
  const config = readMailConfig({
    SMTP_HOST: "smtp.gmail.com",
    SMTP_USER: "sender@example.test",
    SMTP_PASS: randomBytes(16).toString("hex"),
  });
  assert.equal(config.SMTP_PORT, "465");
  assert.equal(config.SMTP_FROM, config.SMTP_USER);
});
test("SMTP adapter sends the verification email with TLS and no debug logs (mock transport)", async () => {
  const saved = { ...process.env };
  const messages: any[] = [];
  let options: any;
  let closed = false;
  process.env.SMTP_HOST = "smtp.gmail.com";
  process.env.SMTP_USER = "sender@example.test";
  process.env.SMTP_FROM = "sender@example.test";
  process.env.SMTP_PASS = randomBytes(16).toString("hex");
  process.env.SMTP_PORT = "465";
  const replacement = mock.method(nodemailer, "createTransport", ((
    value: unknown,
  ) => {
    options = value;
    return {
      sendMail: async (m: unknown) => {
        messages.push(m);
        return { accepted: ["recipient@example.test"] };
      },
      close: () => {
        closed = true;
      },
    };
  }) as any);
  try {
    await smtpResetMailer.send("recipient@example.test", "123456");
    assert.equal(messages.length, 1);
    assert(messages[0].text.includes("123456"));
    assert.equal(messages[0].to, "recipient@example.test");
    assert.equal(options.secure, true);
    assert.equal(options.requireTLS, true);
    assert.equal(options.logger, false);
    assert.equal(options.debug, false);
    assert.equal(closed, true);
  } finally {
    replacement.mock.restore();
    for (const key of Object.keys(process.env))
      if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});
