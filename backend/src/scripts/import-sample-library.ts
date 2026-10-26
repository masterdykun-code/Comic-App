import { readFile, mkdir, writeFile, rename, open } from "node:fs/promises";
import { resolve } from "node:path";
import { parse } from "dotenv";
import { Client } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, Prisma } from "../generated/prisma/client";
import { cloudinaryStorage } from "../config/cloudinary";
import {
  bundleRoot,
  genres,
  validatePrimaryUrl,
  assertPrimary,
  loadBundle,
  stableId,
  localFile,
  validateAssetReceipt,
  assertApplyApproval,
  type Bundle,
} from "./sample-library-core";
import { publicationSchema } from "../middlewares/story.validation";
type Receipt = {
  status: string;
  sha256: string;
  secureUrl?: string;
  publicId?: string;
};
async function identity(tx: Prisma.TransactionClient) {
  const r = await tx.$queryRaw<
    Array<{ name: string; schema: string }>
  >`SELECT current_database() AS name,current_schema() AS schema`;
  if (r[0]?.name !== "webnovel_db" || r[0]?.schema !== "public")
    throw new Error("PRIMARY_DATABASE_REQUIRED");
}
export async function snapshot(tx: Prisma.TransactionClient, bundle: Bundle) {
  await identity(tx);
  const admins = await tx.user.findMany({
    where: { role: "ADMIN", status: "ACTIVE" },
    select: { id: true },
  });
  if (admins.length !== 1) throw new Error("EXACTLY_ONE_ACTIVE_ADMIN_REQUIRED");
  const existing = await tx.story.findMany({
    select: { id: true, slug: true, title: true, authorName: true },
  });
  const skip = new Set<string>();
  for (const s of bundle.stories) {
    const owned = existing.find((r) => r.id === stableId("story:" + s.key));
    if (owned) {
      if (owned.slug !== s.slug) throw new Error("IMPORT_ID_COLLISION");
      skip.add(s.key);
      continue;
    }
    if (
      existing.some(
        (r) =>
          r.slug === s.slug ||
          r.title.normalize("NFKC").toLocaleLowerCase() ===
            s.title.normalize("NFKC").toLocaleLowerCase() ||
          (r.authorName === s.authorName &&
            r.title.includes(String(s.originalTitle ?? s.title))),
      )
    )
      throw new Error("EXISTING_STORY_COLLISION");
  }
  const found = await tx.genre.findMany({
    where: {
      OR: [
        { slug: { in: genres.map((g) => g.slug) } },
        { name: { in: genres.map((g) => g.name) } },
      ],
    },
    select: { id: true, slug: true, name: true },
  });
  if (
    found.some(
      (g) => !genres.some((w) => w.slug === g.slug && w.name === g.name),
    )
  )
    throw new Error("GENRE_COLLISION");
  return { adminId: admins[0].id, skip, found };
}
export async function main(args = process.argv.slice(2)) {
  const apply = args[0] === "--apply";
  if (args.length && !apply && !(args.length === 1 && args[0] === "--inspect"))
    throw new Error("INVALID_COMMAND");
  const { bundle, planHash, contents } = await loadBundle();
  if (apply) assertApplyApproval(args, planHash);
  const env = parse(await readFile(resolve(__dirname, "../../.env"), "utf8"));
  const raw = env.DATABASE_URL;
  validatePrimaryUrl(raw);
  // All connection values come from backend/.env, never the integration environment.
  const guard = new Client({
    connectionString: raw,
    options: "-c default_transaction_read_only=on",
    connectionTimeoutMillis: 5000,
  });
  const db = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: raw,
      options: apply ? undefined : "-c default_transaction_read_only=on",
      connectionTimeoutMillis: 5000,
    }),
    log: [],
  });
  let lockFile: Awaited<ReturnType<typeof open>> | undefined;
  const stateDir = resolve(bundleRoot, ".import-state");
  try {
    await guard.connect();
    await assertPrimary(guard);
    if (apply) {
      const lock = await guard.query(
        "SELECT pg_try_advisory_lock(1464746308,164) AS locked",
      );
      if (!lock.rows[0].locked) throw new Error("ANOTHER_IMPORT_IS_RUNNING");
    }
    const state = await db.$transaction((tx) => snapshot(tx, bundle));
    console.log(
      JSON.stringify({
        target: "webnovel_db/public",
        mode: apply ? "APPROVED_APPLY" : "READ_ONLY_INSPECT",
        planHash,
        activeAdmin: 1,
        storiesToCreate: 10 - state.skip.size,
        storiesSkipped: state.skip.size,
        genresToCreate:
          state.skip.size === 10 ? 0 : genres.length - state.found.length,
        chaptersToCreate: bundle.stories
          .filter((s) => !state.skip.has(s.key))
          .reduce((n, s) => n + s.chapters.length, 0),
        pagesToCreate: bundle.stories
          .filter((s) => !state.skip.has(s.key))
          .reduce(
            (n, s) => n + s.chapters.reduce((m, c) => m + c.pages.length, 0),
            0,
          ),
        cloudinaryConfigured: [
          "CLOUDINARY_CLOUD_NAME",
          "CLOUDINARY_API_KEY",
          "CLOUDINARY_API_SECRET",
        ].every(
          (k) => !!env[k] && !/^(your_|replace_|placeholder)/i.test(env[k]),
        ),
      }),
    );
    if (!apply || state.skip.size === 10) return;
    for (const key of [
      "CLOUDINARY_CLOUD_NAME",
      "CLOUDINARY_API_KEY",
      "CLOUDINARY_API_SECRET",
    ])
      process.env[key] = env[key] ?? "";
    cloudinaryStorage.assertReady();
    await mkdir(stateDir, { recursive: true });
    lockFile = await open(resolve(stateDir, "apply.lock"), "wx");
    // An unfinished apply.lock is deliberately retained: no ambiguous upload is replayed.
    const assets = new Map<string, { secureUrl: string; publicId: string }>();
    for (const a of bundle.assets.filter((a) =>
      bundle.stories.some(
        (s) =>
          !state.skip.has(s.key) &&
          (s.cover === a.key ||
            s.chapters.some((c) => c.pages.includes(a.key))),
      ),
    )) {
      await assertPrimary(guard);
      const file = resolve(stateDir, a.sha256 + ".json");
      let receipt: Receipt | undefined;
      try {
        receipt = JSON.parse(await readFile(file, "utf8"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (receipt) {
        validateAssetReceipt(receipt, a.sha256);
      } else {
        await writeFile(
          file,
          JSON.stringify({ status: "pending", sha256: a.sha256 }),
          { flag: "wx" },
        );
        const uploaded = await cloudinaryStorage.upload(
          localFile(a.path),
          "webnovel/sample-library/v1",
          a.sha256,
          new AbortController().signal,
        );
        receipt = { status: "complete", sha256: a.sha256, ...uploaded };
        validateAssetReceipt(receipt, a.sha256);
        const temp = file + ".tmp";
        await writeFile(temp, JSON.stringify(receipt));
        await rename(temp, file);
      }
      assets.set(a.key, {
        secureUrl: receipt.secureUrl!,
        publicId: receipt.publicId!,
      });
    }
    await db.$transaction(
      async (tx) => {
        await identity(tx);
        await tx.$queryRaw`SELECT 1 AS locked FROM pg_advisory_xact_lock(1464746308,163)`;
        const fresh = await snapshot(tx, bundle);
        if (
          fresh.adminId !== state.adminId ||
          [...fresh.skip].sort().join() !== [...state.skip].sort().join()
        )
          throw new Error("DATABASE_CHANGED_REINSPECT_REQUIRED");
        for (const s of bundle.stories.filter((s) => !fresh.skip.has(s.key))) {
          const genreDefinition = genres.find((g) => g.slug === s.genre)!;
          let genre = await tx.genre.findUnique({
            where: { slug: s.genre },
            select: { id: true, name: true },
          });
          if (!genre) {
            await identity(tx);
            genre = await tx.genre.create({
              data: { id: stableId("genre:" + s.genre), ...genreDefinition },
              select: { id: true, name: true },
            });
          }
          if (genre.name !== genreDefinition.name)
            throw new Error("GENRE_CHANGED");
          const cover = assets.get(s.cover)!;
          publicationSchema.parse({
            title: s.title,
            type: s.type,
            authorName: s.authorName,
            description: s.description,
            coverUrl: cover.secureUrl,
            genreIds: [genre.id],
          });
          await identity(tx);
          const story = await tx.story.create({
            data: {
              id: stableId("story:" + s.key),
              slug: s.slug,
              title: s.title,
              type: s.type,
              authorName: s.authorName,
              description: s.description,
              coverUrl: cover.secureUrl,
              status: "ONGOING",
              publishStatus: "PUBLISHED",
              createdBy: fresh.adminId,
              genres: { create: { genreId: genre.id } },
            },
          });
          for (const c of s.chapters) {
            await identity(tx);
            await tx.chapter.create({
              data: {
                id: stableId("chapter:" + s.key + ":" + c.number),
                storyId: story.id,
                chapterNumber: c.number,
                title: c.title,
                content:
                  s.type === "NOVEL"
                    ? contents.get(s.key + ":" + c.number)!
                    : null,
                publishStatus: "PUBLISHED",
                pages:
                  s.type === "COMIC"
                    ? {
                        create: c.pages.map((key, i) => ({
                          id: stableId(
                            "page:" + s.key + ":" + c.number + ":" + i,
                          ),
                          pageNumber: i + 1,
                          imageUrl: assets.get(key)!.secureUrl,
                          storagePublicId: assets.get(key)!.publicId,
                        })),
                      }
                    : undefined,
              },
            });
          }
        }
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 60000,
      },
    );
    console.log(
      "APPROVED IMPORT COMMITTED. Existing records untouched. Receipts retained; no automatic image cleanup.",
    );
  } finally {
    await lockFile?.close();
    await guard.end();
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch((error: unknown) => {
    const safeCodes = new Set([
      "PRIMARY_DATABASE_REQUIRED",
      "EXACTLY_ONE_ACTIVE_ADMIN_REQUIRED",
      "EXPLICIT_PLAN_APPROVAL_REQUIRED",
      "EXISTING_STORY_COLLISION",
      "IMPORT_ID_COLLISION",
      "GENRE_COLLISION",
      "UPLOAD_OUTCOME_REQUIRES_MANUAL_REVIEW",
      "UNTRUSTED_ASSET_RECEIPT",
      "DATABASE_CHANGED_REINSPECT_REQUIRED",
      "ANOTHER_IMPORT_IS_RUNNING",
      "TEXT_HASH_MISMATCH",
      "ASSET_HASH_OR_SIZE_MISMATCH",
      "INVALID_LIBRARY_COUNTS",
    ]);
    const code =
      error instanceof Error && safeCodes.has(error.message)
        ? error.message
        : "VALIDATION_OR_IO_FAILED";
    console.error(
      `Import stopped [${code}]. No raw credentials/errors logged. Inspect plan, duplicate checks and .import-state; never automatically retry an ambiguous upload.`,
    );
    process.exitCode = 1;
  });
