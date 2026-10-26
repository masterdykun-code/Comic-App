// Local preparation only: no database client or Cloudinary SDK is imported here.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import sharp from "sharp";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../catalog/sample-library-v1",
);
const hash = (b) => createHash("sha256").update(b).digest("hex");
const manifest = {
  version: "sample-library-v1",
  preparedAt: new Date().toISOString(),
  languageDecision:
    "Original English novels; Vietnamese metadata; official Vietnamese Pepper&Carrot",
  assets: [],
  stories: [],
};
async function save(relative, data) {
  const p = path.join(root, relative);
  await fs.mkdir(path.dirname(p), { recursive: true });
  await fs.writeFile(p, data);
  return { path: relative, sha256: hash(data) };
}
async function get(url) {
  const cache = path.join(root, "cache", hash(url) + ".bin");
  try {
    return await fs.readFile(cache);
  } catch {}
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((resolve) =>
      setTimeout(resolve, url.includes("wikimedia") ? 1200 : 150),
    );
    if (url.includes("wikimedia.org")) {
      const until = Number(
        await fs
          .readFile(path.join(root, "wikimedia-retry-after.txt"), "utf8")
          .catch(() => 0),
      );
      if (until > Date.now()) {
        console.log("Respecting Wikimedia Retry-After; download queued");
        await new Promise((resolve) => setTimeout(resolve, until - Date.now()));
      }
    }
    const r = await fetch(url, {
      headers: {
        "User-Agent": "WebNovelCatalogPreparation/1.0 (local rights review)",
      },
      signal: AbortSignal.timeout(30000),
    });
    if (r.status === 429 && attempt < 3) {
      const seconds = Math.max(15, Number(r.headers.get("retry-after")) || 30);
      await fs.writeFile(
        path.join(root, "wikimedia-retry-after.txt"),
        String(Date.now() + seconds * 1000),
      );
      console.log(
        "Source rate limit; respecting Retry-After",
        seconds,
        "seconds",
      );
      continue;
    }
    if (!r.ok) throw new Error(`Source HTTP ${r.status}: ${url}`);
    const bytes = Buffer.from(await r.arrayBuffer());
    await fs.mkdir(path.dirname(cache), { recursive: true });
    await fs.writeFile(cache, bytes);
    return bytes;
  }
}
function plain(s) {
  return s
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#x([0-9a-f]+);/gi, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(
      /&(amp|quot|apos|lt|gt|nbsp|mdash|ndash|lsquo|rsquo|ldquo|rdquo|hellip);/g,
      (_, n) =>
        ({
          amp: "&",
          quot: '"',
          apos: "'",
          lt: "<",
          gt: ">",
          nbsp: " ",
          mdash: "—",
          ndash: "–",
          lsquo: "‘",
          rsquo: "’",
          ldquo: "“",
          rdquo: "”",
          hellip: "…",
        })[n],
    )
    .trim();
}
async function asset(key, url, source, license, author, fileName) {
  const found = (
    await fs.readdir(path.join(root, "assets")).catch(() => [])
  ).find((n) => n.startsWith(key + "."));
  const bytes = found
    ? await fs.readFile(path.join(root, "assets", found))
    : await get(url);
  const meta = await sharp(bytes).metadata();
  if (
    !["jpeg", "png", "webp"].includes(meta.format) ||
    !meta.width ||
    !meta.height ||
    bytes.length > 10 * 1024 * 1024
  )
    throw new Error("Image does not meet import policy");
  const file = await save(
    "assets/" + key + "." + (meta.format === "jpeg" ? "jpg" : meta.format),
    bytes,
  );
  manifest.assets.push({
    key,
    ...file,
    bytes: bytes.length,
    width: meta.width,
    height: meta.height,
    sourceUrl: source,
    downloadUrl: url,
    license,
    author,
    fileName,
  });
  return key;
}
const novels = [
  [
    "alice",
    "Alice ở xứ sở thần tiên",
    "Alice’s Adventures in Wonderland",
    "Lewis Carroll",
    1898,
    "lewis-carroll/alices-adventures-in-wonderland/john-tenniel",
  ],
  [
    "treasure-island",
    "Đảo giấu vàng",
    "Treasure Island",
    "Robert Louis Stevenson",
    1894,
    "robert-louis-stevenson/treasure-island",
  ],
  [
    "tom-sawyer",
    "Những cuộc phiêu lưu của Tom Sawyer",
    "The Adventures of Tom Sawyer",
    "Mark Twain",
    1910,
    "mark-twain/the-adventures-of-tom-sawyer",
  ],
  [
    "pride-prejudice",
    "Kiêu hãnh và định kiến",
    "Pride and Prejudice",
    "Jane Austen",
    1817,
    "jane-austen/pride-and-prejudice",
  ],
  [
    "secret-garden",
    "Khu vườn bí mật",
    "The Secret Garden",
    "Frances Hodgson Burnett",
    1924,
    "frances-hodgson-burnett/the-secret-garden",
  ],
];
for (let b = 0; b < novels.length; b++) {
  const [key, label, original, author, died, book] = novels[b];
  const source = "https://standardebooks.org/ebooks/" + book;
  const repo = book.replaceAll("/", "_");
  const commit = JSON.parse(
    (
      await get(
        `https://api.github.com/repos/standardebooks/${repo}/commits/master`,
      )
    ).toString(),
  ).sha;
  const raw = `https://raw.githubusercontent.com/standardebooks/${repo}/${commit}/`;
  const license = await get(raw + "LICENSE.md");
  if (!license.toString().includes("CC0"))
    throw new Error("CC0 edition statement missing");
  await save(`sources/${key}/LICENSE.md`, license);
  await save(`sources/${key}/page.html`, await get(source));
  const coverKey = key + "-cover";
  const colors = [
    ["#133249", "#c49a50"],
    ["#123d35", "#d9b873"],
    ["#234464", "#f2b56b"],
    ["#43283f", "#e1b3bf"],
    ["#173d31", "#e2d89f"],
  ][b];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="1350"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${colors[0]}"/><stop offset="1" stop-color="#0b1621"/></linearGradient></defs><rect width="900" height="1350" fill="url(#g)"/><rect x="45" y="45" width="810" height="1260" rx="20" fill="none" stroke="${colors[1]}" stroke-width="3"/><circle cx="450" cy="460" r="215" fill="none" stroke="${colors[1]}" stroke-width="2"/><path d="M260 520 Q350 440 450 490 Q550 440 640 520 L640 650 Q550 570 450 620 Q350 570 260 650Z" fill="${colors[1]}"/><path d="M450 490V620" stroke="${colors[0]}" stroke-width="4"/><text x="450" y="195" text-anchor="middle" fill="${colors[1]}" font-size="27" font-family="Arial">WEBNOVEL · CLASSICS</text>${original
    .split(" ")
    .reduce(
      (a, w) => {
        if (a.at(-1).length + w.length > 24) a.push(w);
        else a[a.length - 1] += (a.at(-1) ? " " : "") + w;
        return a;
      },
      [""],
    )
    .map(
      (line, i) =>
        `<text x="450" y="${835 + i * 65}" text-anchor="middle" fill="#fff6e3" font-family="Georgia" font-size="47">${line.replaceAll("&", "&amp;")}</text>`,
    )
    .join(
      "",
    )}<text x="450" y="1160" text-anchor="middle" fill="${colors[1]}" font-size="30" font-family="Arial">${author}</text><text x="450" y="1220" text-anchor="middle" fill="#c9c9bc" font-size="21" font-family="Arial">FIRST THREE CHAPTERS · ENGLISH ORIGINAL</text></svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const cover = await save(`assets/${coverKey}.png`, png);
  manifest.assets.push({
    key: coverKey,
    ...cover,
    bytes: png.length,
    width: 900,
    height: 1350,
    sourceUrl: "Original project geometric artwork generated by prepare.mjs",
    downloadUrl: null,
    license: "CC0-1.0 (original cover artwork only)",
    author: "WebNovel sample-library preparation",
  });
  const chapters = [];
  for (let n = 1; n <= 3; n++) {
    const url = raw + `src/epub/text/chapter-${n}.xhtml`;
    const html = (await get(url)).toString();
    await save(`sources/${key}/chapter-${n}.xhtml`, html);
    const content = [...html.matchAll(/<p(?:\s[^>]*)?>([\s\S]*?)<\/p>/g)]
      .map((m) => plain(m[1]))
      .filter(Boolean)
      .join("\n\n");
    if (content.length < 500 || content.length > 200000)
      throw new Error("Incomplete novel chapter");
    chapters.push({
      number: n,
      title: plain(
        html.match(/<title>([\s\S]*?)<\/title>/)?.[1] ?? `Chapter ${n}`,
      ),
      content: await save(`text/${key}-${n}.txt`, content),
      pages: [],
      sourceUrl: url,
    });
  }
  manifest.stories.push({
    key,
    slug: "sample-v1-" + key,
    type: "NOVEL",
    title: label + " (đọc thử)",
    originalTitle: original,
    authorName: author,
    authorDied: died,
    language: "en",
    genre: "sample-v1-literature",
    sourceUrl: source,
    license:
      "Original text: public domain; Standard Ebooks editorial contributions: CC0-1.0",
    editionCommit: commit,
    cover: coverKey,
    description: `Bản đọc thử ba chương đầu, giữ nguyên tiếng Anh, không phải bản dịch thương mại. Nguyên tác: ${original} — ${author}. Nguồn: ${source}. Văn bản nguyên tác thuộc phạm vi công cộng; phần biên tập Standard Ebooks: CC0, xem LICENSE.md kèm bộ dữ liệu. Bìa hình học mới do dự án tạo, CC0. Không phải toàn bộ tiểu thuyết.`,
    chapters,
  });
  console.log("Prepared NOVEL", key);
}
const episodes = [
  "ep01_Potion-of-Flight",
  "ep02_Rainbow-potions",
  "ep03_The-secret-ingredients",
];
const chapters = [];
const aboutUrl = "https://www.peppercarrot.com/en/about/index.html";
const about = await get(aboutUrl);
await save("sources/pepper-carrot/about.html", about);
if (!about.toString().includes("creativecommons.org/licenses/by/4.0"))
  throw new Error("Pepper license missing");
