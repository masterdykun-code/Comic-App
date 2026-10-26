// Post-import audit: PostgreSQL READ ONLY, public GET/HEAD only. No uploads.
import { readFile, writeFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { assertPrimary } from "./sample-library-core";
import {
  loadExpansion,
  expansionRoot,
  storyId,
  chapterId,
  pageId,
  expansionId,
  digest,
  checkReceipt,
  type Receipt,
  type Ledger,
} from "./library-expansion-core";
import {
  readEnvironment,
  readOnlyClient,
  readInventory,
  type BackupProof,
} from "./library-expansion-db";
const ensure = (condition: unknown, code: string) => {
  if (!condition) throw Error(code);
};
type StoryRow = {
  id: string;
  slug: string;
  title: string;
  type: string;
  author_name: string;
  description: string;
  cover_url: string;
  publish_status: string;
};
type ChapterRow = {
  id: string;
  story_id: string;
  chapter_number: number;
  title: string;
  content: string | null;
  publish_status: string;
};
type PageRow = {
  id: string;
  chapter_id: string;
  page_number: number;
  image_url: string;
  storage_public_id: string;
};
type Api = { success: boolean; data: unknown; pagination?: { total: number } };
export async function verifyImportedLibrary() {
  const plan = await loadExpansion();
  const before = JSON.parse(
    await readFile(
      resolve(expansionRoot, "dry-run-before-import.json"),
      "utf8",
    ),
  ) as {
    backup: { proofPath: string };
    manifestSha256: string;
    totalNewRows: number;
  };
  ensure(
    before.manifestSha256 === plan.hash && before.totalNewRows === 685,
    "APPROVED_PREFLIGHT_MISMATCH",
  );
  const backup = JSON.parse(
    await readFile(before.backup.proofPath, "utf8"),
  ) as BackupProof;
  const ledger = JSON.parse(
    await readFile(resolve(expansionRoot, ".import-state/ledger.json"), "utf8"),
  ) as Ledger;
  ensure(
    ledger.phase === "committed" && ledger.manifestSha256 === plan.hash,
    "COMMITTED_LEDGER_REQUIRED",
  );
  const env = await readEnvironment(),
    db = readOnlyClient(env.DATABASE_URL);
  const ids = plan.bundle.stories.map(storyId);
  const expectedChapters = plan.bundle.stories.flatMap((s) =>
    s.chapters.map((c) => chapterId(s, c)),
  );
  const expectedPages = plan.bundle.stories.flatMap((s) =>
    s.chapters.flatMap((c) => c.pages.map((k) => pageId(s, c, k))),
  );
  const newGenreIds = plan.bundle.genres.map((g) =>
    expansionId("genre:" + g.slug),
  );
  const report: Record<string, unknown> = {
    verifiedAt: new Date().toISOString(),
    database: "webnovel_db/public",
    manifestSha256: plan.hash,
    beforeBackup: before.backup,
    imageUploads: [],
    apiChecks: {},
  };
  try {
    await db.connect();
    await assertPrimary(db);
    await db.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    const inventory = await readInventory(db);
    const changes: Record<string, number> = {
      stories: 15,
      chapters: 482,
      chapter_pages: 157,
      genres: 8,
      story_genres: 23,
    };
    const existingRows: Record<string, { count: number; unchanged: boolean }> =
      {};
    for (const [table, baseline] of Object.entries(backup.fingerprints)) {
      ensure(
        inventory.fingerprints[table]?.count ===
          baseline.count + (changes[table] || 0),
        "UNEXPECTED_TABLE_COUNT",
      );
      const omit =
        table === "stories" || table === "story_genres"
          ? ids
          : table === "chapters"
            ? expectedChapters
            : table === "chapter_pages"
              ? expectedPages
              : table === "genres"
                ? newGenreIds
                : [];
      const column = table === "story_genres" ? "story_id" : "id";
      const quoted = '"' + table.replaceAll('"', '""') + '"';
      const rows = (
        await db.query(
          "SELECT md5(row_to_json(r)::text) fingerprint FROM public." +
            quoted +
            " r" +
            (omit.length ? ` WHERE NOT (${column} = ANY($1::uuid[]))` : "") +
            " ORDER BY 1",
          omit.length ? [omit] : [],
        )
      ).rows as Array<{ fingerprint: string }>;
      const unchanged =
        rows.length === baseline.count &&
        digest(rows.map((r) => r.fingerprint).join("\n")) === baseline.sha256;
      ensure(unchanged, "EXISTING_ROWS_CHANGED");
      existingRows[table] = { count: rows.length, unchanged };
    }
    const stories = (
      await db.query(
        "SELECT id,slug,title,type,author_name,description,cover_url,publish_status FROM public.stories WHERE id=ANY($1::uuid[])",
        [ids],
      )
    ).rows as StoryRow[];
    const chapters = (
      await db.query(
        "SELECT id,story_id,chapter_number,title,content,publish_status FROM public.chapters WHERE story_id=ANY($1::uuid[])",
        [ids],
      )
    ).rows as ChapterRow[];
    const pages = (
      await db.query(
        "SELECT p.id,p.chapter_id,p.page_number,p.image_url,p.storage_public_id FROM public.chapter_pages p JOIN public.chapters c ON c.id=p.chapter_id WHERE c.story_id=ANY($1::uuid[])",
        [ids],
      )
    ).rows as PageRow[];
    const links = (
      await db.query(
        "SELECT story_id,genre_id FROM public.story_genres WHERE story_id=ANY($1::uuid[])",
        [ids],
      )
    ).rows as Array<{ story_id: string; genre_id: string }>;
    ensure(
      stories.length === 15 &&
        chapters.length === 482 &&
        pages.length === 157 &&
        links.length === 23,
      "IMPORTED_COUNT_MISMATCH",
    );
    const remotes = new Map<string, { secureUrl: string; publicId: string }>();
    for (const asset of plan.bundle.assets) {
      const receipt = JSON.parse(
        await readFile(
          resolve(expansionRoot, ".import-state", asset.sha256 + ".json"),
          "utf8",
        ),
      ) as Receipt;
      remotes.set(asset.key, checkReceipt(receipt, asset.sha256));
    }
    for (const s of plan.bundle.stories) {
      const stored = stories.find((r) => r.id === storyId(s));
      ensure(
        stored &&
          stored.slug === s.slug &&
          stored.title === s.title &&
          stored.author_name === s.authorName &&
          stored.description === s.description &&
          stored.type === s.type &&
          stored.cover_url === remotes.get(s.cover)?.secureUrl &&
          stored.publish_status === "PUBLISHED",
        "STORY_METADATA_MISMATCH",
      );
      for (const g of s.genres) {
        const definition = plan.bundle.genres.find((x) => x.name === g)!;
        ensure(
          links.some(
            (r) =>
              r.story_id === storyId(s) &&
              r.genre_id === expansionId("genre:" + definition.slug),
          ),
          "GENRE_LINK_MISMATCH",
        );
      }
      for (const c of s.chapters) {
        const row = chapters.find((r) => r.id === chapterId(s, c));
        ensure(
          row &&
            row.story_id === storyId(s) &&
            row.chapter_number === c.number &&
            row.title === c.title &&
            row.publish_status === "PUBLISHED",
          "CHAPTER_METADATA_MISMATCH",
        );
        ensure(
          c.content
            ? row?.content === plan.contents.get(chapterId(s, c))
            : row?.content === null,
          "CHAPTER_TEXT_MISMATCH",
        );
        for (const [i, key] of c.pages.entries()) {
          const row = pages.find((r) => r.id === pageId(s, c, key)),
            remote = remotes.get(key);
          ensure(
            row &&
              row.chapter_id === chapterId(s, c) &&
              row.page_number === i + 1 &&
              row.image_url === remote?.secureUrl &&
              row.storage_public_id === remote?.publicId,
            "PAGE_ORDER_OR_RECEIPT_MISMATCH",
          );
        }
      }
    }
    await db.query("COMMIT");
    report.actualCreated = {
      stories: stories.length,
      novels: stories.filter((s) => s.type === "NOVEL").length,
      comics: stories.filter((s) => s.type === "COMIC").length,
      chapters: chapters.length,
      chapterPages: pages.length,
      genres: 8,
      storyGenres: links.length,
      totalRows: 685,
    };
    report.tableTotals = Object.fromEntries(
      Object.entries(inventory.fingerprints).map(([name, value]) => [
        name,
        value.count,
      ]),
    );
    const receiptFiles = (
      await readdir(resolve(expansionRoot, ".import-state"))
    ).filter((name) => /^[a-f0-9]{64}\.json$/.test(name));
    ensure(
      receiptFiles.length === 167 &&
        plan.bundle.assets.every((a) =>
          receiptFiles.includes(a.sha256 + ".json"),
        ),
      "UNEXPECTED_UPLOAD_RECEIPTS",
    );
    report.completedUploadReceipts = receiptFiles.length;
    report.publication = {
      publishedStories: stories.filter((s) => s.publish_status === "PUBLISHED")
        .length,
      publishedChapters: chapters.filter(
        (s) => s.publish_status === "PUBLISHED",
      ).length,
    };
    report.existingRows = existingRows;
    report.allExistingRowsUnchanged = true;
    report.comicPageOrderVerified = 157;
    report.novelTextsVerified = 325;
    const imageResults: Array<{
      key: string;
      secureUrl: string;
      publicId: string;
      httpStatus: number;
      contentType: string;
    }> = [];
    report.imageUploads = imageResults;
    for (const a of plan.bundle.assets) {
      const remote = remotes.get(a.key)!;
      const response = await fetch(remote.secureUrl, {
        method: "HEAD",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      const contentType = response.headers.get("content-type") || "";
      ensure(
        response.status === 200 &&
          /^image\/(?:png|jpeg|webp)(?:;|$)/i.test(contentType),
        "CLOUDINARY_IMAGE_NOT_ACCESSIBLE",
      );
      imageResults.push({
        key: a.key,
        ...remote,
        httpStatus: response.status,
        contentType,
      });
      if (imageResults.length % 25 === 0)
        console.log(
          `Read-only HTTPS verification: ${imageResults.length}/167 images`,
        );
    }
    const port = env.PORT || "4000";
    ensure(
      /^\d{1,5}$/.test(port) && Number(port) === 4000,
      "PRIMARY_BACKEND_PORT_MISMATCH",
    );
    const base = `http://127.0.0.1:${port}/api`;
    const get = async (path: string) => {
      const response = await fetch(base + path, {
        method: "GET",
        redirect: "error",
        signal: AbortSignal.timeout(15000),
      });
      ensure(response.status === 200, "PRIMARY_API_HTTP_FAILED");
      const body = (await response.json()) as Api;
      ensure(body.success === true, "PRIMARY_API_RESPONSE_FAILED");
      return body;
    };
    await get("/health");
    const list = await get("/stories?limit=100"),
      data = list.data as Array<{ id: string }>;
    ensure(
      Array.isArray(data) && ids.every((id) => data.some((s) => s.id === id)),
      "STORIES_PUBLIC_LIST_MISMATCH",
    );
    let storyDetails = 0,
      chapterLists = 0,
      chapterReads = 0;
    for (const s of plan.bundle.stories) {
      const detail = (await get("/stories/" + storyId(s))).data as {
        id: string;
        description: string;
        coverUrl: string;
      };
      ensure(
        detail.id === storyId(s) &&
          detail.description === s.description &&
          detail.coverUrl === remotes.get(s.cover)?.secureUrl,
        "PUBLIC_STORY_DETAIL_MISMATCH",
      );
      storyDetails++;
      const listing = await get(`/stories/${storyId(s)}/chapters?limit=100`);
      const records = listing.data as Array<{
        id: string;
        chapterNumber: number;
      }>;
      ensure(
        records.length === s.chapters.length &&
          records.every(
            (r, i) =>
              r.id === chapterId(s, s.chapters[i]) && r.chapterNumber === i + 1,
          ),
        "PUBLIC_CHAPTER_LIST_MISMATCH",
      );
      chapterLists++;
      for (const c of s.chapters) {
        const chapter = (await get("/chapters/" + chapterId(s, c))).data as {
          id: string;
          type: string;
          content?: string;
          pages?: Array<{ pageNumber: number; imageUrl: string }>;
        };
        ensure(
          chapter.id === chapterId(s, c) && chapter.type === s.type,
          "PUBLIC_CHAPTER_ID_MISMATCH",
        );
        if (s.type === "NOVEL")
          ensure(
            chapter.content === plan.contents.get(chapterId(s, c)),
            "PUBLIC_NOVEL_TEXT_MISMATCH",
          );
        else
          ensure(
            chapter.pages?.length === c.pages.length &&
              chapter.pages.every(
                (p, i) =>
                  p.pageNumber === i + 1 &&
                  p.imageUrl === remotes.get(c.pages[i])?.secureUrl,
              ),
            "PUBLIC_COMIC_PAGE_ORDER_MISMATCH",
          );
        chapterReads++;
      }
    }
    report.apiChecks = {
      baseURL: base,
      healthHTTP: 200,
      storiesListHTTP: 200,
      publicStoriesTotal: list.pagination?.total,
      newStoriesListed: 15,
      storyDetailsHTTP200: storyDetails,
      chapterListsHTTP200: chapterLists,
      chapterReadsHTTP200: chapterReads,
    };
    report.status = "VERIFIED_SUCCESS";
    await writeFile(
      resolve(expansionRoot, "import-verification.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    console.log(
      JSON.stringify({
        status: report.status,
        actualCreated: report.actualCreated,
        publication: report.publication,
        imagesHTTPS200: imageResults.length,
        apiChecks: report.apiChecks,
        allExistingRowsUnchanged: true,
      }),
    );
  } catch (error) {
    report.status = "VERIFICATION_STOPPED";
    report.safeCode =
      error instanceof Error && /^[A-Z_]{3,90}$/.test(error.message)
        ? error.message
        : "NETWORK_OR_LOCAL_IO_FAILED";
    await writeFile(
      resolve(expansionRoot, "import-verification.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    throw Error(String(report.safeCode));
  } finally {
    await db.end();
  }
}
if (require.main === module)
  verifyImportedLibrary().catch(() => {
    console.error(
      "Post-import read-only verification stopped. See import-verification.json; no upload retry, cleanup or database write was attempted.",
    );
    process.exitCode = 1;
  });
