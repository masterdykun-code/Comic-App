// Staging only. No database driver, Prisma or Cloudinary import exists here.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { xml, normalized } from "./normalize.mjs";
import sharp from "sharp";
const backend = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const root = path.join(backend, "catalog/library-expansion-v2");
const hash = (b) => createHash("sha256").update(b).digest("hex");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ua = "WebNovelCatalogStaging/2.0 (local source and rights review)";
await fs.mkdir(root, { recursive: true });
async function save(name, bytes) {
  const destination = path.resolve(root, name);
  if (!destination.startsWith(root + path.sep))
    throw new Error("Unsafe staging path");
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, bytes);
  return { path: name, sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
}
async function get(url) {
  const name = "cache/" + hash(url) + ".bin";
  try {
    return await fs.readFile(path.join(root, name));
  } catch {}
  const host = new URL(url).hostname;
  const interval =
    host === "www.barnaclepress.com"
      ? 10500
      : host === "id.loc.gov"
        ? 3100
        : 250;
  const clock = path.join(root, "cache", host + ".next");
  await fs.mkdir(path.dirname(clock), { recursive: true });
  const until = Number(await fs.readFile(clock, "utf8").catch(() => "0"));
  if (until > Date.now()) await sleep(until - Date.now());
  await fs.writeFile(clock, String(Date.now() + interval));
  const response = await fetch(url, {
    headers: { "User-Agent": ua },
    signal: AbortSignal.timeout(45000),
  });
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    const seconds = /^\d+$/.test(retry ?? "")
      ? Number(retry)
      : Math.max(60, (Date.parse(retry ?? "") - Date.now()) / 1000 || 60);
    await fs.writeFile(clock, String(Date.now() + seconds * 1000));
    throw new Error("Source rate limited; stopped without retry: " + host);
  }
  if (!response.ok)
    throw new Error("Source HTTP " + response.status + ": " + url);
  const bytes = Buffer.from(await response.arrayBuffer());
  await save(name, bytes);
  return bytes;
}
const novels = [
  [
    "dracula",
    "Dracula",
    "Bram Stoker",
    1912,
    1897,
    "bram-stoker/dracula",
    ["Kinh dị", "Kỳ ảo"],
    "Những lá thư và nhật ký kết nối cuộc đối đầu với bá tước Dracula.",
  ],
  [
    "frankenstein",
    "Frankenstein",
    "Mary Shelley",
    1851,
    1818,
    "mary-shelley/frankenstein",
    ["Kinh dị", "Khoa học viễn tưởng"],
    "Victor Frankenstein tạo ra sự sống và phải đối diện hậu quả của tham vọng.",
  ],
  [
    "jane-eyre",
    "Jane Eyre",
    "Charlotte Brontë",
    1855,
    1847,
    "charlotte-bronte/jane-eyre",
    ["Văn học kinh điển", "Lãng mạn"],
    "Hành trình trưởng thành và giành quyền tự quyết của Jane Eyre.",
  ],
  [
    "wuthering-heights",
    "Đồi gió hú",
    "Emily Brontë",
    1848,
    1847,
    "emily-bronte/wuthering-heights",
    ["Văn học kinh điển", "Lãng mạn"],
    "Mối quan hệ nhiều thế hệ giữa hai gia đình trên miền đồng hoang Yorkshire.",
  ],
  [
    "great-expectations",
    "Những kỳ vọng lớn lao",
    "Charles Dickens",
    1870,
    1861,
    "charles-dickens/great-expectations",
    ["Văn học kinh điển"],
    "Pip theo đuổi địa vị và học cách nhìn lại tình nghĩa cùng những kỳ vọng của mình.",
  ],
  [
    "study-in-scarlet",
    "Cuộc điều tra màu đỏ",
    "Arthur Conan Doyle",
    1930,
    1887,
    "arthur-conan-doyle/a-study-in-scarlet",
    ["Trinh thám"],
    "Cuộc gặp đầu tiên giữa Sherlock Holmes và bác sĩ Watson trong một vụ án bí ẩn.",
  ],
  [
    "hound-baskervilles",
    "Con chó săn dòng họ Baskerville",
    "Arthur Conan Doyle",
    1930,
    1902,
    "arthur-conan-doyle/the-hound-of-the-baskervilles",
    ["Trinh thám"],
    "Holmes và Watson điều tra lời nguyền được cho là đeo bám dòng họ Baskerville.",
  ],
  [
    "time-machine",
    "Cỗ máy thời gian",
    "H. G. Wells",
    1946,
    1895,
    "h-g-wells/the-time-machine",
    ["Khoa học viễn tưởng"],
    "Một nhà phát minh du hành tới tương lai xa và khám phá số phận loài người.",
  ],
  [
    "war-worlds",
    "Chiến tranh giữa các thế giới",
    "H. G. Wells",
    1946,
    1898,
    "h-g-wells/the-war-of-the-worlds",
    ["Khoa học viễn tưởng"],
    "Một cuộc xâm lược từ Sao Hỏa làm đảo lộn nước Anh cuối thế kỷ XIX.",
  ],
  [
    "sense-sensibility",
    "Lý trí và tình cảm",
    "Jane Austen",
    1817,
    1811,
    "jane-austen/sense-and-sensibility",
    ["Văn học kinh điển", "Lãng mạn"],
    "Hai chị em Dashwood trải nghiệm tình yêu, hoàn cảnh gia đình và những lựa chọn khác nhau.",
  ],
];
const comics = [
  [
    "explorigator",
    "Chuyến phiêu lưu của Explorigator",
    "The Explorigator",
    "Harry Grant Dart",
    1938,
    "Explorigator",
    ["Kỳ ảo", "Phiêu lưu"],
    "Phi hành đoàn trên khinh khí cầu Explorigator khám phá Mặt Trăng. Nguồn giới thiệu đây là toàn bộ 14 kỳ năm 1908.",
  ],
  [
    "hungry-henrietta",
    "Cô bé Henrietta hay đói",
    "The Story of Hungry Henrietta",
    "Winsor McCay",
    1934,
    "Hungry Henrietta",
    ["Hài hước"],
    "Câu chuyện về cô bé Henrietta và những người lớn luôn cho rằng em đang đói. Kho nguồn chỉ có bảy chương đầu; không phải trọn bộ nguyên tác.",
  ],
  [
    "lulu-leander",
    "Chuyện tình Lulu và Leander",
    "Lulu and Leander",
    "Franklin Morris Howarth",
    1908,
    "Lulu and Leander",
    ["Hài hước", "Lãng mạn"],
    "Những tình huống trắc trở trong chuyện hẹn hò của Lulu và Leander. Toàn bộ scan hiện khả dụng tại kho được giữ theo ngày báo; kho không cung cấp toàn bộ nguyên tác.",
  ],
  [
    "alphonse-gaston",
    "Alphonse và Gaston",
    "Alphonse and Gaston",
    "Frederick Burr Opper",
    1937,
    "Alphonse and Gaston",
    ["Hài hước"],
    "Hai quý ông quá khách sáo khiến những việc đơn giản trở nên rắc rối. Tuyển tập toàn bộ scan khả dụng tại nguồn, không phải toàn bộ lịch sử xuất bản.",
  ],
  [
    "polly-sleepyhead",
    "Những giấc ngủ của Polly",
    "The Naps of Polly Sleepyhead",
    "Peter Newell",
    1924,
    "Naps of Polly Sleepyhead",
    ["Kỳ ảo", "Hài hước"],
    "Polly dễ dàng thiếp ngủ và bước vào những giấc mơ gắn với công việc đang làm. Bao gồm toàn bộ scan khả dụng tại nguồn, kể cả giai đoạn đổi tên thành Polly Sleepyhead.",
  ],
];
const manifest = {
  version: "library-expansion-v2",
  state: "STAGING_ONLY_AWAITING_REVIEW",
  intendedDatabase: "webnovel_db/public",
  language:
    "en; Vietnamese metadata only; no unverified Vietnamese translation",
  assets: [],
  stories: [],
  genres: [],
  sourceDocuments: [],
};
for (const host of [
  "www.barnaclepress.com",
  "standardebooks.org",
  "raw.githubusercontent.com",
]) {
  try {
    const b = await get("https://" + host + "/robots.txt");
    manifest.sourceDocuments.push({
      url: "https://" + host + "/robots.txt",
      ...(await save("rights/" + host + "-robots.txt", b)),
    });
  } catch (e) {
    if (host !== "raw.githubusercontent.com") throw e;
  } // HTTP 404 on raw GitHub: no robots file.
}
const rightsUrl = "https://www.barnaclepress.com/about-us/";
const rights = (await get(rightsUrl)).toString();
if (!/totally cool with it/.test(rights))
  throw Error("Archive reuse statement needs manual review");
