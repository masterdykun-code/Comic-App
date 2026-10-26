import type { AdminGenreStore, AdminGenreTransaction, GenreInput } from '../types/admin-genre.types';
import { HttpError } from '../utils/http-error';
import { isTransactionConflict } from '../utils/transaction-conflict';
import { prismaAdminGenreStore } from './admin-genre.store';
const missing = () => new HttpError(404, 'GENRE_NOT_FOUND', 'Genre not found');
const inUse = () => new HttpError(409, 'GENRE_IN_USE', 'Genre is used by a story and cannot be deleted');
export function createAdminGenreService(store: AdminGenreStore = prismaAdminGenreStore) {
  async function write<T>(actor: string, work: (tx: AdminGenreTransaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try { return await store.transaction(async (tx) => {
        if (!await tx.adminIsActive(actor)) throw new HttpError(403, 'FORBIDDEN', 'An active ADMIN account is required');
        return work(tx);
      }); } catch (error) {
        const code = (error as { code?: string })?.code;
        if (isTransactionConflict(error)) { if (attempt < 2) continue; throw new HttpError(409, 'GENRE_WRITE_CONFLICT', 'Genre changed concurrently; reload and retry'); }
        if (code === 'P2002') throw new HttpError(409, 'GENRE_CONFLICT', 'Genre name or slug already exists');
        // Restrict FK remains the final guard against a concurrent StoryGenre insert.
        if (code === 'P2003') throw inUse();
        if (code === 'P2025') throw missing();
        throw error;
      }
    }
    throw new HttpError(409, 'GENRE_WRITE_CONFLICT', 'Reload and retry');
  }
  return {
    create: (actor: string, input: GenreInput) => write(actor, (tx) => tx.create(input)),
    update: (actor: string, id: string, input: Partial<GenreInput>) => write(actor, async (tx) => {
      if (!await tx.find(id)) throw missing(); return tx.update(id, input);
    }),
    remove: (actor: string, id: string) => write(actor, async (tx) => {
      if (!await tx.find(id)) throw missing();
      if (await tx.usage(id)) throw inUse();
      await tx.remove(id); return { id, removed: true };
    }),
  };
}
export type AdminGenreService = ReturnType<typeof createAdminGenreService>;
export const adminGenreService = createAdminGenreService();
