import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { once } from "node:events";
import test from "node:test";
import express from "express";
import { createAdminUsersRouter } from "../src/routes/admin-users.routes";
import { createAdminUsersService } from "../src/services/admin-users.service";
import { createAuthService } from "../src/services/auth.service";
import { errorHandler } from "../src/middlewares/error-handler";
import type {
  AdminUsersStore,
  DashboardStats,
} from "../src/types/admin-users.types";
import { MemoryAuthStore } from "./helpers/memory-auth.store";
process.env.JWT_SECRET = randomBytes(48).toString("hex");
const publicUser = (user: import("../src/generated/prisma/client").User) => {
  const { passwordHash, ...safe } = user;
  return safe;
};
const emptyStats: DashboardStats = {
  users: { total: 0, active: 0, banned: 0 },
  stories: { total: 0, novels: 0, comics: 0, published: 0 },
  totalChapters: 0,
  readingEvents: 0,
  readingMetric: "STORED_AUTHENTICATED_HISTORY",
  popularStories: [],
};
async function setup() {
  const memory = new MemoryAuthStore(),
    auth = createAuthService(memory);
  const admin = await auth.register({
    username: "qa_admin",
    email: "admin@example.test",
    password: "Synthetic-only-123",
  });
  memory.users.get(admin.id)!.role = "ADMIN";
  const user = await auth.register({
    username: "qa_reader",
    email: "reader@example.test",
    password: "Synthetic-only-123",
  });
  const adminTokens = await auth.login(admin.email, "Synthetic-only-123"),
    userTokens = await auth.login(user.email, "Synthetic-only-123");
  let failure: string | undefined;
  const store: AdminUsersStore = {
    transaction: async (_mode, work) => {
      const users = structuredClone(memory.users),
        sessions = structuredClone(memory.sessions);
      try {
        const result = await work({
          adminIsActive: async (id) =>
            memory.users.get(id)?.role === "ADMIN" &&
            memory.users.get(id)?.status === "ACTIVE",
          user: async (id) => {
            const u = memory.users.get(id);
            return u ? publicUser(u) : null;
          },
          list: async (q) => {
            const rows = [...memory.users.values()].filter(
              (u) =>
                u.role === "USER" &&
                (!q.status || q.status === u.status) &&
                (!q.search ||
                  [u.username, u.email, u.displayName].some((s) =>
                    s.toLowerCase().includes(q.search!.toLowerCase()),
                  )),
            );
            return {
              data: rows
                .slice((q.page - 1) * q.limit, q.page * q.limit)
                .map(publicUser),
              total: rows.length,
            };
          },
          setStatus: async (id, status, now) => {
            const u = memory.users.get(id)!;
            u.status = status;
            u.updatedAt = new Date(
              Math.max(now.getTime(), u.updatedAt.getTime() + 1),
            );
            if (status === "BANNED")
              for (const s of memory.sessions.values())
                if (s.userId === id && !s.revokedAt) s.revokedAt = now;
            return publicUser(u);
          },
          stats: async () => ({
            ...emptyStats,
            users: {
              total: 1,
              active: memory.users.get(user.id)!.status === "ACTIVE" ? 1 : 0,
              banned: memory.users.get(user.id)!.status === "BANNED" ? 1 : 0,
            },
          }),
        });
        if (failure)
          throw Object.assign(new Error("private connection details"), {
            code: failure,
          });
        return result;
      } catch (err) {
        memory.users = users;
        memory.sessions = sessions;
        throw err;
      }
    },
  };
  const service = createAdminUsersService(store),
    app = express();
  app.use(express.json());
  app.use("/api/admin", createAdminUsersRouter(service, auth));
  app.use(errorHandler);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  async function request(
    path: string,
    method = "GET",
    body?: unknown,
    actor = "admin",
  ) {
    const token =
      actor === "admin"
        ? adminTokens.accessToken
        : actor === "user"
          ? userTokens.accessToken
          : undefined;
    const response = await fetch(`http://127.0.0.1:${port}/api/admin${path}`, {
      method,
      headers: {
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return {
      status: response.status,
      body: await response.json(),
      cache: response.headers.get("cache-control"),
    };
  }
  return {
    memory,
    auth,
    admin,
    user,
    adminTokens,
    userTokens,
    service,
    request,
    fail: (code: string) => {
      failure = code;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
        server.closeAllConnections();
      }),
  };
}
async function fixture(
  work: (f: Awaited<ReturnType<typeof setup>>) => Promise<void>,
) {
  const f = await setup();
  try {
    await work(f);
  } finally {
    await f.close();
  }
}
test("ADMIN lists/searches/paginates USERs, sees details; no sensitive projection", () =>
  fixture(async (f) => {
    for (const path of [
      "/users",
      "/users?search=READER",
      "/users?search=qa_",
      "/users?search=example.test",
    ]) {
      const r = await f.request(path);
      assert.equal(r.status, 200);
      assert.equal(r.cache, "no-store");
      assert.equal(r.body.pagination.total, 1);
      assert.equal(r.body.data[0].role, "USER");
      assert(!JSON.stringify(r.body).includes("passwordHash"));
      assert(!JSON.stringify(r.body).includes("Synthetic-only"));
    }
    assert.equal(
      (await f.request("/users?page=2&limit=1")).body.data.length,
      0,
    );
    assert.equal(
      (await f.request("/users?status=BANNED")).body.pagination.total,
      0,
    );
    assert.equal(
      (await f.request(`/users/${f.user.id}`)).body.data.email,
      f.user.email,
    );
    assert.equal((await f.request(`/users/${f.admin.id}`)).status, 404);
    assert.equal((await f.request(`/users/${randomUUID()}`)).status, 404);
  }));
test("Guest and USER cannot read/manage accounts or statistics", () =>
  fixture(async (f) => {
    for (const actor of ["guest", "user"])
      for (const [path, method, body] of [
        ["/users", "GET", undefined],
        ["/dashboard", "GET", undefined],
        [`/users/${f.user.id}`, "GET", undefined],
        [
          `/users/${f.user.id}/status`,
          "PATCH",
          {
            status: "BANNED",
            confirm: true,
            expectedUpdatedAt: f.user.updatedAt.toISOString(),
          },
        ],
      ] as const)
        assert.equal(
          (await f.request(path, method, body, actor)).status,
          actor === "guest" ? 401 : 403,
        );
    assert.equal(f.memory.users.get(f.user.id)!.status, "ACTIVE");
  }));
test("ban immediately blocks old access, login and refresh; unban requires new login", () =>
  fixture(async (f) => {
    const body = {
      status: "BANNED",
      confirm: true,
      expectedUpdatedAt: f.user.updatedAt.toISOString(),
    };
    const ban = await f.request(`/users/${f.user.id}/status`, "PATCH", body);
    assert.equal(ban.status, 200);
    assert.equal(ban.body.data.status, "BANNED");
    await assert.rejects(() => f.auth.authenticate(f.userTokens.accessToken));
    await assert.rejects(() => f.auth.refresh(f.userTokens.refreshToken));
    await assert.rejects(() =>
      f.auth.login(f.user.email, "Synthetic-only-123"),
    );
    const unban = await f.request(`/users/${f.user.id}/status`, "PATCH", {
      ...body,
      status: "ACTIVE",
      expectedUpdatedAt: ban.body.data.updatedAt,
    });
    assert.equal(unban.status, 200);
    await assert.rejects(() => f.auth.authenticate(f.userTokens.accessToken));
    await assert.rejects(() => f.auth.refresh(f.userTokens.refreshToken));
    const fresh = await f.auth.login(f.user.email, "Synthetic-only-123");
    assert.equal(
      (await f.auth.authenticate(fresh.accessToken)).user.status,
      "ACTIVE",
    );
  }));
test("self ban/other ADMIN changes are forbidden; no confirmation/mass assignment invalid", () =>
  fixture(async (f) => {
    const body = {
      status: "BANNED",
      confirm: true,
      expectedUpdatedAt: f.user.updatedAt.toISOString(),
    };
    assert.equal(
      (await f.request(`/users/${f.admin.id}/status`, "PATCH", body)).body.error
        .code,
      "SELF_BAN_FORBIDDEN",
    );
    const other = structuredClone(f.memory.users.get(f.admin.id)!);
    other.id = randomUUID();
    f.memory.users.set(other.id, other);
    assert.equal(
      (await f.request(`/users/${other.id}/status`, "PATCH", body)).body.error
        .code,
      "ADMIN_ACCOUNT_PROTECTED",
    );
    for (const input of [
      { status: "BANNED" },
      { ...body, confirm: false },
      { ...body, role: "ADMIN" },
      { ...body, passwordHash: "forged" },
      { ...body, status: "DELETED" },
      { ...body, expectedUpdatedAt: "bad" },
    ])
      assert.equal(
        (await f.request(`/users/${f.user.id}/status`, "PATCH", input)).status,
        400,
      );
    assert.equal(f.memory.users.get(f.user.id)!.status, "ACTIVE");
  }));
test("stale status rejected, idempotent status accepted; transaction failure rolls back", () =>
  fixture(async (f) => {
    const body = {
      status: "BANNED",
      confirm: true,
      expectedUpdatedAt: "2000-01-01T00:00:00Z",
    };
    assert.equal(
      (await f.request(`/users/${f.user.id}/status`, "PATCH", body)).body.error
        .code,
      "USER_STALE",
    );
    const current = f.user.updatedAt.toISOString();
    assert.equal(
      (
        await f.request(`/users/${f.user.id}/status`, "PATCH", {
          ...body,
          status: "ACTIVE",
          expectedUpdatedAt: current,
        })
      ).status,
      200,
    );
    f.fail("P2034");
    assert.equal(
      (
        await f.request(`/users/${f.user.id}/status`, "PATCH", {
          ...body,
          expectedUpdatedAt: current,
        })
      ).status,
      409,
    );
    assert.equal(f.memory.users.get(f.user.id)!.status, "ACTIVE");
    assert.equal(
      [...f.memory.sessions.values()].filter((s) => s.revokedAt).length,
      0,
    );
  }));
test("invalid UUID/query rejected; statistics successful and safe internal failures", () =>
  fixture(async (f) => {
    for (const path of [
      "/users/bad",
      "/users?page=0",
      "/users?limit=101",
      "/users?page=1&page=2",
      "/users?role=ADMIN",
      "/users?status=DELETED",
      "/users?search=",
      "/dashboard?role=ADMIN",
    ])
      assert.equal((await f.request(path)).status, 400);
    const r = await f.request("/dashboard");
    assert.equal(r.status, 200);
    assert.equal(r.body.data.users.total, 1);
    assert.equal(r.body.data.readingMetric, "STORED_AUTHENTICATED_HISTORY");
    assert.deepEqual(r.body.data.popularStories, []);
    f.fail("PRIVATE");
    const err = await f.request("/dashboard");
    assert.equal(err.status, 500);
    assert(!JSON.stringify(err.body).includes("private connection"));
  }));
