import assert from "node:assert/strict";
import test from "node:test";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import type { Prisma } from "../src/generated/prisma/client";
import {
  approvedHash,
  expansionRoot,
  expansionId,
  storyId,
  chapterId,
  pageId,
  parseCommand,
  selectImport,
  validateManifest,
  checkReceipt,
  safeFile,
  folder,
  type Manifest,
  type Plan,
  type Inventory,
  type Ledger,
} from "../src/scripts/library-expansion-core";
import {
  durableJson,
  uploadReviewedAssets,
  createNewRows,
} from "../src/scripts/import-library-expansion";
import {
  readInventory,
  readOnlyClient,
  archiveDecodeArguments,
} from "../src/scripts/library-expansion-db";
import type { ImageStorage } from "../src/types/upload.types";

const bundle = JSON.parse(
  readFileSync(resolve(expansionRoot, "manifest.json"), "utf8"),
) as Manifest;
async function removeTestDirectory(dir: string) {
  const target = resolve(dir),
    allowedPrefix = resolve(tmpdir()) + sep + "webnovel-v2-test-";
  if (!target.startsWith(allowedPrefix)) throw Error("UNSAFE_TEST_CLEANUP");
  await rm(target, { recursive: true });
}
function plan(): Plan {
  return {
    bundle: structuredClone(bundle),
    hash: approvedHash,
    contents: new Map(),
  };
}
function inventory(): Inventory {
  return {
    admins: [{ id: "00000000-0000-4000-a000-000000000001" }],
    stories: [],
    genres: [],
    chapters: [],
    pages: [],
    fingerprints: {},
  };
}
function completed(p: Plan, db: Inventory, s = p.bundle.stories[0]) {
  db.stories.push({
    id: storyId(s),
    slug: "admin-edited-slug",
    title: "ADMIN edited title",
    description: "Edited",
  });
  for (const c of s.chapters) {
    db.chapters.push({ id: chapterId(s, c), storyId: storyId(s) });
    for (const k of c.pages)
      db.pages.push({ id: pageId(s, c, k), chapterId: chapterId(s, c) });
  }
  return {
    manifestSha256: p.hash,
    phase: "committed",
    storyIds: [storyId(s)],
  } as Ledger;
}
test("default is dry-run; write requires exact database, manifest and explicit publication choice", () => {
  assert.deepEqual(parseCommand([]), { apply: false, publish: false });
  assert.deepEqual(parseCommand(["--dry-run"]), {
    apply: false,
    publish: false,
  });
  const args = [
    "--apply",
    "--confirm-primary",
    "webnovel_db",
    "--plan-hash",
    approvedHash,
    "--publish-status",
    "PUBLISHED",
  ];
  assert.equal(parseCommand(args).publish, true);
  for (const [index, bad] of [
    [2, "webnovel_test_db"],
    [4, "b".repeat(64)],
    [6, "anything"],
  ] as const) {
    const copy = [...args];
    copy[index] = bad;
    assert.throws(() => parseCommand(copy), /APPROVAL/);
  }
  assert.throws(() => parseCommand(["--apply"]), /APPROVAL/);
});
test("reviewed counts include 15 stories, 482 chapters, 157 pages and 167 unique uploads", () => {
  const p = plan();
  validateManifest(p.bundle);
  const s = selectImport(p, inventory());
  assert.deepEqual(s.counts, {
    stories: 15,
    chapters: 482,
    chapterPages: 157,
    genres: 8,
    storyGenres: 23,
    images: 167,
    imageBytes: 75885834,
    skippedStories: 0,
  });
  assert.equal(s.totalNewRows, 685);
});
test("excluded crossover cannot be added to any chapter or cover", () => {
  const p = plan(),
    comic = p.bundle.stories.find((s) => s.type === "COMIC")!;
  comic.chapters[0].pages[0] = p.bundle.excludedAssets[0].key;
  assert.throws(() => validateManifest(p.bundle), /EXCLUDED/);
});
test("changing source order, chapter type content, or adding duplicate IDs fails", () => {
  let p = plan();
  p.bundle.stories[0].chapters[0].number = 2;
  assert.throws(() => validateManifest(p.bundle), /ORDER/);
  p = plan();
  p.bundle.stories[0].chapters[0].content = null;
  assert.throws(() => validateManifest(p.bundle), /CONTENT/);
  p = plan();
  p.bundle.assets[1].sha256 = p.bundle.assets[0].sha256;
  assert.throws(() => validateManifest(p.bundle), /DUPLICATE/);
});
test("ID namespace is stable and separate from v1, based on source not chapter numbering", () => {
  const s = plan().bundle.stories[0],
    c = s.chapters[0];
  assert.equal(chapterId(s, c), chapterId(s, { ...c, number: 999 }));
  assert.match(storyId(s), /^[a-f0-9-]{36}$/);
  assert.notEqual(storyId(s), expansionId("story:" + s.key));
});
test("foreign slug/title/ID collisions stop without overwrite", () => {
  const p = plan(),
    s = p.bundle.stories[0];
  for (const row of [
    { id: "foreign", slug: s.slug, title: "Unrelated", description: "" },
    { id: "foreign", slug: "other", title: s.originalTitle, description: "" },
    { id: storyId(s), slug: "other", title: "other", description: "" },
  ]) {
    const db = inventory();
    db.stories.push(row);
    assert.throws(() => selectImport(p, db), /COLLISION/);
  }
});
test("committed rerun skips entire story even after ADMIN edits", () => {
  const p = plan(),
    db = inventory(),
    ledger = completed(p, db);
  const s = selectImport(p, db, ledger);
  assert.equal(s.counts.skippedStories, 1);
  assert.equal(s.counts.stories, 14);
  assert(!s.stories.some((s) => storyId(s) === ledger.storyIds[0]));
});
test("missing children, pending commit or changed ledger hash requires manual review", () => {
  const p = plan(),
    db = inventory(),
    ledger = completed(p, db);
  db.chapters.pop();
  assert.throws(() => selectImport(p, db, ledger), /PARTIAL/);
  assert.throws(
    () =>
      selectImport(p, inventory(), { ...ledger, phase: "database-pending" }),
    /MANUAL_REVIEW/,
  );
  assert.throws(
    () => selectImport(p, inventory(), { ...ledger, manifestSha256: "wrong" }),
    /MANUAL_REVIEW/,
  );
});
test("Genre exact match is reused, partial match fails, no ADMIN creation is attempted", () => {
  const p = plan(),
    db = inventory(),
    g = p.bundle.genres[0];
  db.genres.push({ id: "existing", ...g });
  assert.equal(selectImport(p, db).counts.genres, 7);
  db.genres[0].name = "other";
  assert.throws(() => selectImport(p, db), /GENRE_COLLISION/);
  db.admins = [];
  assert.throws(() => selectImport(p, db), /ACTIVE_ADMIN/);
});
test("receipt must be completed, HTTPS Cloudinary and exact v2 public ID", () => {
  const hash = "a".repeat(64),
    receipt = {
      status: "complete" as const,
      sha256: hash,
      secureUrl: "https://res.cloudinary.com/test/image/upload/file.png",
      publicId: `${folder}/${hash}`,
    };
  assert.equal(checkReceipt(receipt, hash).publicId, receipt.publicId);
  for (const bad of [
    { ...receipt, status: "pending" as const },
    { ...receipt, publicId: "other" },
    { ...receipt, secureUrl: "https://evil.invalid/file.png" },
    { ...receipt, secureUrl: "http://res.cloudinary.com/file.png" },
  ])
    assert.throws(() => checkReceipt(bad, hash));
});
test("path traversal and test database URL are rejected before connecting", async () => {
  await assert.rejects(safeFile("../../.env"), /UNSAFE/);
  assert.throws(
    () =>
      readOnlyClient(
        "postgresql://synthetic:secret@localhost/webnovel_test_db",
      ),
    /PRIMARY/,
  );
});
test("a later pending receipt stops ALL uploads, never silently retries", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "webnovel-v2-test-"));
  let calls = 0;
  try {
    const p = plan(),
      assets = p.bundle.assets.slice(0, 2);
    await durableJson(
      resolve(dir, assets[1].sha256 + ".json"),
      { status: "pending", sha256: assets[1].sha256 },
      true,
    );
    const storage: ImageStorage = {
      assertReady() {},
      async upload() {
        calls++;
        throw Error("not reached");
      },
    };
    await assert.rejects(
      uploadReviewedAssets(p, assets, dir, storage, async () => {}),
      /MANUAL_REVIEW/,
    );
    assert.equal(calls, 0);
  } finally {
    await removeTestDirectory(dir);
  }
});
test("SDK failure sends exactly once and retains a durable pending receipt", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "webnovel-v2-test-"));
  let calls = 0;
  try {
    const p = plan(),
      a = p.bundle.assets[0];
    const storage: ImageStorage = {
      assertReady() {},
      async upload() {
        calls++;
        throw Error("synthetic network failure");
      },
    };
    await assert.rejects(
      uploadReviewedAssets(p, [a], dir, storage, async () => {}),
    );
    await assert.rejects(
      uploadReviewedAssets(p, [a], dir, storage, async () => {}),
      /MANUAL_REVIEW/,
    );
    assert.equal(calls, 1);
    assert.equal(
      JSON.parse(await readFile(resolve(dir, a.sha256 + ".json"), "utf8"))
        .status,
      "pending",
    );
  } finally {
    await removeTestDirectory(dir);
  }
});
test("completed receipt is reused without calling external storage", async () => {
  const dir = await mkdtemp(resolve(tmpdir(), "webnovel-v2-test-"));
  try {
    const p = plan(),
      a = p.bundle.assets[0];
    await durableJson(
      resolve(dir, a.sha256 + ".json"),
      {
        status: "complete",
        sha256: a.sha256,
        secureUrl: "https://res.cloudinary.com/test/image/upload/file.png",
        publicId: `${folder}/${a.sha256}`,
      },
      true,
    );
    const storage: ImageStorage = {
      assertReady() {},
      async upload() {
        throw Error("external call forbidden");
      },
    };
    assert.equal(
      (await uploadReviewedAssets(p, [a], dir, storage, async () => {})).size,
      1,
    );
  } finally {
    await removeTestDirectory(dir);
  }
});
test("inventory reads only ADMIN id and returns no raw passwords or tokens", async () => {
  const queries: string[] = [];
  const db = {
    async query(sql: string) {
      queries.push(sql);
      return {
        rows: sql.includes("current_database")
          ? [{ name: "webnovel_db", schema: "public" }]
          : [],
      };
    },
  };
  await readInventory(db);
  assert(
    queries.includes(
      "SELECT id FROM public.users WHERE role='ADMIN' AND status='ACTIVE' ORDER BY id",
    ),
  );
  assert(
    !queries.some((q) => /password_hash|refresh_token|authorization/i.test(q)),
  );
  assert(
    !queries.some((q) => /^(INSERT|UPDATE|DELETE|DROP|TRUNCATE)/i.test(q)),
  );
});
test("invalid CLI cannot connect, upload, or expose sensitive inputs", () => {
  const r = spawnSync(
    process.execPath,
    [
      "node_modules/tsx/dist/cli.mjs",
      "src/scripts/import-library-expansion.ts",
      "--apply",
    ],
    {
      cwd: resolve(__dirname, ".."),
      windowsHide: true,
      timeout: 20000,
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL:
          "postgresql://synthetic:sensitive-example@invalid.example/webnovel_db",
        CLOUDINARY_API_SECRET: "sensitive-example",
      },
    },
  );
  assert.equal(r.status, 1);
  assert.match(r.stderr, /stopped safely/);
  assert.doesNotMatch(
    r.stderr + r.stdout,
    /sensitive-example|postgresql:|invalid\.example|synthetic/,
  );
});
test("row writer only creates new rows, preserves attribution, and propagates transaction failures", async () => {
  const p = plan(),
    db = inventory(),
    selected = selectImport(p, db);
  selected.stories = [p.bundle.stories[0]];
  for (const c of selected.stories[0].chapters)
    p.contents.set(
      chapterId(selected.stories[0], c),
      "Real verified text in production; synthetic test only",
    );
  const calls: string[] = [],
    stories: unknown[] = [];
  const tx = {
    $queryRawUnsafe: async () => [{ name: "webnovel_db", schema: "public" }],
    genre: {
      findUnique: async () => null,
      create: async ({ data }: { data: { id: string } }) => {
        calls.push("genre.create");
        return { id: data.id };
      },
    },
    story: {
      create: async (args: unknown) => {
        calls.push("story.create");
        stories.push(args);
      },
    },
    chapter: {
      create: async () => {
        calls.push("chapter.create");
        throw Error("synthetic transaction failure");
      },
    },
  } as unknown as Prisma.TransactionClient;
  const remote = new Map([
    [
      selected.stories[0].cover,
      {
        secureUrl: "https://res.cloudinary.com/test/image/upload/file.png",
        publicId: "test",
      },
    ],
  ]);
  await assert.rejects(
    createNewRows(tx, p, selected, remote, true),
    /transaction failure/,
  );
  assert(calls.includes("story.create"));
  assert(!calls.some((s) => /update|delete|upsert/.test(s)));
  assert.equal(
    (stories[0] as { data: { description: string } }).data.description,
    selected.stories[0].description,
  );
});

