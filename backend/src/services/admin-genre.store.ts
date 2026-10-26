import { getPrismaClient } from '../config/prisma';
import type { PrismaClient } from '../generated/prisma/client';
import type { AdminGenreStore } from '../types/admin-genre.types';
const select = { id: true, name: true, slug: true, createdAt: true } as const;
export function createPrismaAdminGenreStore(client: () => PrismaClient = getPrismaClient): AdminGenreStore {
  return { transaction(work) {
    return client().$transaction(async (tx) => work({
      async adminIsActive(id) { return Boolean(await tx.user.findFirst({ where: { id, role: 'ADMIN', status: 'ACTIVE' }, select: { id: true } })); },
      async find(id) {
        await tx.$queryRaw`SELECT id FROM public.genres WHERE id = ${id}::uuid FOR UPDATE`;
        return tx.genre.findUnique({ where: { id }, select });
      },
      create(input) { return tx.genre.create({ data: input, select }); },
      update(id, input) { return tx.genre.update({ where: { id }, data: input, select }); },
      usage(genreId) { return tx.storyGenre.count({ where: { genreId } }); },
      async remove(id) { await tx.genre.delete({ where: { id } }); },
    }), { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 });
  } };
}
export const prismaAdminGenreStore = createPrismaAdminGenreStore();
