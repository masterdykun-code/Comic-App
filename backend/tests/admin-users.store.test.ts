import assert from "node:assert/strict";
import test from "node:test";
import type { PrismaClient } from "../src/generated/prisma/client";
import { createPrismaAdminUsersStore } from "../src/services/admin-users.store";
const id = "10000000-0000-4000-8000-000000000001";
test("ban adapter locks user then updates only target and revokes sessions/resets atomically", async () => {
  const calls: string[] = [],
    now = new Date();
  let options: any;
  const tx = {
    $queryRaw: async (parts: TemplateStringsArray, ...values: unknown[]) => {
      assert.match(parts.join("?"), /public\.users.*FOR UPDATE/);
      assert.deepEqual(values, [id]);
      calls.push("lock");
    },
    user: {
      findUnique: async (args: any) => {
        assert.equal(args.where.id, id);
        assert.equal(args.select.passwordHash, undefined);
        calls.push("find");
        return { id };
      },
      update: async (args: any) => {
        assert.deepEqual(args.where, { id });
        assert.deepEqual(args.data, { status: "BANNED", updatedAt: now });
        assert.equal(args.select.passwordHash, undefined);
        calls.push("update");
        return { id };
      },
    },
    authSession: {
      updateMany: async (args: any) => {
        assert.deepEqual(args, {
          where: { userId: id, revokedAt: null },
          data: { revokedAt: now },
        });
        calls.push("sessions");
      },
    },
    passwordReset: {
      updateMany: async (args: any) => {
        assert.deepEqual(args, {
          where: { userId: id, consumedAt: null },
          data: { consumedAt: now },
        });
        calls.push("resets");
      },
    },
  };
  const store = createPrismaAdminUsersStore(
    () =>
      ({
        $transaction: async (work: any, config: any) => {
          options = config;
          return work(tx);
        },
      }) as unknown as PrismaClient,
  );
  await store.transaction("write", async (a) => {
    await a.user(id, true);
    await a.setStatus(id, "BANNED", now);
  });
  assert.equal(options.isolationLevel, "ReadCommitted");
  assert.deepEqual(calls, ["lock", "find", "update", "sessions", "resets"]);
});
test("unban never revives sessions or password resets; rollback failures propagate", async () => {
  let data: any;
  const store = createPrismaAdminUsersStore(
    () =>
      ({
        $transaction: async (work: any) =>
          work({
            user: {
              update: async (args: any) => {
                data = args.data;
                return { id };
              },
            },
          }),
      }) as unknown as PrismaClient,
  );
  await store.transaction("write", (a) =>
    a.setStatus(id, "ACTIVE", new Date()),
  );
  assert.equal(data.status, "ACTIVE");
  assert(data.updatedAt instanceof Date);
  const broken = createPrismaAdminUsersStore(
    () =>
      ({
        $transaction: async () => {
          throw new Error("rollback");
        },
      }) as unknown as PrismaClient,
  );
  await assert.rejects(
    () =>
      broken.transaction("write", (a) => a.setStatus(id, "BANNED", new Date())),
    /rollback/,
  );
});
test("list uses USER-only filters, escaped literal search, stable pagination and no password projection", async () => {
  let counted: any, listed: any, config: any;
  const store = createPrismaAdminUsersStore(
    () =>
      ({
        $transaction: async (work: any, c: any) => {
          config = c;
          return work({
            user: {
              count: async (args: any) => {
                counted = args;
                return 22;
              },
              findMany: async (args: any) => {
                listed = args;
                return [];
              },
            },
          });
        },
      }) as unknown as PrismaClient,
  );
  const result = await store.transaction("read", (a) =>
    a.list({ page: 2, limit: 20, status: "BANNED", search: "a_%" }),
  );
  assert.equal(config.isolationLevel, "RepeatableRead");
  assert.deepEqual(listed.where, counted.where);
  assert.equal(listed.where.role, "USER");
  assert.equal(listed.where.status, "BANNED");
  assert.equal(listed.where.OR[0].username.contains, "a\\_\\%");
  assert.equal(listed.where.OR[0].username.mode, "insensitive");
  assert.equal(listed.skip, 20);
  assert.equal(listed.take, 20);
  assert.equal(listed.select.passwordHash, undefined);
  assert.equal(result.total, 22);
});
test("dashboard counts both story types and all chapters; ranks stored history using one snapshot", async () => {
  let grouped: any, config: any;
  const store = createPrismaAdminUsersStore(
    () =>
      ({
        $transaction: async (work: any, c: any) => {
          config = c;
          return work({
            user: {
              count: async (args: any) => {
                assert.equal(args.where.role, "USER");
                return args.where.status === "ACTIVE"
                  ? 3
                  : args.where.status === "BANNED"
                    ? 1
                    : 4;
              },
            },
            story: {
              count: async (args: any) =>
                args.where.type === "NOVEL"
                  ? 10
                  : args.where.type === "COMIC"
                    ? 5
                    : 12,
              findMany: async () => [
                {
                  id: "b",
                  title: "Second",
                  type: "COMIC",
                  publishStatus: "DRAFT",
                },
                {
                  id: "a",
                  title: "First",
                  type: "NOVEL",
                  publishStatus: "PUBLISHED",
                },
              ],
            },
            chapter: { count: async () => 482 },
            readingHistory: {
              count: async () => 12,
              groupBy: async (args: any) => {
                grouped = args;
                return [
                  { storyId: "a", _count: { _all: 9 } },
                  { storyId: "b", _count: { _all: 3 } },
                ];
              },
            },
          });
        },
      }) as unknown as PrismaClient,
  );
  const r = await store.transaction("read", (a) => a.stats());
  assert.equal(config.isolationLevel, "RepeatableRead");
  assert.deepEqual(r.users, { total: 4, active: 3, banned: 1 });
  assert.deepEqual(r.stories, {
    total: 15,
    novels: 10,
    comics: 5,
    published: 12,
  });
  assert.equal(r.totalChapters, 482);
  assert.equal(r.readingEvents, 12);
  assert.deepEqual(
    r.popularStories.map((s) => [s.id, s.readCount]),
    [
      ["a", 9],
      ["b", 3],
    ],
  );
  assert.equal(grouped.take, 10);
  assert.deepEqual(grouped.by, ["storyId"]);
});
test("empty dashboard returns real zeros and never queries an empty story ranking", async () => {
  const store = createPrismaAdminUsersStore(
    () =>
      ({
        $transaction: async (work: any) =>
          work({
            user: { count: async () => 0 },
            story: { count: async () => 0 },
            chapter: { count: async () => 0 },
            readingHistory: { count: async () => 0, groupBy: async () => [] },
          }),
      }) as unknown as PrismaClient,
  );
  const r = await store.transaction("read", (a) => a.stats());
  assert.equal(r.readingEvents, 0);
  assert.equal(r.stories.total, 0);
  assert.deepEqual(r.popularStories, []);
});
