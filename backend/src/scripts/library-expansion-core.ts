import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { validateImage } from "../middlewares/upload.validation";
import { publicationSchema } from "../middlewares/story.validation";
import {
  novelContentSchema,
  pageInputSchema,
} from "../middlewares/chapter.validation";

export const expansionRoot = resolve(
  __dirname,
  "../../catalog/library-expansion-v2",
);
export const approvedHash =
  "32d44af8a6e2f1a90c0d86f320bb4b68ee483c58c33171bf1f15bf241aea2457";
export const folder = "webnovel/library-expansion/v2";
export const digest = (value: Buffer | string) =>
  createHash("sha256").update(value).digest("hex");
export function expansionId(key: string) {
  const h = digest("webnovel-library-expansion-v2:" + key);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export const storyId = (s: Work) => expansionId("story:" + s.sourceId);
export const chapterId = (s: Work, c: Chapter) =>
  expansionId("chapter:" + s.sourceId + ":" + c.sourceId);
export const pageId = (s: Work, c: Chapter, key: string) =>
  expansionId("page:" + chapterId(s, c) + ":" + key);
export const normalizeName = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
const file = z
  .object({
    path: z.string().min(1),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    bytes: z.number().int().positive(),
  })
  .passthrough();
const asset = file.extend({
  key: z.string().min(1),
  author: z.string().min(1),
  license: z.string().min(1),
  sourceUrl: z.string().min(1),
});
const chapter = z
  .object({
    number: z.number().int().positive(),
    sourceId: z.string().min(1),
    title: z.string().min(1).max(200),
    content: file.nullable(),
    pages: z.array(z.string()),
  })
  .passthrough();
const work = z
  .object({
    key: z.string().min(1),
    sourceId: z.string().min(1),
    slug: z.string().regex(/^library-v2-[a-z0-9-]+$/),
    title: z.string().min(1).max(200),
    originalTitle: z.string().min(1),
    authorName: z.string().min(1).max(100),
    description: z.string().min(1).max(10000),
    type: z.enum(["NOVEL", "COMIC"]),
    genres: z.array(z.string()).min(1),
    cover: z.string(),
    chapters: z.array(chapter).min(1),
  })
  .passthrough();
const schema = z
  .object({
    version: z.literal("library-expansion-v2"),
    intendedDatabase: z.literal("webnovel_db/public"),
    assets: z.array(asset),
    stories: z.array(work),
    genres: z.array(z.object({ slug: z.string(), name: z.string() })),
    fileIndex: z.array(file),
    excludedAssets: z.array(z.object({ key: z.string() })),
  })
  .passthrough();
export type Chapter = z.infer<typeof chapter>;
export type Work = z.infer<typeof work>;
export type Manifest = z.infer<typeof schema>;
export type Plan = {
  bundle: Manifest;
  hash: string;
  contents: Map<string, string>;
};
export type Fingerprints = Record<string, { count: number; sha256: string }>;
export type Inventory = {
  admins: Array<{ id: string }>;
  stories: Array<{
    id: string;
    slug: string;
    title: string;
    description: string;
  }>;
  genres: Array<{ id: string; slug: string; name: string }>;
  chapters: Array<{ id: string; storyId: string }>;
  pages: Array<{ id: string; chapterId: string }>;
  fingerprints: Fingerprints;
};
export type Ledger = {
  manifestSha256: string;
  phase: "database-pending" | "committed";
  storyIds: string[];
};
export function unique(values: string[]) {
  if (new Set(values).size !== values.length)
    throw Error("DUPLICATE_MANIFEST_ID");
}
export function validateManifest(m: Manifest) {
  if (
    m.stories.length !== 15 ||
    m.stories.filter((s) => s.type === "NOVEL").length !== 10 ||
    m.stories.filter((s) => s.type === "COMIC").length !== 5 ||
    m.assets.length !== 167 ||
    m.stories.reduce((n, s) => n + s.chapters.length, 0) !== 482 ||
    m.stories.reduce(
      (n, s) => n + s.chapters.reduce((a, c) => a + c.pages.length, 0),
      0,
    ) !== 157
  )
    throw Error("UNAPPROVED_COUNTS");
  for (const values of [
    m.stories.map((s) => s.sourceId),
    m.stories.map((s) => s.slug),
    m.assets.map((a) => a.key),
    m.assets.map((a) => a.sha256),
    m.genres.map((g) => g.slug),
    m.genres.map((g) => g.name),
    m.fileIndex.map((f) => f.path),
  ])
    unique(values);
  const keys = new Set(m.assets.map((a) => a.key));
  const excluded = new Set(m.excludedAssets.map((a) => a.key));
  const used = new Set<string>();
  for (const s of m.stories) {
    unique(s.chapters.map((c) => c.sourceId));
    unique(s.genres);
    if (s.genres.some((g) => !m.genres.some((x) => x.name === g)))
      throw Error("UNKNOWN_GENRE");
    const cover = m.assets.find((a) => a.key === s.cover);
    if (!cover || cover.bytes > 5 * 1024 * 1024 || excluded.has(s.cover))
      throw Error("INVALID_COVER");
    used.add(s.cover);
    publicationSchema.parse({
      title: s.title,
      type: s.type,
      authorName: s.authorName,
      description: s.description,
      coverUrl: "https://example.invalid/reviewed.png",
      genreIds: s.genres.map((g) =>
        expansionId("genre:" + m.genres.find((x) => x.name === g)!.slug),
      ),
    });
    for (const [i, c] of s.chapters.entries()) {
      if (c.number !== i + 1) throw Error("INVALID_CHAPTER_ORDER");
      unique(c.pages);
      if (
        s.type === "NOVEL"
          ? !c.content || c.pages.length !== 0
          : c.content !== null || !c.pages.length || c.pages.length > 200
      )
        throw Error("INVALID_CHAPTER_CONTENT");
      for (const key of c.pages) {
        if (!keys.has(key) || excluded.has(key))
          throw Error("EXCLUDED_OR_UNKNOWN_ASSET");
        used.add(key);
      }
    }
  }
  if (used.size !== m.assets.length) throw Error("UNUSED_ASSETS");
}
export async function safeFile(relative: string, root = expansionRoot) {
  const base = await realpath(root),
    candidate = await realpath(resolve(root, relative));
  if (!candidate.startsWith(base + sep)) throw Error("UNSAFE_LOCAL_PATH");
  return candidate;
}
export async function loadExpansion(root = expansionRoot): Promise<Plan> {
  const bytes = await readFile(resolve(root, "manifest.json"));
  if (digest(bytes) !== approvedHash)
    throw Error("MANIFEST_CHANGED_REVIEW_REQUIRED");
  const bundle = schema.parse(JSON.parse(bytes.toString()));
  validateManifest(bundle);
  const previous = JSON.parse(
    await readFile(resolve(root, "../sample-library-v1/manifest.json"), "utf8"),
  ) as {
    stories: Array<{
      sourceId?: string;
      title: string;
      originalTitle?: string;
    }>;
  };
  for (const s of bundle.stories)
    if (
      previous.stories.some(
        (old) =>
          old.sourceId === s.sourceId ||
          [old.title, old.originalTitle]
            .filter((x): x is string => !!x)
            .some((name) =>
              [s.title, s.originalTitle].some(
                (n) => normalizeName(n) === normalizeName(name),
              ),
            ),
      )
    )
      throw Error("DUPLICATE_PREVIOUS_CATALOG");
  const contents = new Map<string, string>();
  for (const f of [
    ...bundle.fileIndex,
    ...bundle.assets,
    ...bundle.stories.flatMap((s) =>
      s.chapters.flatMap((c) => (c.content ? [c.content] : [])),
    ),
  ]) {
    const b = await readFile(await safeFile(f.path, root));
    if (digest(b) !== f.sha256 || b.length !== f.bytes)
      throw Error("INPUT_HASH_MISMATCH");
  }
  for (const a of bundle.assets) {
    if (a.bytes > 10 * 1024 * 1024) throw Error("IMAGE_TOO_LARGE");
    await validateImage({ path: await safeFile(a.path, root), order: 0 });
  }
  for (const s of bundle.stories)
    for (const c of s.chapters)
      if (c.content) {
        const text = await readFile(
          await safeFile(c.content.path, root),
          "utf8",
        );
        novelContentSchema.parse(text);
        if (!text.trim()) throw Error("EMPTY_CONTENT");
        contents.set(chapterId(s, c), text);
      }
  // Existing reviewed system contract must still match; no migrations are run.
  const system = JSON.parse(
    await readFile(resolve(root, "system-review.json"), "utf8"),
  ) as { reviewedFiles: Array<{ path: string; sha256: string }> };
  for (const f of system.reviewedFiles)
    if (
      digest(await readFile(resolve(__dirname, "../../", f.path))) !== f.sha256
    )
      throw Error("SYSTEM_CHANGED_REVIEW_REQUIRED");
  return { bundle, hash: digest(bytes), contents };
}
export function selectImport(plan: Plan, db: Inventory, ledger?: Ledger) {
  if (db.admins.length !== 1) throw Error("EXACTLY_ONE_ACTIVE_ADMIN_REQUIRED");
  if (
    ledger &&
    (ledger.manifestSha256 !== plan.hash || ledger.phase !== "committed")
  )
    throw Error("PRIOR_OUTCOME_REQUIRES_MANUAL_REVIEW");
  const skip = new Set<string>();
  for (const s of plan.bundle.stories) {
    const id = storyId(s),
      own = db.stories.find((x) => x.id === id);
    if (own) {
      if (!ledger?.storyIds.includes(id)) throw Error("UNOWNED_ID_COLLISION");
      for (const c of s.chapters) {
        if (
          !db.chapters.some((x) => x.id === chapterId(s, c) && x.storyId === id)
        )
          throw Error("PARTIAL_IMPORT_REQUIRES_MANUAL_REVIEW");
        for (const key of c.pages)
          if (
            !db.pages.some(
              (x) =>
                x.id === pageId(s, c, key) && x.chapterId === chapterId(s, c),
            )
          )
            throw Error("PARTIAL_IMPORT_REQUIRES_MANUAL_REVIEW");
      }
      skip.add(s.sourceId);
      continue; // Never overwrite an ADMIN edit, including title/slug.
    }
    if (ledger?.storyIds.includes(id))
      throw Error("PARTIAL_IMPORT_REQUIRES_MANUAL_REVIEW");
    if (
      db.stories.some(
        (x) =>
          x.slug === s.slug ||
          [s.title, s.originalTitle].some(
            (name) => normalizeName(x.title) === normalizeName(name),
          ) ||
          x.description.includes(s.sourceId),
      )
    )
      throw Error("EXISTING_STORY_COLLISION");
    for (const c of s.chapters)
      if (
        db.chapters.some((x) => x.id === chapterId(s, c)) ||
        c.pages.some((k) => db.pages.some((x) => x.id === pageId(s, c, k)))
      )
        throw Error("UNOWNED_ID_COLLISION");
  }
  const stories = plan.bundle.stories.filter((s) => !skip.has(s.sourceId));
  const usedGenres = new Set(stories.flatMap((s) => s.genres));
  const genres = plan.bundle.genres.filter((g) => usedGenres.has(g.name));
  for (const g of genres)
    if (
      db.genres.some(
        (x) =>
          (x.slug === g.slug ||
            x.name === g.name ||
            x.id === expansionId("genre:" + g.slug)) &&
          (x.slug !== g.slug || x.name !== g.name),
      )
    )
      throw Error("GENRE_COLLISION");
  const createGenres = genres.filter(
    (g) => !db.genres.some((x) => x.slug === g.slug && x.name === g.name),
  );
  const usedAssets = new Set(
    stories.flatMap((s) => [s.cover, ...s.chapters.flatMap((c) => c.pages)]),
  );
  const assets = plan.bundle.assets.filter((a) => usedAssets.has(a.key));
  const counts = {
    stories: stories.length,
    chapters: stories.reduce((n, s) => n + s.chapters.length, 0),
    chapterPages: stories.reduce(
      (n, s) => n + s.chapters.reduce((p, c) => p + c.pages.length, 0),
      0,
    ),
    genres: createGenres.length,
    storyGenres: stories.reduce((n, s) => n + s.genres.length, 0),
    images: assets.length,
    imageBytes: assets.reduce((n, a) => n + a.bytes, 0),
    skippedStories: skip.size,
  };
  return {
    adminId: db.admins[0].id,
    stories,
    createGenres,
    assets,
    counts,
    totalNewRows:
      counts.stories +
      counts.chapters +
      counts.chapterPages +
      counts.genres +
      counts.storyGenres,
  };
}
export type Receipt = {
  status: "pending" | "complete";
  sha256: string;
  secureUrl?: string;
  publicId?: string;
};
export function checkReceipt(receipt: Receipt, hash: string) {
  if (
    receipt.status !== "complete" ||
    receipt.sha256 !== hash ||
    !receipt.secureUrl ||
    receipt.publicId !== `${folder}/${hash}`
  )
    throw Error("UPLOAD_OUTCOME_REQUIRES_MANUAL_REVIEW");
  const url = new URL(receipt.secureUrl);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "res.cloudinary.com" ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw Error("UNTRUSTED_RECEIPT");
  pageInputSchema.parse({
    pageNumber: 1,
    imageUrl: receipt.secureUrl,
    storagePublicId: receipt.publicId,
  });
  return { secureUrl: receipt.secureUrl, publicId: receipt.publicId };
}
export function parseCommand(args: string[], hash = approvedHash) {
  if (!args.length || (args.length === 1 && args[0] === "--dry-run"))
    return { apply: false, publish: false };
  if (
    args.length !== 7 ||
    args[0] !== "--apply" ||
    args[1] !== "--confirm-primary" ||
    args[2] !== "webnovel_db" ||
    args[3] !== "--plan-hash" ||
    args[4] !== hash ||
    args[5] !== "--publish-status" ||
    !["DRAFT", "PUBLISHED"].includes(args[6])
  )
    throw Error("EXPLICIT_APPROVAL_REQUIRED");
  return { apply: true, publish: args[6] === "PUBLISHED" };
}