let pepperCover;
for (let i = 0; i < episodes.length; i++) {
  const source = `https://www.peppercarrot.com/vi/webcomic/${episodes[i]}.html`;
  const html = (await get(source)).toString();
  await save(`sources/pepper-carrot/episode-${i + 1}.html`, html);
  const urls = [
    ...new Set(
      [
        ...html.matchAll(
          /src="(https:\/\/www\.peppercarrot\.com\/0_sources\/[^"\s]+\/low-res\/vi_[^"]+_E\d+P\d+\.jpg)"/g,
        ),
      ].map((m) => m[1]),
    ),
  ].sort();
  if (urls.length < 3)
    throw new Error("Vietnamese episode pages not verified: " + source);
  const pages = [];
  for (const url of urls) {
    const pageNumber = Number(url.match(/P(\d+)\.jpg$/)[1]);
    if (pageNumber === 0) continue;
    const a = await asset(
      `pepper-carrot-e${i + 1}-p${pageNumber}`,
      url,
      source,
      "CC-BY-4.0 (current site); historical CC-BY-3.0 credits retained",
      i > 0
        ? "David Revoy; Vietnamese translation: Binh Pham"
        : "David Revoy; Vietnamese community translation, credits at source",
    );
    if (pageNumber > 0 && manifest.assets.at(-1).height < 200) {
      manifest.assets.pop();
      continue;
    }
    pages.push(a);
  }
  chapters.push({
    number: i + 1,
    title: ["Thuốc bay", "Những lọ thuốc cầu vồng", "Nguyên liệu bí mật"][i],
    content: null,
    pages,
    sourceUrl: source,
  });
}
pepperCover = chapters[0].pages[0];
manifest.stories.push({
  key: "pepper-carrot",
  slug: "sample-v1-pepper-carrot",
  type: "COMIC",
  title: "Pepper & Carrot (ba tập đầu)",
  authorName: "David Revoy",
  language: "vi",
  genre: "sample-v1-comics",
  sourceUrl: aboutUrl,
  license: "CC-BY-4.0 (current site); historical CC-BY-3.0 credits retained",
  cover: pepperCover,
  description: `Pepper&Carrot — David Revoy, www.peppercarrot.com. Bản Việt cộng đồng dự án; Binh Pham được ghi công ở tập 2–3, tập 1 xem credits nguồn. Giữ nguyên trang ảnh và credits. CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ ; một số trang credits cũ ghi CC BY 3.0 và được giữ nguyên. Nguồn/credits từng tập: ${chapters.map((c) => c.sourceUrl).join(" ; ")}. Nguồn giấy phép: ${aboutUrl} . Không chỉnh sửa ảnh hoặc dùng ảnh để tạo sinh AI; chỉ tập hợp 3 tập đầu để đọc thử.`,
  chapters,
});

