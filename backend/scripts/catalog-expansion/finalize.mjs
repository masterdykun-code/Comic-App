// Local-only finalisation: enrich provenance, group same-day scans, hash every input.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { xml, normalized } from "./normalize.mjs";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../catalog/library-expansion-v2",
);
const m = JSON.parse(
  await fs.readFile(path.join(root, "manifest.json"), "utf8"),
);
if (m.version !== "library-expansion-v2" || m.stories.length !== 15)
  throw Error("Incomplete staging");
const exclusions = [
  {
    key: "alphonse-gaston-ag020928b",
    author: "Dirks, Opper, Bunny; assisted by Gregg (as printed on image)",
    reason:
      "Visual review found a multi-artist crossover. Identity and protection term of Gregg are not verified; collection-level Opper attribution is insufficient.",
  },
  {
    key: "alphonse-gaston-ag030208b",
    author: "F. Opper & R. Dirks (as printed on image)",
    reason:
      "St. Valentine's Day with the Katzenjammer Household is a separately credited crossover, outside the selected regular Alphonse and Gaston strips; requires a separate joint-author rights review.",
  },
];
const excludedKeys = new Set(exclusions.map((a) => a.key));
for (const exclusion of exclusions) {
  const crossover =
    m.assets.find((a) => a.key === exclusion.key) ||
    m.excludedAssets?.find((a) => a.key === exclusion.key);
  if (!crossover) throw Error("Missing excluded scan evidence");
  m.excludedAssets = [
    ...(m.excludedAssets || []).filter((a) => a.key !== exclusion.key),
    {
      ...crossover,
      author: exclusion.author,
      license:
        "Unresolved joint-work attribution/term in Vietnam; NOT approved for import",
      reviewStatus: "EXCLUDED_NOT_FOR_UPLOAD",
      reason: exclusion.reason,
    },
  ];
  m.assets = m.assets.filter((a) => a.key !== exclusion.key);
}
const comicAuthorities = {
  explorigator: {
    url: "https://www.loc.gov/item/2007678300/",
    label: "Dart, Harry Grant, 1869-1938",
    death: 1938,
  },
  "hungry-henrietta": {
    url: "https://id.loc.gov/authorities/names/n50011701.json",
    label: "McCay, Winsor, 1867?-1934",
    death: 1934,
  },
  "lulu-leander": {
    url: "https://www.loc.gov/pictures/index/names/h/",
    label: "Howarth, F. M. (Franklin Morris), 1865-1908",
    death: 1908,
  },
  "alphonse-gaston": {
    url: "https://www.loc.gov/item/2012648616/",
    label: "Opper, Frederick Burr, 1857-1937",
    death: 1937,
  },
  "polly-sleepyhead": {
    url: "https://www.loc.gov/item/05036120/",
    label: "Newell, Peter, 1862-1924",
    death: 1924,
  },
};
const authorities = JSON.parse(
  await fs.readFile(path.join(root, "rights/novel-authorities.json"), "utf8"),
);
for (const s of m.stories) {
  if (s.type === "NOVEL") {
    const opf = await fs.readFile(
      path.join(root, "sources", s.key, "content.opf"),
      "utf8",
    );
    const u = opf
      .match(
        /href="(https:\/\/id\.loc\.gov\/authorities\/names\/[^" ]+)" refines="#author"/,
      )?.[1]
      ?.replace(/\.html$/, ".json");
    const authority = authorities.find((a) => a.url === u);
    if (!authority?.label.includes(String(s.authorDeathYear)))
      throw Error("Missing verified author authority");
    s.rights.authority = authority;
    const spine = [...opf.matchAll(/<itemref idref="([^"]+)"/g)].map(
      (x) => x[1],
    );
    if (spine.length !== s.chapters.length + s.excludedEditionPages.length)
      throw Error("Spine coverage mismatch");
    s.spineAudit = {
      sourceItems: spine.length,
      readingUnits: s.chapters.length,
      archivedEditionPages: s.excludedEditionPages.length,
      allSpineItemsAccountedFor: true,
      inlineImages: s.chapters.flatMap((c) => c.inlineImages || []).length,
    };
    for (const c of s.chapters) {
      const doc = xml(await fs.readFile(path.join(root, c.source.path)));
      try {
        const value = normalized(doc);
        if (
          doc.querySelector("body").textContent.replace(/\s/g, "") !==
          value.replace(/\s/g, "")
        )
          throw Error("Source character coverage mismatch: " + c.sourceId);
        await fs.writeFile(path.join(root, c.content.path), value);
        c.content = {
          path: c.content.path,
          bytes: Buffer.byteLength(value),
          sha256: createHash("sha256").update(value).digest("hex"),
        };
      } finally {
        doc.defaultView.close();
      }
    }
    s.spineAudit.allBodyCharactersPreservedIgnoringWhitespace = true;
  } else {
    s.rights.authority = comicAuthorities[s.key];
    if (s.rights.authority.death !== s.authorDeathYear)
      throw Error("Author death mismatch");
    const groups = new Map();
    // Do not create invented new episodes for variants on the same newspaper date.
    for (const c of s.chapters) {
      c.pages = c.pages.filter((k) => !excludedKeys.has(k));
      if (c.sourceImages)
        c.sourceImages = c.sourceImages.filter(
          (url) => !/ag(?:020928b|030208b)\.jpg$/i.test(url),
        );
      if (!c.pages.length) continue;
      const date = c.sourceDate;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        throw Error("Missing publication date");
      const parsed = new Date(date + "T00:00:00Z");
      if (
        !Number.isFinite(parsed.valueOf()) ||
        parsed.toISOString().slice(0, 10) !== date
      )
        throw Error("Invalid source date");
      if (!groups.has(date))
        groups.set(date, {
          number: groups.size + 1,
          title: s.originalTitle + " — " + date,
          sourceDate: date,
          sourceId: s.sourceId + "#date=" + date,
          sourceImages: [],
          content: null,
          pages: [],
        });
      const g = groups.get(date);
      g.sourceImages.push(...(c.sourceImages || [c.sourceId]));
      g.pages.push(...c.pages);
    }
    s.chapters = [...groups.values()];
    if (s.key === "alphonse-gaston") {
      s.completeness =
        "54 selected scans from 56 available source scans; crossovers dated 1902-09-28 and 1903-02-08 excluded for separate rights/scope review. Not the full historical series.";
      s.description =
        "Tuyển tập Alphonse và Gaston của Frederick Burr Opper: 54 scan được chọn từ 56 scan nguồn Barnacle Press. Hai trang crossover nhiều tác giả ngày 1902-09-28 và 1903-02-08 được loại khỏi danh mục nhập để kiểm tra riêng quyền và phạm vi tác phẩm. Không phải toàn bộ lịch sử xuất bản. Mỗi ngày báo là một mục đọc; giữ nguyên scan và thứ tự nguồn. Nguyên tác thuộc phạm vi công cộng tại Việt Nam theo thời hạn bảo hộ; nguồn scan Barnacle Press cho phép tái sử dụng, giữ ghi công tác giả Frederick Burr Opper và kho scan. Nguồn: https://www.barnaclepress.com/comic/Alphonse%20and%20Gaston/.";
    }
    s.sameDateScanGroups = s.chapters
      .filter((c) => c.pages.length > 1)
      .map((c) => ({
        date: c.sourceDate,
        scanCount: c.pages.length,
        sourceImages: c.sourceImages,
      }));
    s.description = s.description.replace(
      "Một kỳ báo là một chương với một trang tranh nhiều khung; không cắt ảnh để tăng số trang.",
      "Mỗi ngày báo là một mục đọc; các scan cùng ngày được giữ chung theo thứ tự nguồn, không cắt khung hoặc tự gọi bản biến thể là một kỳ mới.",
    );
  }
}
await fs.writeFile(
  path.join(root, "rights/comic-authorities.json"),
  JSON.stringify(
    Object.entries(comicAuthorities).map(([key, a]) => ({
      key,
      ...a,
      evidence:
        "Library of Congress catalog/authority verified; direct automated HTML endpoints returning 403 were not bypassed.",
    })),
    null,
    2,
  ) + "\n",
);
m.fileIndex = [];
async function walk(relative) {
  for (const entry of (
    await fs.readdir(path.join(root, relative), { withFileTypes: true })
  ).sort((a, b) => a.name.localeCompare(b.name))) {
    const rel = relative + "/" + entry.name;
    if (entry.isDirectory()) await walk(rel);
    else {
      const bytes = await fs.readFile(path.join(root, rel));
      m.fileIndex.push({
        path: rel,
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      });
    }
  }
}
for (const dir of ["assets", "text", "sources", "rights"]) await walk(dir);
await fs.writeFile(
  path.join(root, "manifest.json"),
  JSON.stringify(m, null, 2) + "\n",
);
console.log(
  "Locally verified full spine coverage, author authorities and file index:",
  m.fileIndex.length,
  "input files; no database or Cloudinary calls.",
);
