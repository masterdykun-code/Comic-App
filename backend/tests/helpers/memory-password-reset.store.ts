import type { PasswordResetStore } from "../../src/types/password-reset.types";
import type { MemoryAuthStore } from "./memory-auth.store";
export class MemoryPasswordResetStore implements PasswordResetStore {
  rows = new Map<
    string,
    {
      codeHash: string;
      attempts: number;
      createdAt: Date;
      expiresAt: Date;
      consumedAt: Date | null;
    }
  >();
  constructor(readonly auth: MemoryAuthStore) {}
  async issue(email: string, hash: (id: string) => string, now: Date) {
    const user = [...this.auth.users.values()].find((u) => u.email === email);
    if (!user || user.status !== "ACTIVE" || !user.passwordHash) return null;
    const old = this.rows.get(user.id),
      codeHash = hash(user.id);
    if (
      old &&
      (now.getTime() - old.createdAt.getTime() < 60000 ||
        old.codeHash === codeHash)
    )
      return null;
    this.rows.set(user.id, {
      codeHash,
      attempts: 0,
      createdAt: now,
      expiresAt: new Date(now.getTime() + 600000),
      consumedAt: null,
    });
    return { email: user.email };
  }
  async consume(
    email: string,
    hash: (id: string) => string,
    newHash: string,
    now: Date,
  ) {
    const user = [...this.auth.users.values()].find((u) => u.email === email),
      row = user && this.rows.get(user.id);
    if (
      !user ||
      user.status !== "ACTIVE" ||
      !user.passwordHash ||
      !row ||
      row.consumedAt ||
      row.expiresAt <= now ||
      row.attempts >= 5
    )
      return false;
    if (row.codeHash !== hash(user.id)) {
      row.attempts++;
      if (row.attempts >= 5) row.consumedAt = now;
      return false;
    }
    user.passwordHash = newHash;
    user.updatedAt = now;
    row.consumedAt = now;
    for (const session of this.auth.sessions.values())
      if (session.userId === user.id && !session.revokedAt)
        session.revokedAt = now;
    return true;
  }
}