const commons = [
  [
    "little-nemo",
    "Little Nemo ở xứ sở giấc mơ",
    "Winsor McCay",
    1934,
    [
      "1905-10-15",
      "1905-10-29",
      "1905-11-05",
      "1905-11-12",
      "1905-11-19",
      "1905-11-26",
      "1905-12-03",
      "1905-12-10",
      "1905-12-17",
    ].map((d) => `File:Little Nemo ${d}.jpg`),
  ],
];
for (const [key, title, author, died, files] of commons) {
  const records = [];
  for (let i = 0; i < files.length; i++) {
    const url =
      "https://commons.wikimedia.org/w/api.php?action=query&format=json&prop=imageinfo&iiprop=url%7Cextmetadata&titles=" +
      encodeURIComponent(files[i]);
    const meta = JSON.parse((await get(url)).toString());
    const page = Object.values(meta.query.pages)[0];
    const info = page.imageinfo?.[0];
    if (
      !info ||
      info.extmetadata?.LicenseShortName?.value !== "Public domain" ||
      !plain(info.extmetadata.Artist?.value ?? "").includes(author)
    )
      throw new Error("Unverified image rights: " + files[i]);
    await save(`sources/${key}/${i + 1}.json`, JSON.stringify(meta, null, 2));
    const imageUrl = new URL(info.url);
    imageUrl.search = "";
    records.push(
      await asset(
        `${key}-${i + 1}`,
        imageUrl.href,
        info.descriptionurl,
        "Public domain (Commons file rights record)",
        author,
        files[i],
      ),
    );
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  const per = records.length / 3;
  manifest.stories.push({
    key,
    slug: "sample-v1-" + key,
    type: "COMIC",
    title: title + " (tuyển chọn)",
    authorName: author,
    authorDied: died,
    language: "en",
    genre: "sample-v1-comics",
    sourceUrl: manifest.assets.find((a) => a.key === records[0]).sourceUrl,
    license: "Public domain; preserve attribution/source as provenance",
    cover: records[0],
    description: `Tuyển chọn truyện tranh báo cổ của ${author}. Ảnh nguyên bản, không dùng bản tô màu hoặc bản phục chế thương mại. Ba chương là cách nhóm trang để trình diễn ứng dụng, không phải chương nguyên tác. Văn bản trong ảnh giữ tiếng Anh. Từng trang kèm nguồn Wikimedia Commons và hồ sơ Public domain trong SOURCES.md. Tác giả mất năm ${died}.`,
    chapters: [0, 1, 2].map((i) => ({
      number: i + 1,
      title: `Tuyển chọn ${i + 1}`,
      content: null,
      pages: records.slice(i * per, (i + 1) * per),
    })),
  });
  console.log("Prepared COMIC", key, records.length, "pages");
}
// Barnacle Press expressly permits reuse of its scans; preserve source and authorship.
const barnacleRightsUrl = "https://www.barnaclepress.com/about-us/";
const barnacleRights = (await get(barnacleRightsUrl)).toString();
if (
  !barnacleRights.includes("we’re totally cool with it") &&
  !barnacleRights.includes("we&#8217;re totally cool with it")
)
  throw new Error("Barnacle reuse statement changed; manual review required");
await save("sources/barnacle-reuse.html", barnacleRights);
const barnacle = [
  [
    "sammy-barnacle",
    "Những cái hắt hơi của Sammy",
    "Winsor McCay",
    1934,
    "Little Sammy Sneeze",
    "sneeze",
    ["050528", "050604", "050611", "050625", "050702", "050709"],
  ],
  [
    "buster-brown",
    "Buster Brown nghịch ngợm",
    "Richard Felton Outcault",
    1928,
    "Buster Brown",
    "buster",
    ["030426", "030503", "030510", "030517", "030524", "030531"],
  ],
  [
    "foxy-grandpa",
    "Ông lão tinh nghịch",
    "Carl Emil Schultze (Bunny)",
    1939,
    "Foxy Grandpa",
    "fg",
    ["020601", "020608", "020713", "020720", "020727", "020803"],
  ],
];
for (const [
  key,
  title,
  author,
  died,
  originalTitle,
  prefix,
  dates,
] of barnacle) {
  const sourceUrl =
    "https://www.barnaclepress.com/comic/" +
    encodeURIComponent(originalTitle) +
    "/";
  const html = (await get(sourceUrl)).toString();
  await save("sources/" + key + "/index.html", html);
  const records = [];
  for (const date of dates) {
    const url =
      "https://www.barnaclepress.com/cmcvlt/" +
      encodeURIComponent(originalTitle) +
      "/slides/" +
      prefix +
      date +
      ".jpg";
    if (!html.includes(url))
      throw new Error("Image not listed by original archive");
    const publicationDate =
      "19" + date.slice(0, 2) + "-" + date.slice(2, 4) + "-" + date.slice(4, 6);
    records.push(
      await asset(
        key + "-" + date,
        url,
        sourceUrl,
        "Public domain (" +
          publicationDate +
          "; author died " +
          died +
          "); archive reuse permitted: " +
          barnacleRightsUrl,
        author + "; scan courtesy Barnacle Press",
        originalTitle + " " + publicationDate,
      ),
    );
  }
  manifest.stories.push({
    key,
    slug: "sample-v1-" + key,
    type: "COMIC",
    title: title + " (tuyển chọn)",
    originalTitle,
    authorName: author,
    authorDied: died,
    language: "en",
    genre: "sample-v1-comics",
    sourceUrl,
    license:
      "Public domain original newspaper art; Barnacle Press scan reuse permitted",
    cover: records[0],
    description:
      "Tuyển chọn " +
      originalTitle +
      " của " +
      author +
      ". Sáu trang báo cổ, chia ba nhóm tuyển chọn, không phải chương nguyên tác. Văn bản giữ tiếng Anh. Ảnh scan courtesy Barnacle Press; nguồn " +
      sourceUrl +
      "; quyền tái sử dụng: " +
      barnacleRightsUrl +
      ". Nguyên tác thuộc phạm vi công cộng, giữ nguyên ảnh và chữ ký tác giả; không dùng bản dịch hoặc bìa nhà xuất bản hiện đại.",
    chapters: [0, 1, 2].map((i) => ({
      number: i + 1,
      title: "Tuyển chọn " + (i + 1),
      content: null,
      pages: records.slice(i * 2, i * 2 + 2),
    })),
  });
  console.log("Prepared COMIC", key, records.length, "pages");
}
await save("manifest.json", JSON.stringify(manifest, null, 2) + "\n");
const counts = {
  stories: manifest.stories.length,
  chapters: manifest.stories.reduce((n, s) => n + s.chapters.length, 0),
  pages: manifest.stories.reduce(
    (n, s) => n + s.chapters.reduce((m, c) => m + c.pages.length, 0),
    0,
  ),
  assets: manifest.assets.length,
};
await save("counts.json", JSON.stringify(counts, null, 2));
console.log("LOCAL PREPARATION COMPLETE", counts);
