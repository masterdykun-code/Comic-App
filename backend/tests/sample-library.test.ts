import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePrimaryUrl,
  assertPrimary,
  localFile,
  stableId,
  assertApplyApproval,
  validateAssetReceipt,
  type Bundle,
} from "../src/scripts/sample-library-core";
import { snapshot } from "../src/scripts/import-sample-library";
import type { Prisma } from "../src/generated/prisma/client";
const planHash = "a".repeat(64);
test("import URL refuses test DB, foreign hosts and non-public schema", () => {
  validatePrimaryUrl(
    "postgresql://local:synthetic@localhost:5432/webnovel_db?schema=public",
  );
  for (const url of [
    "postgresql://local:synthetic@localhost/webnovel_test_db",
    "postgresql://local:synthetic@example.invalid/webnovel_db",
    "postgresql://local:synthetic@localhost/webnovel_db?schema=other",
    "postgresql://local:synthetic@localhost/webnovel_db?options=unsafe",
  ])
    assert.throws(() => validatePrimaryUrl(url));
});
test("actual SQL identity is required, not just URL path", async () => {
  await assert.rejects(
    assertPrimary({
      query: async () => ({
        rows: [{ name: "webnovel_test_db", schema: "public" }],
      }),
    }),
    /PRIMARY_DATABASE_REQUIRED/,
  );
  await assertPrimary({
    query: async () => ({ rows: [{ name: "webnovel_db", schema: "public" }] }),
  });
});
test("write approval binds exact target and current local manifest hash", () => {
  assertApplyApproval(
    ["--apply", "--confirm-primary", "webnovel_db", "--plan-hash", planHash],
    planHash,
  );
  for (const args of [
    [],
    ["--apply"],
    [
      "--apply",
      "--confirm-primary",
      "webnovel_test_db",
      "--plan-hash",
      planHash,
    ],
    [
      "--apply",
      "--confirm-primary",
      "webnovel_db",
      "--plan-hash",
      "b".repeat(64),
    ],
  ])
    assert.throws(
      () => assertApplyApproval(args, planHash),
      /EXPLICIT_PLAN_APPROVAL_REQUIRED/,
    );
});
test("asset paths cannot traverse outside bundle; IDs are stable UUIDs", () => {
  assert.throws(() => localFile("../../.env"), /UNSAFE_LOCAL_PATH/);
  assert.equal(stableId("story:alice"), stableId("story:alice"));
  assert.match(
    stableId("story:alice"),
    /^[a-f0-9]{8}-[a-f0-9]{4}-5[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/,
  );
});
test("pending/ambiguous uploads must never be automatically replayed", () => {
  assert.throws(
    () =>
      validateAssetReceipt({ status: "pending", sha256: planHash }, planHash),
    /MANUAL_REVIEW/,
  );
  validateAssetReceipt(
    {
      status: "complete",
      sha256: planHash,
      secureUrl: "https://res.cloudinary.com/example/image/upload/sample.jpg",
      publicId: "webnovel/sample-library/v1/" + planHash,
    },
    planHash,
  );
  assert.throws(
    () =>
      validateAssetReceipt(
        {
          status: "complete",
          sha256: planHash,
          secureUrl: "https://example.invalid/sample.jpg",
          publicId: "webnovel/sample-library/v1/" + planHash,
        },
        planHash,
      ),
    /UNTRUSTED/,
  );
});
const bundle = {
  stories: [
    {
      key: "alice",
      slug: "sample-v1-alice",
      title: "Alice (đọc thử)",
      originalTitle: "Alice",
      authorName: "Lewis Carroll",
    },
  ],
} as unknown as Bundle;
function fake(
  stories: Array<{
    id: string;
    slug: string;
    title: string;
    authorName: string;
  }>,
  admins = [{ id: "existing-admin" }],
) {
  const selections: unknown[] = [];
  const tx = {
    $queryRaw: async () => [{ name: "webnovel_db", schema: "public" }],
    user: {
      findMany: async (args: unknown) => {
        selections.push(args);
        return admins;
      },
    },
    story: { findMany: async () => stories },
    genre: { findMany: async () => [] },
  };
  return { tx: tx as unknown as Prisma.TransactionClient, selections };
}
test("duplicates with a foreign ID stop instead of overwrite or title suffix retries", async () => {
  const { tx } = fake([
    {
      id: "foreign",
      slug: "sample-v1-alice",
      title: "Existing work",
      authorName: "Someone",
    },
  ]);
  await assert.rejects(snapshot(tx, bundle), /EXISTING_STORY_COLLISION/);
});
test("rerun skips prior import unchanged and never queries user password hashes", async () => {
  const { tx, selections } = fake([
    {
      id: stableId("story:alice"),
      slug: "sample-v1-alice",
      title: "User edited title",
      authorName: "Lewis Carroll",
    },
  ]);
  const s = await snapshot(tx, bundle);
  assert(s.skip.has("alice"));
  assert.deepEqual(selections, [
    { where: { role: "ADMIN", status: "ACTIVE" }, select: { id: true } },
  ]);
});
test("no new ADMIN is created or USER promoted when active ADMIN is absent", async () => {
  const { tx } = fake([], []);
  await assert.rejects(
    snapshot(tx, bundle),
    /EXACTLY_ONE_ACTIVE_ADMIN_REQUIRED/,
  );
});
