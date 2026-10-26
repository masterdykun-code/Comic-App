import { HttpError } from "../utils/http-error";
import type {
  AdminUserQuery,
  AdminUsersStore,
  AdminUsersTransaction,
  AdminUserStatusInput,
} from "../types/admin-users.types";
import { prismaAdminUsersStore } from "./admin-users.store";
export function createAdminUsersService(
  store: AdminUsersStore = prismaAdminUsersStore,
) {
  async function run<T>(
    actor: string,
    mode: "read" | "write",
    work: (tx: AdminUsersTransaction) => Promise<T>,
  ) {
    try {
      return await store.transaction(mode, async (tx) => {
        if (!(await tx.adminIsActive(actor)))
          throw new HttpError(403, "FORBIDDEN", "Active ADMIN required");
        return work(tx);
      });
    } catch (error) {
      const code = (error as { code?: string })?.code;
      if (code === "P2025")
        throw new HttpError(404, "USER_NOT_FOUND", "User not found");
      if (["P2034", "P2028", "55P03"].includes(code ?? ""))
        throw new HttpError(
          409,
          "USER_WRITE_CONFLICT",
          "Reload user before retrying",
        );
      throw error;
    }
  }
  return {
    list(actor: string, query: AdminUserQuery) {
      return run(actor, "read", async (tx) => {
        const { data, total } = await tx.list(query);
        return {
          data,
          pagination: {
            page: query.page,
            limit: query.limit,
            total,
            totalPages: Math.ceil(total / query.limit),
          },
        };
      });
    },
    detail(actor: string, id: string) {
      return run(actor, "read", async (tx) => {
        const user = await tx.user(id);
        if (!user || user.role !== "USER")
          throw new HttpError(404, "USER_NOT_FOUND", "User not found");
        return user;
      });
    },
    status(actor: string, id: string, input: AdminUserStatusInput) {
      return run(actor, "write", async (tx) => {
        if (id === actor && input.status === "BANNED")
          throw new HttpError(
            403,
            "SELF_BAN_FORBIDDEN",
            "Cannot ban your own account",
          );
        const user = await tx.user(id, true);
        if (!user) throw new HttpError(404, "USER_NOT_FOUND", "User not found");
        if (user.role !== "USER")
          throw new HttpError(
            403,
            "ADMIN_ACCOUNT_PROTECTED",
            "Only USER accounts can be managed",
          );
        if (input.confirm !== true)
          throw new HttpError(
            400,
            "CONFIRMATION_REQUIRED",
            "Confirmation required",
          );
        if (
          user.updatedAt.getTime() !==
          new Date(input.expectedUpdatedAt).getTime()
        )
          throw new HttpError(
            409,
            "USER_STALE",
            "User changed; reload before confirming",
          );
        return user.status === input.status
          ? user
          : tx.setStatus(id, input.status, new Date(Math.max(Date.now(), user.updatedAt.getTime() + 1)));
      });
    },
    stats(actor: string) {
      return run(actor, "read", (tx) => tx.stats());
    },
  };
}
export type AdminUsersService = ReturnType<typeof createAdminUsersService>;
export const adminUsersService = createAdminUsersService();
