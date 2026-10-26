import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { z } from "zod";
import { validateImage } from "../middlewares/upload.validation";
import { publicationSchema } from "../middlewares/story.validation";
import {
  novelContentSchema,
  pageInputSchema,
} from "../middlewares/chapter.validation";
export const bundleRoot = resolve(__dirname, "../../catalog/sample-library-v1");
// __dirname resolves differently in compiled dist/scripts; both stay under backend.
export function digest(bytes: string | Buffer) {
  return createHash("sha256").update(bytes).digest("hex");
}
export function assertApplyApproval(args: string[], planHash: string) {
  if (
    args.length !== 5 ||
    args[0] !== "--apply" ||
    args[1] !== "--confirm-primary" ||
    args[2] !== "webnovel_db" ||
    args[3] !== "--plan-hash" ||
    args[4] !== planHash
  )
    throw new Error("EXPLICIT_PLAN_APPROVAL_REQUIRED");
}
const fileSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
});
const assetSchema = fileSchema
  .extend({
    key: z.string().regex(/^[a-z0-9-]+$/),
    bytes: z.number().int().positive(),
    license: z.string().min(1),
    author: z.string().min(1),
    sourceUrl: z.string().min(1),
  })
  .passthrough();
const chapterSchema = z
  .object({
    number: z.number().int().positive(),
    title: z.string().min(1).max(200),
    content: fileSchema.nullable(),
    pages: z.array(z.string()),
  })
  .passthrough();
const storySchema = z
  .object({
    key: z.string().regex(/^[a-z0-9-]+$/),
    slug: z.string().regex(/^sample-v1-[a-z0-9-]+$/),
    type: z.enum(["NOVEL", "COMIC"]),
    title: z.string().min(1).max(200),
    authorName: z.string().min(1).max(100),
    description: z.string().min(1).max(10000),
    genre: z.enum(["sample-v1-literature", "sample-v1-comics"]),
    cover: z.string(),
    chapters: z.array(chapterSchema).length(3),
  })
  .passthrough();
const bundleSchema = z
  .object({
    version: z.literal("sample-library-v1"),
    assets: z.array(assetSchema),
    stories: z.array(storySchema).length(10),
  })
  .passthrough();
export type Bundle = z.infer<typeof bundleSchema>;
export function localFile(relative: string, root = bundleRoot) {
  const file = resolve(root, relative);
  if (!file.startsWith(resolve(root) + sep))
    throw new Error("UNSAFE_LOCAL_PATH");
  return file;
}
export function validatePrimaryUrl(raw: string) {
  const u = new URL(raw);
  if (
    !["postgres:", "postgresql:"].includes(u.protocol) ||
    decodeURIComponent(u.pathname) !== "/webnovel_db" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(u.hostname) ||
    [...u.searchParams].some(([k, v]) => k !== "schema" || v !== "public")
  )
    throw new Error("PRIMARY_DATABASE_REQUIRED");
}
export async function assertPrimary(db: {
  query: (
    sql: string,
  ) => Promise<{ rows: Array<{ name?: string; schema?: string }> }>;
}) {
  const r = await db.query(
    "SELECT current_database() AS name, current_schema() AS schema",
  );
  if (r.rows[0]?.name !== "webnovel_db" || r.rows[0]?.schema !== "public")
    throw new Error("PRIMARY_DATABASE_REQUIRED");
}
export const genres = [
  { slug: "sample-v1-literature", name: "Thư viện mẫu · Văn học" },
  { slug: "sample-v1-comics", name: "Thư viện mẫu · Truyện tranh" },
];
export function stableId(key: string) {
  const h = digest("webnovel-approved-library-v1:" + key);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export async function loadBundle(root = bundleRoot) {
  const bytes = await readFile(resolve(root, "manifest.json"));
  const bundle = bundleSchema.parse(JSON.parse(bytes.toString()));
  if (
    new Set(bundle.stories.map((s) => s.slug)).size !== 10 ||
    bundle.stories.filter((s) => s.type === "NOVEL").length !== 5 ||
    bundle.stories.filter((s) => s.type === "COMIC").length !== 5 ||
    new Set(bundle.assets.map((a) => a.key)).size !== bundle.assets.length
  )
    throw new Error("INVALID_LIBRARY_COUNTS");
  const contents = new Map<string, string>();
  for (const a of bundle.assets) {
    const b = await readFile(localFile(a.path, root));
    if (
      digest(b) !== a.sha256 ||
      b.length !== a.bytes ||
      b.length > 10 * 1024 * 1024
    )
      throw new Error("ASSET_HASH_OR_SIZE_MISMATCH");
    await validateImage({ path: localFile(a.path, root), order: 0 });
  }
  for (const s of bundle.stories) {
    const cover = bundle.assets.find((a) => a.key === s.cover);
    if (!cover || cover.bytes > 5 * 1024 * 1024)
      throw new Error("COVER_INVALID");
    publicationSchema.parse({
      title: s.title,
      type: s.type,
      authorName: s.authorName,
      description: s.description,
      coverUrl: "https://example.invalid/reviewed-cover.png",
      genreIds: [stableId("genre:" + s.genre)],
    });
    if (new Set(s.chapters.map((c) => c.number)).size !== 3)
      throw new Error("DUPLICATE_CHAPTER");
    for (const c of s.chapters) {
      if (s.type === "NOVEL") {
        if (!c.content || c.pages.length) throw new Error("NOVEL_INVALID");
        const b = await readFile(localFile(c.content.path, root));
        if (digest(b) !== c.content.sha256)
          throw new Error("TEXT_HASH_MISMATCH");
        const text = b.toString("utf8");
        novelContentSchema.parse(text);
        if (!text.trim()) throw new Error("NOVEL_EMPTY");
        contents.set(s.key + ":" + c.number, text);
      } else if (
        c.content ||
        c.pages.length < 2 ||
        c.pages.length > 200 ||
        new Set(c.pages).size !== c.pages.length ||
        c.pages.some((key) => !bundle.assets.some((a) => a.key === key))
      )
        throw new Error("COMIC_INVALID");
    }
  }
  return { bundle, planHash: digest(bytes), contents };
}
export function validateAssetReceipt(
  receipt: {
    status: string;
    sha256: string;
    secureUrl?: string;
    publicId?: string;
  },
  sha256: string,
) {
  if (
    receipt.status !== "complete" ||
    receipt.sha256 !== sha256 ||
    !receipt.secureUrl ||
    !receipt.publicId
  )
    throw new Error("UPLOAD_OUTCOME_REQUIRES_MANUAL_REVIEW");
  const u = new URL(receipt.secureUrl);
  if (
    u.protocol !== "https:" ||
    u.hostname !== "res.cloudinary.com" ||
    receipt.publicId !== `webnovel/sample-library/v1/${sha256}`
  )
    throw new Error("UNTRUSTED_ASSET_RECEIPT");
  pageInputSchema.parse({
    pageNumber: 1,
    imageUrl: receipt.secureUrl,
    storagePublicId: receipt.publicId,
  });
}
