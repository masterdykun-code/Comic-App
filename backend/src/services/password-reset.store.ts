import { timingSafeEqual } from "node:crypto";
import { getPrismaClient } from "../config/prisma";
import type { PrismaClient } from "../generated/prisma/client";
import type { PasswordResetStore } from "../types/password-reset.types";

export function createPrismaPasswordResetStore(
  client: () => PrismaClient = getPrismaClient,
): PasswordResetStore {
  return {
    issue(email, hash, now) {
      return client().$transaction(async (tx) => {
        const found = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (!found) return null;
        // Same user lock/order as login, profile and U10; never lock a challenge first.
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${found.id}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: found.id } });
        if (!user || user.status !== "ACTIVE" || !user.passwordHash)
          return null;
        const previous = await tx.passwordReset.findUnique({
          where: { userId: user.id },
        });
        if (previous && now.getTime() - previous.createdAt.getTime() < 60000)
          return null;
        const data = {
          codeHash: hash(user.id),
          attempts: 0,
          consumedAt: null,
          createdAt: now,
          expiresAt: new Date(now.getTime() + 600000),
        };
        if (previous?.codeHash === data.codeHash) return null;
        await tx.passwordReset.upsert({
          where: { userId: user.id },
          create: { userId: user.id, ...data },
          update: data,
        });
        return { email: user.email };
      });
    },
    consume(email, hash, newPasswordHash, now) {
      return client().$transaction(async (tx) => {
        const found = await tx.user.findUnique({
          where: { email },
          select: { id: true },
        });
        if (!found) return false;
        await tx.$queryRaw`SELECT id FROM users WHERE id = ${found.id}::uuid FOR UPDATE`;
        const user = await tx.user.findUnique({ where: { id: found.id } });
        const reset = await tx.passwordReset.findUnique({
          where: { userId: found.id },
        });
        // A PIN must still be valid after waiting for the user lock, not only when requested.
        const checkedAt = new Date(Math.max(now.getTime(), Date.now()));
        if (
          !user ||
          user.status !== "ACTIVE" ||
          !user.passwordHash ||
          !reset ||
          reset.consumedAt ||
          reset.expiresAt <= checkedAt ||
          reset.attempts >= 5
        )
          return false;
        const expected = Buffer.from(reset.codeHash, "hex"),
          supplied = Buffer.from(hash(user.id), "hex");
        if (
          expected.length !== supplied.length ||
          !timingSafeEqual(expected, supplied)
        ) {
          const attempts = reset.attempts + 1;
          await tx.passwordReset.update({
            where: { userId: user.id },
            data: {
              attempts,
              ...(attempts >= 5 ? { consumedAt: checkedAt } : {}),
            },
          });
          return false; // Return instead of throw so the failed attempt commits.
        }
        await tx.user.update({
          where: { id: user.id },
          data: { passwordHash: newPasswordHash },
        });
        await tx.passwordReset.update({
          where: { userId: user.id },
          data: { consumedAt: checkedAt },
        });
        await tx.authSession.updateMany({
          where: { userId: user.id, revokedAt: null },
          data: { revokedAt: checkedAt },
        });
        return true;
      });
    },
  };
}
export const prismaPasswordResetStore = createPrismaPasswordResetStore();
