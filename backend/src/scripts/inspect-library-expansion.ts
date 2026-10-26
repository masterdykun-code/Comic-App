// Read-only inventory and staging checks. This command deliberately has no apply mode.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { parse } from "dotenv";
import { Client } from "pg";
import { validatePrimaryUrl, assertPrimary } from "./sample-library-core";
import { validateImage } from "../middlewares/upload.validation";
import { novelContentSchema } from "../middlewares/chapter.validation";
import { publicationSchema } from "../middlewares/story.validation";
const root = resolve(__dirname, "../../catalog/library-expansion-v2");
const sha = (b: string | Buffer) =>
  createHash("sha256").update(b).digest("hex");
const normalize = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
async function main() {
  const args = process.argv.slice(2);
  if (
    args.length > 1 ||
    (args[0] && !["--snapshot", "--verify"].includes(args[0]))
  )
    throw Error("READ_ONLY_ARGUMENT_REQUIRED");
  const env = parse(await readFile(resolve(__dirname, "../../.env"), "utf8"));
  validatePrimaryUrl(env.DATABASE_URL);
  const db = new Client({
    connectionString: env.DATABASE_URL,
    options: "-c default_transaction_read_only=on",
    connectionTimeoutMillis: 5000,
  });
  try {
    await db.connect();
    await assertPrimary(db);
    await db.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const stories = (
      await db.query(
        'SELECT id,slug,title,author_name AS "authorName",type,description FROM public.stories ORDER BY slug',
      )
    ).rows as Array<{
      id: string;
      slug: string;
      title: string;
      authorName: string;
      type: string;
      description: string;
    }>;
    const genres = (
      await db.query("SELECT id,name,slug FROM public.genres ORDER BY slug")
    ).rows as Array<{ id: string; name: string; slug: string }>;
    const migrations = (
      await db.query(
        "SELECT migration_name,checksum,finished_at FROM public._prisma_migrations ORDER BY migration_name",
      )
    ).rows;
    const tables = (
      await db.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename",
      )
    ).rows as Array<{ tablename: string }>;
    const fingerprints: Record<string, { count: number; sha256: string }> = {};
    for (const { tablename } of tables) {
      const q = '"' + tablename.replaceAll('"', '""') + '"';
      // Row contents stay inside PostgreSQL; no password hashes/tokens are returned.
      const rows = (
        await db.query(
          "SELECT md5(row_to_json(r)::text) fingerprint FROM public." +
            q +
            " r ORDER BY 1",
        )
      ).rows as Array<{ fingerprint: string }>;
      fingerprints[tablename] = {
        count: rows.length,
        sha256: sha(rows.map((r) => r.fingerprint).join("\n")),
      };
    }
    await db.query("COMMIT");
    const inventory = {
      database: "webnovel_db/public",
      mode: "READ_ONLY",
      stories,
      genres,
      migrations,
      fingerprints,
    };
    if (args[0] === "--snapshot") {
      await writeFile(
        resolve(root, "system-inventory.json"),
        JSON.stringify(inventory, null, 2) + "\n",
        { flag: "wx" },
      );
      console.log(
        JSON.stringify({
          mode: "READ_ONLY_SNAPSHOT",
          database: inventory.database,
          stories: stories.length,
          genres: genres.length,
          migrations: migrations.length,
        }),
      );
      return;
    }
    const before = JSON.parse(
      await readFile(resolve(root, "system-inventory.json"), "utf8"),
    ) as typeof inventory;
    const unchanged =
      JSON.stringify(before.fingerprints) === JSON.stringify(fingerprints);
    if (!unchanged) throw Error("DATABASE_CHANGED_SINCE_READ_ONLY_SNAPSHOT");
    const bytes = await readFile(resolve(root, "manifest.json"));
    type Work = {
      key: string;
      sourceId: string;
      slug: string;
      title: string;
      originalTitle: string;
      description: string;
      authorName: string;
      genres: string[];
      cover: string;
      type: string;
      chapters: Array<{
        sourceId: string;
        number: number;
        content: { path: string; sha256: string; bytes: number } | null;
        pages: string[];
      }>;
    };
    type Asset = { key: string; path: string; sha256: string; bytes: number };
    const m = JSON.parse(bytes.toString()) as {
      stories: Work[];
      assets: Asset[];
      genres: Array<{ name: string; slug: string }>;
      fileIndex: Array<{ path: string; sha256: string; bytes: number }>;
      excludedAssets?: Array<{ key: string }>;
    };
    if (
      m.stories.length !== 15 ||
      m.stories.filter((s) => s.type === "NOVEL").length !== 10 ||
      m.stories.filter((s) => s.type === "COMIC").length !== 5 ||
      new Set(m.stories.map((s) => s.sourceId)).size !== 15
    )
      throw Error("INVALID_COUNTS");
    const old = JSON.parse(
      await readFile(
        resolve(root, "../sample-library-v1/manifest.json"),
        "utf8",
      ),
    ) as {
      stories: Array<{
        sourceId?: string;
        title: string;
        originalTitle?: string;
        slug: string;
      }>;
    };
    const names = new Set([
      ...stories.map((s) => normalize(s.title)),
      ...old.stories.flatMap((s) => [
        normalize(s.title),
        normalize(s.originalTitle ?? s.title),
      ]),
    ]);
    for (const s of m.stories) {
      const cover = m.assets.find((a) => a.key === s.cover);
      if (!cover || cover.bytes > 5 * 1024 * 1024) throw Error("INVALID_COVER");
      if (
        stories.some((x) => x.slug === s.slug) ||
        names.has(normalize(s.title)) ||
        names.has(normalize(s.originalTitle)) ||
        old.stories.some((x) => x.sourceId && x.sourceId === s.sourceId)
      )
        throw Error("DUPLICATE_WORK");
      if (
        new Set(s.chapters.map((c) => c.number)).size !== s.chapters.length ||
        new Set(s.chapters.map((c) => c.sourceId)).size !== s.chapters.length ||
        s.chapters.some((c, i) => c.number !== i + 1)
      )
        throw Error("INVALID_ORDER");
      publicationSchema.parse({
        title: s.title,
        type: s.type,
        authorName: s.authorName,
        description: s.description,
        coverUrl: "https://example.invalid/reviewed-cover.png",
        genreIds: ["00000000-0000-4000-a000-000000000001"],
      });
    }
    const files = [
      ...m.fileIndex,
      ...m.assets,
      ...m.stories.flatMap((s) =>
        s.chapters.flatMap((c) => (c.content ? [c.content] : [])),
      ),
    ];
    for (const file of files) {
      const p = resolve(root, file.path);
      if (!p.startsWith(root + "\\") && !p.startsWith(root + "/"))
        throw Error("UNSAFE_FILE");
      const b = await readFile(p);
      if (b.length !== file.bytes || sha(b) !== file.sha256)
        throw Error("LOCAL_HASH_MISMATCH");
    }
    for (const a of m.assets)
      await validateImage({ path: resolve(root, a.path), order: 0 });
    if (
      m.stories.some((s) =>
        s.chapters.some((c) =>
          c.pages.some((k) => m.excludedAssets?.some((a) => a.key === k)),
        ),
      )
    )
      throw Error("EXCLUDED_ASSET_REFERENCED");
    const system = JSON.parse(
      await readFile(resolve(root, "system-review.json"), "utf8"),
    ) as { reviewedFiles: Array<{ path: string; sha256: string }> };
    for (const f of system.reviewedFiles)
      if (
        sha(await readFile(resolve(__dirname, "../../", f.path))) !== f.sha256
      )
        throw Error("SYSTEM_SOURCE_CHANGED");
    for (const s of m.stories)
      for (const c of s.chapters) {
        if (s.type === "NOVEL") {
          if (!c.content || c.pages.length) throw Error("NOVEL_INVALID");
          novelContentSchema.parse(
            await readFile(resolve(root, c.content.path), "utf8"),
          );
        } else if (
          c.content ||
          !c.pages.length ||
          c.pages.length > 200 ||
          c.pages.some((key) => !m.assets.some((a) => a.key === key))
        )
          throw Error("COMIC_INVALID");
      }
    const createGenres = m.genres.filter(
      (g) => !genres.some((x) => x.slug === g.slug && x.name === g.name),
    );
    if (
      createGenres.some((g) =>
        genres.some((x) => x.slug === g.slug || x.name === g.name),
      )
    )
      throw Error("GENRE_COLLISION");
    const counts = {
      stories: m.stories.length,
      chapters: m.stories.reduce((n, s) => n + s.chapters.length, 0),
      chapterPages: m.stories.reduce(
        (n, s) => n + s.chapters.reduce((a, c) => a + c.pages.length, 0),
        0,
      ),
      genres: createGenres.length,
      storyGenres: m.stories.reduce((n, s) => n + s.genres.length, 0),
      images: m.assets.length,
      uniqueImageHashes: new Set(m.assets.map((a) => a.sha256)).size,
      imageBytes: m.assets.reduce((n, a) => n + a.bytes, 0),
    };
    const result = {
      status: "READ_ONLY_READY_FOR_HUMAN_REVIEW",
      database: inventory.database,
      manifestSha256: sha(bytes),
      noDuplicates: true,
      existingDatabaseUnchanged: true,
      counts,
      totalNewRows:
        counts.stories +
        counts.chapters +
        counts.chapterPages +
        counts.genres +
        counts.storyGenres,
      cloudinaryConfigured: [
        "CLOUDINARY_CLOUD_NAME",
        "CLOUDINARY_API_KEY",
        "CLOUDINARY_API_SECRET",
      ].every(
        (k) => !!env[k] && !/^(your_|replace_|placeholder)/i.test(env[k]),
      ),
    };
    await writeFile(
      resolve(root, "preflight.json"),
      JSON.stringify(result, null, 2) + "\n",
    );
    console.log(JSON.stringify(result));
  } finally {
    await db.end();
  }
}
main().catch(() => {
  console.error(
    "Read-only expansion check stopped. Inspect target, duplicates, local hashes or inventory drift; sensitive details suppressed.",
  );
  process.exitCode = 1;
});
