import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../catalog/library-expansion-v2",
);
const raw = await fs.readFile(path.join(root, "manifest.json"));
const m = JSON.parse(raw);
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const assets = new Map(m.assets.map((a) => [a.key, a]));
const pages = m.stories.reduce(
  (n, s) => n + s.chapters.reduce((p, c) => p + c.pages.length, 0),
  0,
);
const counts = {
  stories: m.stories.length,
  novels: m.stories.filter((s) => s.type === "NOVEL").length,
  comics: m.stories.filter((s) => s.type === "COMIC").length,
  chapters: m.stories.reduce((n, s) => n + s.chapters.length, 0),
  chapterPages: pages,
  genres: m.genres.length,
  storyGenres: m.stories.reduce((n, s) => n + s.genres.length, 0),
  images: m.assets.length,
  uniqueImageHashes: new Set(m.assets.map((a) => a.sha256)).size,
  imageBytes: m.assets.reduce((n, a) => n + a.bytes, 0),
  textBytes: m.stories.reduce(
    (n, s) => n + s.chapters.reduce((p, c) => p + (c.content?.bytes || 0), 0),
    0,
  ),
};
const cache = await fs.readdir(path.join(root, "cache"));
counts.downloadBytes = 0;
for (const f of cache.filter((f) => f.endsWith(".bin")))
  counts.downloadBytes += (await fs.stat(path.join(root, "cache", f))).size;
const planHash = createHash("sha256").update(raw).digest("hex");
await fs.writeFile(
  path.join(root, "counts.json"),
  JSON.stringify({ ...counts, manifestSha256: planHash }, null, 2) + "\n",
);
let md =
  "# Danh mục mới — library-expansion-v2\n\n**CHỈ STAGING, CHƯA IMPORT/UPLOAD/PUBLISH.** Đích dự kiến webnovel_db/public.\n\nNOVEL giữ nguyên tiếng Anh theo lựa chọn trước đó; nhãn/mô tả tiếng Việt. Không xác minh được bản dịch Việt có quyền phân phối cho các ấn bản này nên không dùng bản dịch thương mại.\n\nMục đọc NOVEL gồm chương, thư, lời mở đầu, phần và kết từ đúng spine nguồn; số bản ghi Chapter không đồng nghĩa chỉ có các chương đánh số. Trang tiêu đề/pháp lý/colophon ấn bản không đưa vào nội dung đọc nhưng vẫn lưu nguyên XHTML trong sources/. COMIC gồm các scan đủ căn cứ quyền tại nguồn; mục bị loại được ghi riêng, không tự cắt thành ba chương. Một scan báo nhiều khung là một trang; ảnh giữ nguyên byte.\n\n| Loại | Tên / nguyên tác | Tác giả | Mục đọc / trang | Ngôn ngữ | Nguồn | Quyền |\n|---|---|---|---|---|---|---|\n";
