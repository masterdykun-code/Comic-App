import {
  readFile,
  writeFile,
  open,
  rename,
  mkdir,
  unlink,
} from "node:fs/promises";
import { resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../generated/prisma/client";
import type { ImageStorage } from "../types/upload.types";
import { assertPrimary } from "./sample-library-core";
import { publicationSchema } from "../middlewares/story.validation";
import { pageInputSchema } from "../middlewares/chapter.validation";
import {
  expansionRoot,
  approvedHash,
  digest,
  folder,
  loadExpansion,
  parseCommand,
  selectImport,
  storyId,
  chapterId,
  pageId,
  expansionId,
  checkReceipt,
  safeFile,
  type Plan,
  type Ledger,
  type Receipt,
} from "./library-expansion-core";
import {
  readEnvironment,
  readOnlyClient,
  readInventory,
  verifyBackup,
  type Reader,
} from "./library-expansion-db";

const stateRoot = resolve(expansionRoot, ".import-state");
export async function readOptional<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw Error("LOCAL_STATE_UNREADABLE");
  }
}
export async function durableJson(
  path: string,
  value: unknown,
  exclusive = false,
) {
  const temp = exclusive ? path : path + ".tmp";
  const handle = await open(temp, exclusive ? "wx" : "w", 0o600);
  try {
    await handle.writeFile(JSON.stringify(value, null, 2) + "\n");
    await handle.sync();
  } finally {
    await handle.close();
  }
  if (!exclusive) await rename(temp, path);
}
type Selection = ReturnType<typeof selectImport>;
type Remote = { secureUrl: string; publicId: string };
export async function uploadReviewedAssets(
  plan: Plan,
  selected: Selection["assets"],
  state: string,
  storage: ImageStorage,
  assertSafe: () => Promise<void>,
) {
  const remote = new Map<string, Remote>();
  // Validate every existing receipt first: a later pending file must stop all sends.
  for (const a of selected) {
    const old = await readOptional<Receipt>(resolve(state, a.sha256 + ".json"));
    if (old) remote.set(a.key, checkReceipt(old, a.sha256));
  }
  for (const a of selected) {
    if (remote.has(a.key)) continue;
    await assertSafe();
    const file = await safeFile(a.path);
    const bytes = await readFile(file);
    if (
      digest(bytes) !== a.sha256 ||
      bytes.length !== a.bytes ||
      digest(await readFile(resolve(expansionRoot, "manifest.json"))) !==
        plan.hash
    )
      throw Error("INPUT_CHANGED_BEFORE_UPLOAD");
    const receiptFile = resolve(state, a.sha256 + ".json");
    // Persist BEFORE sending; network/SDK errors leave pending and are never retried.
    await durableJson(
      receiptFile,
      { status: "pending", sha256: a.sha256 },
      true,
    );
    const uploaded = await storage.upload(
      file,
      folder,
      a.sha256,
      new AbortController().signal,
    );
    const receipt: Receipt = {
      status: "complete",
      sha256: a.sha256,
      ...uploaded,
    };
    const result = checkReceipt(receipt, a.sha256);
    await durableJson(receiptFile, receipt);
    remote.set(a.key, result);
  }
  return remote;
}
const txReader = (tx: Prisma.TransactionClient): Reader => ({
  query: async (sql) => ({
    rows: await tx.$queryRawUnsafe<Record<string, unknown>[]>(sql),
  }),
});
export async function createNewRows(
  tx: Prisma.TransactionClient,
  plan: Plan,
  selected: Selection,
  remote: Map<string, Remote>,
  publish: boolean,
) {
  const identity = () => assertPrimary(txReader(tx));
  await identity();
  const genreIds = new Map<string, string>();
  for (const g of plan.bundle.genres.filter((g) =>
    selected.stories.some((s) => s.genres.includes(g.name)),
  )) {
    const existing = await tx.genre.findUnique({
      where: { slug: g.slug },
      select: { id: true, name: true },
    });
    if (existing && existing.name !== g.name) throw Error("GENRE_COLLISION");
    if (existing) genreIds.set(g.name, existing.id);
    else {
      await identity();
      const created = await tx.genre.create({
        data: { id: expansionId("genre:" + g.slug), ...g },
        select: { id: true },
      });
      genreIds.set(g.name, created.id);
    }
  }
  for (const s of selected.stories) {
    const cover = remote.get(s.cover);
    if (!cover) throw Error("MISSING_UPLOAD_RECEIPT");
    const ids = s.genres.map((g) => genreIds.get(g)!);
    publicationSchema.parse({
      title: s.title,
      type: s.type,
      authorName: s.authorName,
      description: s.description,
      coverUrl: cover.secureUrl,
      genreIds: ids,
    });
    await identity();
    await tx.story.create({
      data: {
        id: storyId(s),
        slug: s.slug,
        title: s.title,
        type: s.type,
        authorName: s.authorName,
        description: s.description,
        coverUrl: cover.secureUrl,
        createdBy: selected.adminId,
        status:
          s.type === "NOVEL" || s.key === "explorigator"
            ? "COMPLETED"
            : "ONGOING",
        publishStatus: publish ? "PUBLISHED" : "DRAFT",
        genres: { create: ids.map((genreId) => ({ genreId })) },
      },
    });
    for (const c of s.chapters) {
      const pages = c.pages.map((key, i) => {
        const image = remote.get(key);
        if (!image) throw Error("MISSING_UPLOAD_RECEIPT");
        const page = {
          id: pageId(s, c, key),
          pageNumber: i + 1,
          imageUrl: image.secureUrl,
          storagePublicId: image.publicId,
        };
        pageInputSchema.parse({
          pageNumber: page.pageNumber,
          imageUrl: page.imageUrl,
          storagePublicId: page.storagePublicId,
        });
        return page;
      });
      const content =
        s.type === "NOVEL" ? plan.contents.get(chapterId(s, c)) : null;
      if (s.type === "NOVEL" ? !content?.trim() : !pages.length)
        throw Error("INVALID_CHAPTER_CONTENT");
      await identity();
      await tx.chapter.create({
        data: {
          id: chapterId(s, c),
          storyId: storyId(s),
          chapterNumber: c.number,
          title: c.title,
          content,
          publishStatus: publish ? "PUBLISHED" : "DRAFT",
          pages: pages.length ? { create: pages } : undefined,
        },
      });
    }
  }
}
export async function main(args = process.argv.slice(2)) {
  const command = parseCommand(args); // Reject unsafe arguments before reading credentials.
  const plan = await loadExpansion();
  const env = await readEnvironment();
  const guard = readOnlyClient(env.DATABASE_URL);
  let db: PrismaClient | undefined;
  let lock: Awaited<ReturnType<typeof open>> | undefined;
  let committed = false;
  try {
    await guard.connect();
    await assertPrimary(guard);
    if (command.apply) {
      const result = await guard.query(
        "SELECT pg_try_advisory_lock(1464746308,264) AS locked",
      );
      if (!result.rows[0].locked) throw Error("ANOTHER_IMPORT_IS_RUNNING");
    }
    await guard.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const before = await readInventory(guard);
    const migrations = await guard.query(
      "SELECT migration_name,checksum,finished_at,rolled_back_at FROM public._prisma_migrations ORDER BY migration_name",
    );
    const reviewed = JSON.parse(
      await readFile(resolve(expansionRoot, "system-inventory.json"), "utf8"),
    ) as { migrations: Array<{ migration_name: string; checksum: string }> };
    if (
      migrations.rows.length !== reviewed.migrations.length ||
      migrations.rows.some(
        (r, i) =>
          !r.finished_at ||
          r.rolled_back_at ||
          r.migration_name !== reviewed.migrations[i].migration_name ||
          r.checksum !== reviewed.migrations[i].checksum,
      )
    )
      throw Error("MIGRATIONS_NOT_SYNCHRONIZED");
    await guard.query("COMMIT");
    const ledger = await readOptional<Ledger>(
      resolve(stateRoot, "ledger.json"),
    );
    const selected = selectImport(plan, before, ledger);
    const pointer = await readOptional<{ proofPath: string }>(
      resolve(stateRoot, "backup-pointer.json"),
    );
    if (!pointer) throw Error("CURRENT_BACKUP_REQUIRED");
    const backup = await verifyBackup(pointer.proofPath, before);
    const configured = [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
    ].every(
      (key) => !!env[key] && !/^(your_|replace_|placeholder)/i.test(env[key]),
    );
    const lockExists = await readOptional<Record<string, unknown>>(
      resolve(stateRoot, "apply.lock"),
    );
    if (lockExists) throw Error("PRIOR_OUTCOME_REQUIRES_MANUAL_REVIEW");
    for (const a of selected.assets) {
      const receipt = await readOptional<Receipt>(
        resolve(stateRoot, a.sha256 + ".json"),
      );
      if (receipt) checkReceipt(receipt, a.sha256);
    }
    const report = {
      mode: command.apply ? "EXPLICIT_APPLY" : "READ_ONLY_DRY_RUN",
      database: "webnovel_db/public",
      manifestSha256: plan.hash,
      counts: selected.counts,
      totalNewRows: selected.totalNewRows,
      backup: {
        proofPath: pointer.proofPath,
        archiveBytes: backup.archiveBytes,
        archiveSha256: backup.archiveSha256,
        fullArchiveDecoded: true,
        actualRestoreNotPerformed: true,
      },
      migrationsSynchronized: true,
      cloudinaryConfigured: configured,
      excludedScans: plan.bundle.excludedAssets.map((a) => a.key),
      writesPerformed: false,
      uploadsPerformed: 0,
    };
    if (!command.apply) {
      await guard.query(
        "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
      );
      const after = await readInventory(guard);
      await guard.query("COMMIT");
      if (
        JSON.stringify(before.fingerprints) !==
        JSON.stringify(after.fingerprints)
      )
        throw Error("DATABASE_CHANGED_DURING_DRY_RUN");
      await writeFile(
        resolve(expansionRoot, "dry-run.json"),
        JSON.stringify(
          { ...report, existingDatabaseUnchanged: true },
          null,
          2,
        ) + "\n",
      );
      console.log(
        JSON.stringify({ ...report, existingDatabaseUnchanged: true }),
      );
      return;
    }
    if (!selected.stories.length) {
      console.log(
        "All 15 stories already committed by this importer; skipped unchanged. No upload or database write.",
      );
      return;
    }
    if (!configured) throw Error("CLOUDINARY_NOT_CONFIGURED");
    await mkdir(stateRoot, { recursive: true });
    lock = await open(resolve(stateRoot, "apply.lock"), "wx", 0o600);
    await lock.writeFile(
      JSON.stringify({ manifestSha256: plan.hash, phase: "applying" }),
    );
    await lock.sync();
    // SDK is loaded only after explicit apply authorization and all local/DB checks.
    for (const key of [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
    ])
      process.env[key] = env[key];
    const { cloudinaryStorage } = await import("../config/cloudinary.js");
    cloudinaryStorage.assertReady();
    const assertSafe = async () => {
      await assertPrimary(guard);
    };
    const remote = await uploadReviewedAssets(
      plan,
      selected.assets,
      stateRoot,
      cloudinaryStorage,
      assertSafe,
    );
    // Verify the source files again before starting the single database transaction.
    await loadExpansion();
    const pending: Ledger = {
      manifestSha256: plan.hash,
      phase: "database-pending",
      storyIds: [...(ledger?.storyIds || []), ...selected.stories.map(storyId)],
    };
    await durableJson(resolve(stateRoot, "ledger.json"), pending);
    db = new PrismaClient({
      adapter: new PrismaPg({ connectionString: env.DATABASE_URL }),
      log: [],
    });
    await db.$transaction(
      async (tx) => {
        await assertPrimary(txReader(tx));
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(1464746308,263)`;
        const fresh = await readInventory(txReader(tx));
        if (
          JSON.stringify(before.fingerprints) !==
          JSON.stringify(fresh.fingerprints)
        )
          throw Error("DATABASE_CHANGED_REVIEW_REQUIRED");
        const freshSelection = selectImport(plan, fresh, ledger);
        if (
          freshSelection.adminId !== selected.adminId ||
          JSON.stringify(freshSelection.counts) !==
            JSON.stringify(selected.counts)
        )
          throw Error("DATABASE_CHANGED_REVIEW_REQUIRED");
        await createNewRows(tx, plan, freshSelection, remote, command.publish);
        const after = await readInventory(txReader(tx));
        const deltas: Record<string, number> = {
          stories: selected.counts.stories,
          chapters: selected.counts.chapters,
          chapter_pages: selected.counts.chapterPages,
          genres: selected.counts.genres,
          story_genres: selected.counts.storyGenres,
        };
        for (const [table, baseline] of Object.entries(before.fingerprints)) {
          const expected = deltas[table] || 0;
          if (
            after.fingerprints[table]?.count !== baseline.count + expected ||
            (!expected && after.fingerprints[table]?.sha256 !== baseline.sha256)
          )
            throw Error("UNEXPECTED_DATABASE_DELTA");
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 120000,
      },
    );
    await durableJson(resolve(stateRoot, "ledger.json"), {
      ...pending,
      phase: "committed",
    });
    committed = true;
    console.log(
      JSON.stringify({
        status: "COMMITTED",
        database: "webnovel_db/public",
        manifestSha256: approvedHash,
        created: selected.counts,
        publishStatus: command.publish ? "PUBLISHED" : "DRAFT",
        existingRowsUpdatedOrDeleted: 0,
        automaticCloudinaryDeletes: 0,
      }),
    );
  } finally {
    await lock?.close();
    // Retain lock/pending ledger on ANY failure, including ambiguous commit response.
    if (committed) await unlink(resolve(stateRoot, "apply.lock"));
    await db?.$disconnect();
    await guard.end();
  }
}
if (require.main === module)
  main().catch((error: unknown) => {
    const safeCodes = new Set([
      "EXPLICIT_APPROVAL_REQUIRED",
      "MANIFEST_CHANGED_REVIEW_REQUIRED",
      "INPUT_HASH_MISMATCH",
      "UNAPPROVED_COUNTS",
      "SYSTEM_CHANGED_REVIEW_REQUIRED",
      "CURRENT_BACKUP_REQUIRED",
      "BACKUP_STALE_OR_WRONG_TARGET",
      "BACKUP_CHANGED_OR_UNREADABLE",
      "MIGRATIONS_NOT_SYNCHRONIZED",
      "EXACTLY_ONE_ACTIVE_ADMIN_REQUIRED",
      "EXISTING_STORY_COLLISION",
      "GENRE_COLLISION",
      "DATABASE_CHANGED_DURING_DRY_RUN",
      "PRIOR_OUTCOME_REQUIRES_MANUAL_REVIEW",
      "UNOWNED_ID_COLLISION",
      "PARTIAL_IMPORT_REQUIRES_MANUAL_REVIEW",
      "UPLOAD_OUTCOME_REQUIRES_MANUAL_REVIEW",
    ]);
    const code =
      error instanceof Error && safeCodes.has(error.message)
        ? error.message
        : "VALIDATION_OR_IO_FAILED";
    console.error(
      `Library v2 stopped safely [${code}]. Check backup, target, duplicates, input hashes, migrations and .import-state. Credentials and raw errors suppressed; never retry an ambiguous upload/commit automatically.`,
    );
    process.exitCode = 1;
  });