manifest.sourceDocuments.push({
  url: rightsUrl,
  ...(await save("rights/barnacle-reuse.html", rights)),
});
async function image(key, bytes, details) {
  const meta = await sharp(bytes).metadata();
  if (
    !["png", "jpeg", "webp"].includes(meta.format) ||
    meta.pages > 1 ||
    meta.width * meta.height > 16000000 ||
    bytes.length > 10485760
  )
    throw Error("Unsupported image: " + key);
  const file = await save(
    "assets/" + key + "." + (meta.format === "jpeg" ? "jpg" : meta.format),
    bytes,
  );
  const asset = {
    key,
    ...file,
    width: meta.width,
    height: meta.height,
    ...details,
  };
  manifest.assets.push(asset);
  return key;
}
for (const [
  key,
  title,
  author,
  death,
  year,
  edition,
  genres,
  summary,
] of novels) {
  const repo = edition.replaceAll("/", "_");
  const commit = JSON.parse(
    (
      await get(
        "https://api.github.com/repos/standardebooks/" +
          repo +
          "/commits/master",
      )
    ).toString(),
  ).sha;
  if (!/^[a-f0-9]{40}$/.test(commit || ""))
    throw Error("Missing pinned edition revision: " + repo);
  const rawBase =
    "https://raw.githubusercontent.com/standardebooks/" +
    repo +
    "/" +
    commit +
    "/";
  const license = await get(rawBase + "LICENSE.md");
  if (!license.toString().includes("CC0"))
    throw Error("No CC0 edition license");
  await save("sources/" + key + "/LICENSE.md", license);
  const opf = await get(rawBase + "src/epub/content.opf");
  await save("sources/" + key + "/content.opf", opf);
  const document = xml(opf);
  const items = new Map(
    [...document.querySelectorAll("manifest item")].map((n) => [
      n.getAttribute("id"),
      n.getAttribute("href"),
    ]),
  );
  const chapters = [],
    excluded = [];
  for (const ref of document.querySelectorAll("spine itemref")) {
    const href = items.get(ref.getAttribute("idref"));
    if (!href?.endsWith(".xhtml"))
      throw Error("Unsupported reading spine item");
    const url = rawBase + "src/epub/" + href;
    const original = await get(url);
    const sourceFile = await save("sources/" + key + "/" + href, original);
    if (
      /\/(titlepage|halftitlepage|imprint|colophon|uncopyright)\.xhtml$/.test(
        href,
      )
    ) {
      excluded.push({
        href,
        reason: "Edition title/legal/colophon page; archived unchanged",
        source: sourceFile,
      });
      continue;
    }
    const doc = xml(original);
    if (doc.querySelector("parsererror")) throw Error("Malformed source XHTML");
    const value = normalized(doc);
    if (!value.trim() || value.length > 200000 || value.includes("\0"))
      throw Error("Chapter outside current backend policy: " + href);
    // Preserve any inline image originals locally rather than silently losing source material.
    const inlineImages = [];
    for (const img of doc.querySelectorAll("body img")) {
      const relative = img.getAttribute("src");
      const sourceImageUrl = new URL(relative, url).href;
      inlineImages.push({
        url: sourceImageUrl,
        ...(await save(
          "sources/" + key + "/inline/" + path.basename(relative),
          await get(sourceImageUrl),
        )),
      });
    }
    const titleNode = doc.querySelector("body h1,body h2,body h3,body h4");
    const heading =
      titleNode?.textContent.replace(/\s+/g, " ").trim() ||
      path.basename(href, ".xhtml");
    chapters.push({
      number: chapters.length + 1,
      title: heading.slice(0, 200),
      sourceTitle: heading,
      sourceId: href,
      sourceUrl: url,
      source: sourceFile,
      content: await save(
        "text/" +
          key +
          "/" +
          String(chapters.length + 1).padStart(3, "0") +
          ".txt",
        value,
      ),
      pages: [],
      inlineImages,
    });
  }
  const colors = ["#173448", "#502d45", "#1e4d44", "#3d3556", "#543b22"];
  const c = colors[novels.findIndex((n) => n[0] === key) % colors.length];
  const lines = title.split(" ").reduce((out, word) => {
    if (!out.length || out.at(-1).length + word.length > 21) out.push(word);
    else out[out.length - 1] += " " + word;
    return out;
  }, []);
  const escape = (s) => s.replaceAll("&", "&amp;").replaceAll("<", "&lt;");
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1350"><rect width="900" height="1350" fill="' +
    c +
    '"/><rect x="42" y="42" width="816" height="1266" fill="none" stroke="#d7ba7c" stroke-width="3"/><circle cx="450" cy="330" r="140" fill="none" stroke="#d7ba7c" stroke-width="2"/><path d="M330 325l120-90 120 90v110H330z M450 235v200" fill="none" stroke="#d7ba7c" stroke-width="4"/><text x="450" y="570" fill="#eee4c8" text-anchor="middle" font-family="Georgia" font-size="23" letter-spacing="5">WEBNOVEL · CLASSICS</text>' +
    lines
      .map(
        (l, i) =>
          '<text x="450" y="' +
          (710 + i * 80) +
          '" fill="#fff7e5" text-anchor="middle" font-family="Georgia" font-size="58">' +
          escape(l) +
          "</text>",
      )
      .join("") +
    '<text x="450" y="1110" fill="#d7ba7c" text-anchor="middle" font-family="Georgia" font-size="30">' +
    escape(author) +
    '</text><text x="450" y="1210" fill="#eee4c8" text-anchor="middle" font-family="Georgia" font-size="21">COMPLETE ENGLISH TEXT</text></svg>';
  const cover = await image(
    key + "-cover",
    await sharp(Buffer.from(svg)).png().toBuffer(),
    {
      sourceUrl: "local:original-geometric-cover",
      author: "WebNovel project — original geometric design",
      license: "CC0-1.0",
      transformations: "New cover, not a historic publisher cover",
    },
  );
  const sourceUrl = "https://standardebooks.org/ebooks/" + edition;
  manifest.stories.push({
    key,
    sourceId: "standardebooks/" + repo,
    sourceUrl,
    editionCommit: commit,
    slug: "library-v2-" + key,
    title,
    originalTitle:
      document.getElementsByTagNameNS("*", "title")[0]?.textContent || title,
    authorName: author,
    authorDeathYear: death,
    firstPublicationYear: year,
    type: "NOVEL",
    language: "en",
    genres,
    cover,
    description:
      summary +
      " Toàn bộ văn bản tiếng Anh của ấn bản nguồn, gồm các mục phụ trợ được liệt kê; tiêu đề và mô tả tiếng Việt, không phải bản dịch. Nguyên tác: " +
      author +
      ". Nguồn: " +
      sourceUrl +
      ". Nguyên tác thuộc phạm vi công cộng tại Việt Nam theo thời hạn tác giả; phần biên tập Standard Ebooks CC0. Bìa hình học mới CC0. Nguồn, attribution và hash từng mục được lưu trong SOURCES.md.",
    chapters,
    excludedEditionPages: excluded,
    completeness:
      "All narrative and supplementary reading-spine items; only edition title/legal/colophon pages excluded and archived",
    rights: {
      jurisdiction: "Vietnam",
      original: "Public domain: author lifetime + 50 years elapsed",
      authorDeathYear: death,
      termEndVietnam: death + 50,
      edition: "CC0-1.0",
      licenseUrl: rawBase + "LICENSE.md",
    },
  });
  await save(
    "progress/" + key + ".json",
    JSON.stringify(manifest.stories.at(-1), null, 2),
  );
  console.log("STAGED COMPLETE NOVEL", key, chapters.length, "reading units");
}
// Ten-second archive crawl delay applies equally to pages and images.
for (const [
  key,
  title,
  originalTitle,
  author,
  death,
  folder,
  genres,
  summary,
] of comics) {
  const sourceUrl =
    "https://www.barnaclepress.com/comic/" + encodeURIComponent(folder) + "/";
  const raw = await get(sourceUrl);
  const html = raw.toString();
  await save("sources/" + key + "/index.html", raw);
  const urls = [
    ...new Set(
      [
        ...html.matchAll(
          /(?:src|href)="([^"]+\/slides\/[^"?]+\.(?:jpg|png))"/g,
        ),
      ].map((x) => x[1].replaceAll("&amp;", "&")),
    ),
  ];
  const declared = Number(
    html.match(/Displaying\s+\d+-\d+\s+of\s+(\d+)/)?.[1] || urls.length,
  );
  if (!urls.length || declared !== urls.length)
    throw Error("Incomplete archive image inventory: " + key);
  const dated = urls
    .map((url) => {
      const name = decodeURIComponent(new URL(url).pathname.split("/").pop());
      const match = name.match(/(\d{2})(\d{2})(\d{2})([a-z]?)\.(?:jpg|png)$/i);
      if (!match) throw Error("Unknown publication order: " + name);
      return {
        url,
        name,
        date: "19" + match[1] + "-" + match[2] + "-" + match[3],
        variant: match[4],
      };
    })
    .sort(
      (a, b) =>
        a.date.localeCompare(b.date) || a.variant.localeCompare(b.variant),
    );
  const chapters = [];
  for (const entry of dated) {
    if (Number(entry.date.slice(0, 4)) > 1930)
      throw Error("Publication outside verified range");
    const page = await image(
      key + "-" + entry.name.replace(/\.(jpg|png)$/i, ""),
      await get(entry.url),
      {
        sourceUrl,
        downloadUrl: entry.url,
        publicationDate: entry.date,
        author,
        scanCredit: "Barnacle Press",
        license: "Public domain original; archive reuse permitted",
        rightsUrl,
        transformations: "none; original scan bytes",
      },
    );
    chapters.push({
      sourceId: entry.url,
      sourceDate: entry.date,
      number: chapters.length + 1,
      title:
        originalTitle +
        " — " +
        entry.date +
        (entry.variant ? " (" + entry.variant + ")" : ""),
      content: null,
      pages: [page],
    });
    console.log("STAGED COMIC", key, chapters.length + "/" + dated.length);
  }
  manifest.stories.push({
    key,
    sourceId: sourceUrl,
    sourceUrl,
    slug: "library-v2-" + key,
    title,
    originalTitle,
    authorName: author,
    authorDeathYear: death,
    type: "COMIC",
    language: "en",
    genres,
    cover: chapters[0].pages[0],
    description:
      summary +
      " Nguyên tác: " +
      originalTitle +
      " — " +
      author +
      ". Văn bản tiếng Anh, ảnh scan nguyên trạng. Scan courtesy Barnacle Press: " +
      sourceUrl +
      ". Quyền sử dụng: " +
      rightsUrl +
      ". Giữ tên tác giả, chữ ký và thông tin nguồn. Một kỳ báo là một chương với một trang tranh nhiều khung; không cắt ảnh để tăng số trang.",
    chapters,
    completeness:
      key === "explorigator"
        ? "Full run as stated by source"
        : "All available source scans; historical series is not claimed complete",
    rights: {
      jurisdiction: "Vietnam",
      original: "Public domain: author lifetime + 50 years elapsed",
      authorDeathYear: death,
      termEndVietnam: death + 50,
      archive: rightsUrl,
    },
  });
  await save(
    "progress/" + key + ".json",
    JSON.stringify(manifest.stories.at(-1), null, 2),
  );
}
manifest.genres = [...new Set(manifest.stories.flatMap((s) => s.genres))]
  .sort()
  .map((name) => ({
    name,
    slug: name
      .toLowerCase()
      .replace(/đ/g, "d")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, ""),
  }));
if (
  manifest.stories.length !== 15 ||
  new Set(manifest.stories.map((s) => s.sourceId)).size !== 15
)
  throw Error("Unexpected catalogue cardinality");
await save("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log(
  "STAGING COMPLETE",
  manifest.stories.length,
  "works",
  manifest.assets.length,
  "images",
);
