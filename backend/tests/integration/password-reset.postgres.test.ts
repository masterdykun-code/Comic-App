import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { Client } from "pg";
import type { Prisma, PrismaClient } from "../../src/generated/prisma/client";
import {
  APP_TABLES,
  configureIntegration,
  assertTestDatabase,
} from "./environment";
import { verifySchema } from "./database";

test("U09 PostgreSQL: one-time PIN, constraints, atomic rollback and U10 interoperability", async (t) => {
  const raw = configureIntegration(),
    guard = new Client({ connectionString: raw });
  await guard.connect();
  await assertTestDatabase(guard);
  await verifySchema(guard);
  const { getPrismaClient, disconnectPrisma } =
    await import("../../src/config/prisma.js");
  const { createPrismaPasswordResetStore } =
    await import("../../src/services/password-reset.store.js");
  const { createPasswordResetService, resetCodeHash } =
    await import("../../src/services/password-reset.service.js");
  const { createAuthService } =
    await import("../../src/services/auth.service.js");
  const { hashPassword } = await import("../../src/utils/password.js");
  const db = getPrismaClient(),
    ids = [randomUUID(), randomUUID()],
    suffix = randomUUID().replaceAll("-", "");
  const password = randomBytes(24).toString("hex"),
    next = randomBytes(24).toString("hex"),
    emails = ids.map((_, i) => `u09-${suffix}-${i}@example.test`);
  const messages: Array<{ to: string; code: string }> = [];
  let time = Date.now(),
    failures = 0;
  const store = createPrismaPasswordResetStore(),
    auth = createAuthService();
  const reset = createPasswordResetService(
    store,
    {
      assertConfigured() {},
      async send(to, code) {
        messages.push({ to, code });
      },
    },
    () => new Date(time),
    () => {
      failures++;
    },
  );
  const identity = async () => {
    await assertTestDatabase(guard);
    const r = await db.$queryRaw<
      Array<{ db: string; schema: string }>
    >`SELECT current_database() AS db,current_schema() AS schema`;
    assert.equal(r[0]?.db, "webnovel_test_db");
    assert.equal(r[0]?.schema, "public");
  };
  const fingerprint = async () => {
    const result: Record<string, string> = {};
    for (const table of APP_TABLES) {
      const rows = (
        await guard.query(
          `SELECT md5(row_to_json(t)::text) AS h FROM public."${table}" t ORDER BY 1`,
        )
      ).rows;
      result[table] = createHash("sha256")
        .update(rows.map((r) => r.h).join("\n"))
        .digest("hex");
    }
    return result;
  };
  const before = await fingerprint();
  const issue = async (email: string) => {
    reset.request(email);
    await reset.idle();
    assert.equal(failures, 0);
    return messages.filter((m) => m.to === email).at(-1)!.code;
  };
  t.beforeEach(identity);
  try {
    await identity();
    const passwordHash = await hashPassword(password);
    await db.user.createMany({
      data: ids.map((id, i) => ({
        id,
        username: `u09_${suffix.slice(0, 16)}_${i}`,
        email: emails[i]!,
        displayName: "U09 fixture",
        passwordHash,
      })),
    });
    const first = await auth.login(emails[0]!, password),
      second = await auth.login(emails[0]!, password),
      other = await auth.login(emails[1]!, password);
    let code = await issue(emails[0]!);
    const input = () => ({
      email: emails[0]!,
      code,
      newPassword: next,
      confirmPassword: next,
    });
    await t.test(
      "only HMAC persists; DB CHECK rejects attempts outside 0..5",
      async () => {
        const row = await db.passwordReset.findUniqueOrThrow({
          where: { userId: ids[0]! },
        });
        assert.equal(row.codeHash, resetCodeHash(ids[0]!, code));
        assert.notEqual(row.codeHash, code);
        await assert.rejects(
          guard.query(
            "UPDATE public.password_resets SET attempts=6 WHERE user_id=$1",
            [ids[0]],
          ),
          { code: "23514" },
        );
        assert.equal(
          (
            await db.passwordReset.findUniqueOrThrow({
              where: { userId: ids[0]! },
            })
          ).attempts,
          0,
        );
      },
    );
    await t.test(
      "wrong attempts commit, consume only the challenge and preserve login sessions",
      async () => {
        const wrong = code === "000000" ? "999999" : "000000";
        for (let n = 0; n < 5; n++)
          await assert.rejects(reset.reset({ ...input(), code: wrong }), {
            statusCode: 400,
          });
        const row = await db.passwordReset.findUniqueOrThrow({
          where: { userId: ids[0]! },
        });
        assert.equal(row.attempts, 5);
        assert(row.consumedAt);
        await assert.rejects(reset.reset(input()), { statusCode: 400 });
        await auth.authenticate(first.accessToken);
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: ids[0]! } }))
            .passwordHash,
          passwordHash,
        );
      },
    );
    await t.test(
      "resend cooldown and replacement code work across real DB transactions",
      async () => {
        const count = messages.length;
        reset.request(emails[0]!);
        await reset.idle();
        assert.equal(messages.length, count);
        const old = code;
        time += 61000;
        code = await issue(emails[0]!);
        assert.equal(messages.length, count + 1);
        await assert.rejects(reset.reset({ ...input(), code: old }), {
          statusCode: 400,
        });
      },
    );
    await t.test(
      "session revocation failure rolls back hash and code consumption together",
      async () => {
        const failingClient = {
          $transaction: (
            work: (tx: Prisma.TransactionClient) => Promise<boolean>,
          ) =>
            db.$transaction((tx) =>
              work(
                new Proxy(tx, {
                  get(target, key) {
                    if (key === "authSession")
                      return new Proxy(target.authSession, {
                        get(delegate, method) {
                          if (method === "updateMany")
                            return async () => {
                              throw Error("Injected reset rollback");
                            };
                          const v = Reflect.get(delegate, method);
                          return typeof v === "function" ? v.bind(delegate) : v;
                        },
                      });
                    const value = Reflect.get(target, key);
                    return typeof value === "function"
                      ? value.bind(target)
                      : value;
                  },
                }),
              ),
            ),
        } as unknown as PrismaClient;
        const failing = createPrismaPasswordResetStore(() => failingClient);
        await assert.rejects(
          failing.consume(
            emails[0]!,
            (id) => resetCodeHash(id, code),
            await hashPassword(next),
            new Date(time),
          ),
          /Injected reset rollback/,
        );
        assert.equal(
          (await db.user.findUniqueOrThrow({ where: { id: ids[0]! } }))
            .passwordHash,
          passwordHash,
        );
        assert.equal(
          (
            await db.passwordReset.findUniqueOrThrow({
              where: { userId: ids[0]! },
            })
          ).consumedAt,
          null,
        );
        await auth.authenticate(first.accessToken);
      },
    );
    await t.test(
      "concurrent use succeeds once; old access and refresh tokens are revoked",
      async () => {
        const results = await Promise.allSettled([
          reset.reset(input()),
          reset.reset(input()),
        ]);
        assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
        assert.equal(results.filter((r) => r.status === "rejected").length, 1);
        for (const old of [first, second]) {
          await assert.rejects(auth.authenticate(old.accessToken), {
            statusCode: 401,
          });
          await assert.rejects(auth.refresh(old.refreshToken), {
            statusCode: 401,
          });
        }
        await assert.rejects(auth.login(emails[0]!, password), {
          statusCode: 401,
        });
        await auth.login(emails[0]!, next);
        await auth.authenticate(other.accessToken);
      },
    );
    await t.test(
      "U10 invalidates pending recovery codes and still supports ordinary login",
      async () => {
        const otherCode = await issue(emails[1]!);
        const context = await auth.authenticate(other.accessToken);
        await auth.changePassword(context.user.id, context.sessionId, {
          currentPassword: password,
          newPassword: next,
          confirmPassword: next,
        });
        assert(
          (
            await db.passwordReset.findUniqueOrThrow({
              where: { userId: ids[1]! },
            })
          ).consumedAt,
        );
        await assert.rejects(
          reset.reset({
            email: emails[1]!,
            code: otherCode,
            newPassword: password,
            confirmPassword: password,
          }),
          { statusCode: 400 },
        );
        await auth.login(emails[1]!, next);
      },
    );
    await t.test(
      "expired and BANNED-user codes cannot reset passwords",
      async () => {
        time += 61000;
        code = await issue(emails[0]!);
        time += 600001;
        await assert.rejects(reset.reset(input()), { statusCode: 400 });
        code = await issue(emails[0]!);
        await db.user.update({
          where: { id: ids[0]! },
          data: { status: "BANNED" },
        });
        await assert.rejects(reset.reset(input()), { statusCode: 400 });
      },
    );
    await t.test("PIN expiry is checked again after waiting for a real user-row lock", async () => {
      const pin = "527813", startedAt = Date.now();
      const unchanged = (await db.user.findUniqueOrThrow({where:{id:ids[1]!}})).passwordHash;
      await db.passwordReset.update({where:{userId:ids[1]!},data:{
        codeHash:resetCodeHash(ids[1]!,pin),attempts:0,consumedAt:null,
        createdAt:new Date(startedAt-1000),expiresAt:new Date(startedAt+500),
      }});
      const newHash=await hashPassword(password);
      await guard.query('BEGIN');
      let pending:Promise<boolean> | undefined;
      try {
        await guard.query('SELECT id FROM public.users WHERE id=$1 FOR UPDATE',[ids[1]]);
        pending=store.consume(emails[1]!,id=>resetCodeHash(id,pin),newHash,new Date());
        await new Promise(resolve=>setTimeout(resolve,800));
      } finally { await guard.query('ROLLBACK'); }
      assert.equal(await pending,false);
      assert.equal((await db.user.findUniqueOrThrow({where:{id:ids[1]!}})).passwordHash,unchanged);
    });
  } finally {
    await reset.idle();
    await identity();
    await db.$transaction(async (tx) => {
      await tx.passwordReset.deleteMany({ where: { userId: { in: ids } } });
      await tx.refreshToken.deleteMany({
        where: { session: { userId: { in: ids } } },
      });
      await tx.authSession.deleteMany({ where: { userId: { in: ids } } });
      await tx.user.deleteMany({
        where: {
          id: { in: ids },
          username: { startsWith: `u09_${suffix.slice(0, 16)}` },
          email: { endsWith: "@example.test" },
        },
      });
    });
    assert.deepEqual(await fingerprint(), before);
    await guard.end();
    await disconnectPrisma();
  }
});