let sources =
  "# SOURCES — nguồn và quyền sử dụng\n\nPhạm vi đánh giá là sử dụng tại Việt Nam, ngày 19/10/2026; không tuyên bố có quyền phân phối ở mọi quốc gia.\n\nCăn cứ: [Văn bản hợp nhất 67/VBHN-VPQH, Công báo Chính phủ](https://congbao.chinhphu.vn/van-ban/van-ban-hop-nhat-so-67-vbhn-vpqh-469197.htm), Điều 27 và 43; [PDF chính thức](https://congbao.cdnchinhphu.vn/180507251028987904/2026/4/10/cong-bao-so-197-639112542698495383-ngay-10-04-47113_1775783210_signed.pdf), trang PDF 26 và 36. Quyền tài sản văn học thông thường hết sau đời tác giả cộng 50 năm; các nhóm áp dụng thời hạn 75 năm từ công bố có quy tắc riêng. Quyền nhân thân liên quan vẫn phải được tôn trọng. Các tác giả được chọn đều mất trước 1950; tranh báo đều xuất bản trước 1931. Đánh giá dựa trên cả tác giả và ngày công bố, không chỉ nhãn Public domain của Mỹ.\n\nStandard Ebooks chỉ khẳng định nguyên liệu được tin thuộc US public domain; đóng góp ấn bản CC0. Ở đây đối chiếu riêng với thời hạn Việt Nam. Không dùng tranh cover của Standard Ebooks, tránh quyền riêng của họa sĩ; cover NOVEL là thiết kế hình học mới CC0, không phải bìa gốc. COMIC dùng scan gốc từ Barnacle Press, [kho cho phép tái sử dụng](https://www.barnaclepress.com/about-us/). Quyền public domain nguyên tác và chấp thuận dùng scan của kho là hai căn cứ riêng. Không dùng các bìa/phần giới thiệu/tô màu mới của nhà xuất bản thương mại.\n\nBản dịch: không lấy bản dịch Việt chưa có giấy phép; không dịch tự động rồi gắn tên dịch giả. Bản tiếng Anh là nguyên tác của 10 NOVEL; tất cả COMIC giữ chữ tiếng Anh trong scan.\n\nThu thập nội dung truyện: downloader áp dụng chính sách nguồn; Barnacle crawl-delay 10 giây, downloader dùng 10,5 giây, tuần tự. HTTP 429 dừng và giữ Retry-After; không vòng qua hạn chế. Standard Ebooks website không lấy /text hoặc /downloads; dùng kho GitHub chính thức đã công bố CC0, pin commit. Không đăng nhập, vượt paywall/DRM hoặc dùng proxy. robots được lưu trong rights/.\n\nAttribution công khai dự kiến: authorName + description chứa nguyên tác, nguồn, tình trạng quyền, credit scan; Chapter title giữ tên/ngày nguồn. COMIC giữ nguyên chữ ký/credit trong ảnh. Không mạo nhận dự án là tác giả nguyên tác; không chỉnh sửa lời thoại/nội dung lịch sử. Cần chủ dự án duyệt nội dung và chất lượng scan trước nhập; một số tranh báo cổ có định kiến của thời đại.\n\n";
let html =
  '<!doctype html><html lang="vi"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>WebNovel — duyệt 15 tác phẩm mới</title><style>body{margin:0;background:#f5f0e7;color:#192e3c;font:16px/1.65 system-ui}main{max-width:1220px;margin:auto;padding:30px 22px}h1,h2,h3{line-height:1.25}a{color:#176257;overflow-wrap:anywhere}.badge{display:inline-block;background:#dfebdf;border-radius:20px;padding:4px 12px;font-size:13px}.note{padding:18px;background:#fff3cc;border-left:5px solid #ae7a21}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:24px}.card{background:#fff;padding:14px;border-radius:10px}.card img{width:100%;height:230px;object-fit:contain;background:#ede8dd}section{margin:35px 0;background:white;padding:26px;border-radius:14px}details{margin:10px 0;border-top:1px solid #ddd;padding-top:10px}summary{cursor:pointer}img.page{display:block;max-width:100%;height:auto;margin:18px auto}.meta{color:#536167}pre{white-space:pre-wrap;overflow-wrap:anywhere}table{border-collapse:collapse;width:100%}td,th{padding:9px;border:1px solid #ddd;text-align:left}</style><main><span class="badge">STAGING ONLY · CHỜ DUYỆT</span><h1>15 tác phẩm mới cho WebNovel</h1><p class="note">Chưa import Database, chưa upload Cloudinary, chưa publish. Đích dự kiến: webnovel_db/public. NOVEL tiếng Anh, nhãn tiếng Việt. COMIC là tranh báo cổ nguyên bản, không phải manga hiện đại. Phạm vi hoàn chỉnh của mỗi bộ được ghi riêng.</p><p><a href="CATALOG-REVIEW.md">Danh mục</a> · <a href="SOURCES.md">Nguồn và quyền</a> · <a href="IMPORT-PLAN.md">Kế hoạch nhập</a></p><p>' +
  counts.chapters +
  " mục đọc · " +
  pages +
  " trang COMIC · " +
  counts.images +
  " ảnh · " +
  (counts.imageBytes / 1048576).toFixed(2) +
  ' MiB upload dự kiến</p><div class="grid">';
