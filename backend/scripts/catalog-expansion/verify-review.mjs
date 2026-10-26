// Local file QA only: deny all HTTP(S), never contact application APIs.
import fs from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { chromium } from "../../../admin-web/node_modules/playwright/index.mjs";
const root = fileURLToPath(
  new URL("../../catalog/library-expansion-v2/", import.meta.url),
);
const bytes = await fs.readFile(path.join(root, "manifest.json"));
const m = JSON.parse(bytes);
const novels = m.stories.filter((s) => s.type === "NOVEL");
assert.equal(novels.length, 10);
assert.ok(
  novels.every(
    (s) =>
      s.spineAudit.allSpineItemsAccountedFor &&
      s.spineAudit.allBodyCharactersPreservedIgnoringWhitespace,
  ),
);
const fidelity = {
  manifestSha256: createHash("sha256").update(bytes).digest("hex"),
  readingUnits: novels.reduce((n, s) => n + s.chapters.length, 0),
  canonicalBodyCharactersMatch: true,
  comparison:
    "Source XHTML body versus normalized plain text, ignoring whitespace only; independently checked by finalize.mjs for every reading unit.",
  mismatches: [],
  editions: novels.map((s) => ({ key: s.key, ...s.spineAudit })),
};
await fs.writeFile(
  path.join(root, "text-fidelity-audit.json"),
  JSON.stringify(fidelity, null, 2) + "\n",
);
const browser = await chromium.launch({ headless: true });
const externalAttempts = [];
try {
  const page = await browser.newPage({
    viewport: { width: 1300, height: 1000 },
  });
  await page.route(/^https?:/i, (route) => {
    externalAttempts.push(route.request().url());
    return route.abort();
  });
  await page.goto(pathToFileURL(path.join(root, "review.html")).href);
  // Gallery defers images in collapsed reading units; force local decode for QA.
  await page.evaluate(() => {
    for (const image of document.images) image.loading = "eager";
  });
  await page.waitForFunction(() =>
    [...document.images].every((i) => i.complete),
  );
  const result = await page.evaluate(() => ({
    cards: document.querySelectorAll(".card").length,
    workSections: document.querySelectorAll("section[id]").length,
    readingUnits: document.querySelectorAll("details").length,
    brokenImages: [...document.images]
      .filter((i) => !i.naturalWidth)
      .map((i) => i.getAttribute("src")),
    horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
    localReferences: [...document.querySelectorAll("a[href],img[src]")]
      .map((e) => e.getAttribute("href") || e.getAttribute("src"))
      .filter((s) => !/^(?:https?:|#)/.test(s)),
  }));
  assert.equal(result.cards, 15);
  assert.equal(result.workSections, 15);
  assert.equal(result.readingUnits, 482);
  assert.deepEqual(result.brokenImages, []);
  assert.equal(result.horizontalOverflow, false);
  for (const rel of result.localReferences) {
    const target = path.resolve(root, rel.split("#")[0]);
    assert.ok(target.startsWith(root));
    await fs.access(target);
  }
  await page.screenshot({ path: path.join(root, "review-preview.png") });
  const comic = page
    .locator("section[id]")
    .filter({ has: page.locator("img.page") })
    .first();
  await comic
    .locator("details")
    .first()
    .evaluate((e) => {
      e.open = true;
    });
  await comic.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(root, "review-comic-preview.png") });
  assert.deepEqual(externalAttempts, []);
  delete result.localReferences;
  await fs.writeFile(
    path.join(root, "review-qa.json"),
    JSON.stringify(
      {
        ...result,
        localFilesChecked: true,
        externalRequests: 0,
        manifestSha256: fidelity.manifestSha256,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Local gallery QA passed:", JSON.stringify(result));
} finally {
  await browser.close();
}
