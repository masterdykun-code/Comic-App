import { randomUUID } from 'node:crypto';
import type { User } from '../../src/generated/prisma/client';
import type { AdminBootstrapStore, AdminBootstrapTransaction } from '../../src/types/admin-bootstrap.types';

export class MemoryAdminBootstrapStore implements AdminBootstrapStore {
  users: User[] = [];
  failCommit = false;
  uniqueRace = false;
  transactionCount = 0;
  private tail = Promise.resolve();

  async hasAdmin() { return this.users.some(u => u.role === 'ADMIN'); }
  async transaction<T>(work: (tx: AdminBootstrapTransaction) => Promise<T>): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>(r => { release = r; });
    await previous; // Models the production transaction-scoped lock.
    const snapshot = structuredClone(this.users);
    this.transactionCount++;
    try {
      const result = await work({
        hasAdmin: () => this.hasAdmin(),
        identityExists: async (username, email) => this.users.some(u => u.username.toLowerCase() === username || u.email.toLowerCase() === email),
        create: async (data) => {
          if (this.uniqueRace) throw Object.assign(new Error('PRIVATE_DATABASE_DETAIL'), { code: 'P2002' });
          const id = randomUUID();
          this.users.push({ ...data, id, avatarUrl: null, role: 'ADMIN', status: 'ACTIVE', createdAt: new Date(), updatedAt: new Date() });
          return { id, role: 'ADMIN', status: 'ACTIVE' };
        },
      });
      if (this.failCommit) throw new Error('PRIVATE_PASSWORD_HASH_TOKEN_AND_DATABASE_DETAIL');
      return result;
    } catch (error) { this.users = snapshot; throw error; }
    finally { release(); }
  }
}