for (const s of m.stories) {
  const cover = assets.get(s.cover);
  html +=
    '<a class="card" href="#' +
    s.key +
    '"><img src="' +
    esc(cover.path) +
    '" alt="Bìa ' +
    esc(s.title) +
    '"><h3>' +
    esc(s.title) +
    '</h3><span class="meta">' +
    esc(s.authorName) +
    "<br>" +
    s.type +
    " · " +
    s.chapters.length +
    " mục đọc</span></a>";
}
html += "</div>";
for (const s of m.stories) {
  const n = s.chapters.reduce((n, c) => n + c.pages.length, 0);
  const license =
    s.type === "NOVEL"
      ? "Nguyên tác PD tại VN; biên tập CC0; bìa mới CC0"
      : "Nguyên tác PD tại VN; scan cho phép tái sử dụng";
  md +=
    "| " +
    s.type +
    " | " +
    s.title +
    " / " +
    s.originalTitle +
    " | " +
    s.authorName +
    " | " +
    s.chapters.length +
    " / " +
    n +
    " | en | [Nguồn](" +
    s.sourceUrl +
    ") | " +
    license +
    " |\n";
  sources +=
    "## " +
    s.title +
    " — " +
    s.originalTitle +
    "\n\n- Tác giả: " +
    s.authorName +
    "; mất " +
    s.authorDeathYear +
    ". Thời hạn đời tác giả + 50 kết thúc cuối năm " +
    s.rights.termEndVietnam +
    ".\n- Định danh nguồn: " +
    s.sourceId +
    "\n- Nguồn: " +
    s.sourceUrl +
    "\n- Attribution dự kiến: " +
    s.description +
    "\n- Phạm vi: " +
    s.completeness +
    "\n" +
    (s.type === "NOVEL"
      ? "- Commit ấn bản: " +
        s.editionCommit +
        "\n- Giấy phép: " +
        s.rights.licenseUrl +
        "\n- Bìa: thiết kế hình học mới, CC0; không phải bìa nguyên tác.\n"
      : "- Giấy phép scan/đồng ý tái sử dụng: " +
        s.rights.archive +
        "\n- Ngày công bố từng scan và credit Barnacle Press trong manifest.\n") +
    "\n";
  html +=
    '<section id="' +
    s.key +
    '"><h2>' +
    esc(s.title) +
    "</h2><p><strong>" +
    esc(s.originalTitle) +
    "</strong> — " +
    esc(s.authorName) +
    "</p><p>" +
    esc(s.description) +
    "</p><p><strong>Phạm vi:</strong> " +
    esc(s.completeness) +
    '</p><p><a href="' +
    esc(s.sourceUrl) +
    '">Nguồn chính thức/kho lưu trữ</a> · ' +
    esc(license) +
    "</p><p>" +
    esc(s.genres.join(" · ")) +
    " · " +
    s.chapters.length +
    " mục đọc" +
    (n ? " · " + n + " trang tranh" : "") +
    "</p>";
  for (const c of s.chapters) {
    sources +=
      "### " +
      c.number +
      ". " +
      c.title +
      "\n\n- Source ID: " +
      c.sourceId +
      "\n";
    html +=
      "<details><summary>" + c.number + ". " + esc(c.title) + "</summary>";
    if (c.content) {
      const b = await fs.readFile(path.join(root, c.content.path), "utf8");
      sources +=
        "- Text: " +
        c.content.path +
        "; " +
        c.content.bytes +
        " byte; SHA-256 " +
        c.content.sha256 +
        "\n- XHTML: " +
        c.source.path +
        "; SHA-256 " +
        c.source.sha256 +
        "\n";
      html +=
        '<p><a href="' +
        esc(c.content.path) +
        '">Đọc toàn bộ mục này</a> · <a href="' +
        esc(c.source.path) +
        '">Đối chiếu XHTML gốc</a></p><pre>' +
        esc(b.slice(0, 1800)) +
        (b.length > 1800 ? "…" : "") +
        "</pre>";
      if (c.inlineImages?.length)
        html +=
          "<p>Ảnh minh họa nội tuyến được lưu trong nguồn, chưa hỗ trợ hiển thị trong reader NOVEL văn bản.</p>";
    } else
      for (const k of c.pages) {
        const a = assets.get(k);
        sources +=
          "- Trang: " +
          a.path +
          "; " +
          a.bytes +
          " byte; " +
          a.width +
          "×" +
          a.height +
          "; SHA-256 " +
          a.sha256 +
          "\n  - Ngày: " +
          a.publicationDate +
          "; tác giả " +
          a.author +
          "; scan courtesy " +
          a.scanCredit +
          "\n  - URL file: " +
          a.downloadUrl +
          "\n  - Quyền: " +
          a.license +
          "; " +
          a.rightsUrl +
          "\n";
        html +=
          '<a href="' +
          esc(a.path) +
          '"><img class="page" loading="lazy" src="' +
          esc(a.path) +
          '" alt="' +
          esc(c.title) +
          '"></a><p class="meta">' +
          a.width +
          "×" +
          a.height +
          " · " +
          a.bytes +
          " byte · " +
          esc(a.author) +
          " · scan courtesy Barnacle Press</p>";
      }
    sources += "\n";
    html += "</details>";
  }
  html += "</section>";
}
md +=
  "\n## Thống kê dự kiến (chưa ghi)\n\n```json\n" +
  JSON.stringify(counts, null, 2) +
  "\n```\n\nHash manifest: `" +
  planHash +
  "`. Số Genre mới phải đối chiếu preflight.json; các số ở đây là số định nghĩa thể loại trong bundle. Bốn COMIC ngoài Explorigator không được tuyên bố trọn bộ lịch sử; Alphonse có hai trang crossover loại khỏi nhập để kiểm tra riêng quyền đồng tác giả và phạm vi tác phẩm.\n";