test("complete committed rerun creates zero rows and uploads zero images", () => {
  const p = plan(),
    db = inventory();
  const ledger: Ledger = {
    manifestSha256: p.hash,
    phase: "committed",
    storyIds: [],
  };
  for (const s of p.bundle.stories)
    ledger.storyIds.push(...completed(p, db, s).storyIds);
  const result = selectImport(p, db, ledger);
  assert.equal(result.totalNewRows, 0);
  assert.equal(result.assets.length, 0);
  assert.equal(result.counts.skippedStories, 15);
});

test("archive verification is deterministic and cannot connect to a database", () => {
  const args = archiveDecodeArguments("local.dump", "a".repeat(64));
  assert.deepEqual(args, archiveDecodeArguments("local.dump", "a".repeat(64)));
  assert(args.includes("--file=-"));
  assert(args[0].startsWith("--restrict-key="));
  assert(!args.some((s) => s === "-d" || s.startsWith("--dbname")));
  assert.throws(() => archiveDecodeArguments("local.dump", "untrusted"));
});

test("COMIC row writer keeps supplied page order and public IDs without changing existing rows", async () => {
  const p = plan(),
    selected = selectImport(p, inventory());
  const s = p.bundle.stories.find((s) => s.type === "COMIC")!;
  const order = [s.chapters[1].pages[0], s.chapters[0].pages[0]];
  s.chapters = [{ ...s.chapters[0], pages: order }];
  selected.stories = [s];
  const chapterWrites: Array<{
    data: {
      pages: { create: Array<{ pageNumber: number; storagePublicId: string }> };
      publishStatus: string;
    };
  }> = [];
  const tx = {
    $queryRawUnsafe: async () => [{ name: "webnovel_db", schema: "public" }],
    genre: {
      findUnique: async () => null,
      create: async ({ data }: { data: { id: string } }) => ({ id: data.id }),
    },
    story: { create: async () => {} },
    chapter: {
      create: async (args: (typeof chapterWrites)[number]) => {
        chapterWrites.push(args);
      },
    },
  } as unknown as Prisma.TransactionClient;
  const remote = new Map(
    [s.cover, ...order].map((key) => [
      key,
      {
        secureUrl:
          "https://res.cloudinary.com/test/image/upload/" + key + ".png",
        publicId: key,
      },
    ]),
  );
  await createNewRows(tx, p, selected, remote, false);
  assert.deepEqual(
    chapterWrites[0].data.pages.create.map((p) => [
      p.pageNumber,
      p.storagePublicId,
    ]),
    [
      [1, order[0]],
      [2, order[1]],
    ],
  );
  assert.equal(chapterWrites[0].data.publishStatus, "DRAFT");
});
