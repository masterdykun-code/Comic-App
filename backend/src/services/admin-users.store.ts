import { getPrismaClient } from "../config/prisma";
import { Prisma, type PrismaClient } from "../generated/prisma/client";
import type {
  AdminUsersStore,
  AdminUsersTransaction,
} from "../types/admin-users.types";
const publicUser = {
  id: true,
  username: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  role: true,
  status: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;
function adapter(tx: Prisma.TransactionClient): AdminUsersTransaction {
  return {
    async adminIsActive(id) {
      return Boolean(
        await tx.user.findFirst({
          where: { id, role: "ADMIN", status: "ACTIVE" },
          select: { id: true },
        }),
      );
    },
    async list(query) {
      const search = query.search?.replace(/[\\%_]/g, "\\$&");
      const where: Prisma.UserWhereInput = {
        role: "USER",
        ...(query.status ? { status: query.status } : {}),
        ...(search
          ? {
              OR: ["username", "displayName", "email"].map((field) => ({
                [field]: { contains: search, mode: "insensitive" },
              })),
            }
          : {}),
      };
      const total = await tx.user.count({ where });
      const data = await tx.user.findMany({
        where,
        select: publicUser,
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      });
      return { data, total };
    },
    async user(id, lock = false) {
      // Same lock order as login/U10/password recovery, before touching sessions.
      if (lock)
        await tx.$queryRaw`SELECT id FROM public.users WHERE id = ${id}::uuid FOR UPDATE`;
      return tx.user.findUnique({ where: { id }, select: publicUser });
    },
    async setStatus(id, status, now) {
      const user = await tx.user.update({
        where: { id },
        data: { status, updatedAt: now },
        select: publicUser,
      });
      if (status === "BANNED") {
        await tx.authSession.updateMany({
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
        await tx.passwordReset.updateMany({
          where: { userId: id, consumedAt: null },
          data: { consumedAt: now },
        });
      }
      return user;
    },
    async stats() {
      const total = await tx.user.count({ where: { role: "USER" } });
      const active = await tx.user.count({
        where: { role: "USER", status: "ACTIVE" },
      });
      const banned = await tx.user.count({
        where: { role: "USER", status: "BANNED" },
      });
      const novels = await tx.story.count({ where: { type: "NOVEL" } });
      const comics = await tx.story.count({ where: { type: "COMIC" } });
      const published = await tx.story.count({
        where: { publishStatus: "PUBLISHED" },
      });
      const totalChapters = await tx.chapter.count();
      const readingEvents = await tx.readingHistory.count();
      const groups = await tx.readingHistory.groupBy({
        by: ["storyId"],
        _count: { _all: true },
        orderBy: [{ _count: { storyId: "desc" } }, { storyId: "asc" }],
        take: 10,
      });
      const stories = groups.length
        ? await tx.story.findMany({
            where: { id: { in: groups.map((g) => g.storyId) } },
            select: { id: true, title: true, type: true, publishStatus: true },
          })
        : [];
      const byId = new Map(stories.map((s) => [s.id, s]));
      return {
        users: { total, active, banned },
        stories: { total: novels + comics, novels, comics, published },
        totalChapters,
        readingEvents,
        readingMetric: "STORED_AUTHENTICATED_HISTORY",
        popularStories: groups.flatMap((g) => {
          const story = byId.get(g.storyId);
          return story ? [{ ...story, readCount: g._count._all }] : [];
        }),
      };
    },
  };
}
export function createPrismaAdminUsersStore(
  client: () => PrismaClient = getPrismaClient,
): AdminUsersStore {
  return {
    transaction(mode, work) {
      return client().$transaction((tx) => work(adapter(tx)), {
        isolationLevel: mode === "write" ? "ReadCommitted" : "RepeatableRead",
        maxWait: 5000,
        timeout: 10000,
      });
    },
  };
}
export const prismaAdminUsersStore = createPrismaAdminUsersStore();