for (const work of m.stories)
  sources +=
    "\n- Hồ sơ tác giả " +
    work.authorName +
    ": " +
    work.rights.authority.url +
    "\n";
if (m.excludedAssets?.length) {
  const note =
    "Có " +
    m.excludedAssets.length +
    " trang crossover loại khỏi danh sách import để kiểm tra quyền/phạm vi riêng. Không upload các file này.";
  md += "\n## Trang bị loại\n\n" + note + "\n";
  sources += "\n## Trang bị loại — KHÔNG UPLOAD/IMPORT\n\n";
  html +=
    '<section class="note"><h2>Trang bị loại khỏi nhập</h2><p>' +
    esc(note) +
    "</p>";
  for (const a of m.excludedAssets) {
    const line = a.path + " — " + a.author + "; " + a.reason;
    md += "- " + line + "\n";
    sources += "- " + line + "; SHA-256 " + a.sha256 + "\n";
    html +=
      "<p>" +
      esc(line) +
      '</p><a href="' +
      esc(a.path) +
      '">Xem file cục bộ để kiểm tra, không nằm trong danh sách upload</a>';
  }
  html += "</section>";
}
sources +=
  "\nGhi nhận quy trình và ngoại lệ metadata authority ban đầu: [COLLECTION-NOTES.md](rights/COLLECTION-NOTES.md). Ứng viên Việt chưa chọn: [VIETNAMESE-CANDIDATES.md](rights/VIETNAMESE-CANDIDATES.md).\n\n";
sources += "## Toàn bộ file ảnh, kể cả bìa\n\n";
for (const a of m.assets)
  sources +=
    "- " +
    a.path +
    " — " +
    a.author +
    "; " +
    a.license +
    "; " +
    a.bytes +
    " byte; SHA-256 " +
    a.sha256 +
    "; nguồn " +
    a.sourceUrl +
    "\n";
await fs.writeFile(path.join(root, "CATALOG-REVIEW.md"), md);
await fs.writeFile(path.join(root, "SOURCES.md"), sources);
await fs.writeFile(
  path.join(root, "review.html"),
  html + "<footer>Manifest SHA-256: " + planHash + "</footer></main></html>",
);
console.log("Review artifacts generated locally.", counts);
