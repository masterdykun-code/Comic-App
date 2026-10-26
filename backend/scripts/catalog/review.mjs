import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../catalog/sample-library-v1",
);
const m = JSON.parse(
  await fs.readFile(path.join(root, "manifest.json"), "utf8"),
);
const esc = (s) =>
  String(s ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
const link = (url) =>
  /^https:\/\//.test(url) ? `<a href="${esc(url)}">${esc(url)}</a>` : esc(url);
let md =
  "# Nguồn và giấy phép — sample-library-v1\n\nDanh mục đã chốt, không phải tuyên bố mọi bản tái bản hiện đại đều được dùng.\n\n";
let html =
  '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Duyệt thư viện mẫu WebNovel</title><style>body{font:17px/1.65 system-ui;background:#f7f3ea;color:#1a2733;max-width:1250px;margin:40px auto;padding:0 22px}h1,h2{line-height:1.3}section{background:white;padding:26px;margin:26px 0;border-radius:14px}img{max-width:100%;height:auto}.cover{max-width:230px;max-height:340px;object-fit:contain}.pages{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:20px}a{overflow-wrap:anywhere}pre{white-space:pre-wrap}.note{border-left:4px solid #16786b;padding-left:16px}</style><h1>10 truyện mẫu — chờ duyệt nhập Database chính</h1><p class="note">Chỉ file cục bộ; chưa import PostgreSQL hoặc upload Cloudinary. NOVEL nguyên bản tiếng Anh; nhãn tiếng Việt. COMIC cổ chia nhóm tuyển chọn, không giả chương nguyên tác. Mở từng ảnh để xem rõ trước khi duyệt.</p>';
for (const s of m.stories) {
  const cover = m.assets.find((a) => a.key === s.cover);
  md += `## ${s.title}\n\n- Loại/ngôn ngữ: ${s.type}/${s.language}\n- Tác giả: ${s.authorName}${s.authorDied ? ` (mất ${s.authorDied})` : ""}\n- Nguồn: ${s.sourceUrl}\n- Quyền: ${s.license}\n- Thay đổi: ${s.type === "NOVEL" ? "Trích ba chương đầu; chuyển XHTML thành văn bản, giữ đoạn/xuống dòng; bìa mới hình học CC0." : "Ảnh giữ nguyên byte; chỉ tuyển chọn, đánh số trang và nhóm chương; giữ credits."}\n${s.editionCommit ? `- Commit ấn bản: ${s.editionCommit}\n- Giấy phép lưu: sources/${s.key}/LICENSE.md\n` : ""}\n`;
  html += `<section><h2>${esc(s.title)}</h2><img class="cover" src="${esc(cover.path)}"><p>${esc(s.authorName)} · ${esc(s.type)} · ${esc(s.language)}</p><p>${esc(s.description)}</p><p>${link(s.sourceUrl)}</p>`;
  for (const c of s.chapters) {
    md += `### ${c.number}. ${c.title}\n\n`;
    html += `<details><summary>${c.number}. ${esc(c.title)} — ${c.pages.length || "văn bản"} trang</summary>`;
    if (c.content) {
      const text = await fs.readFile(path.join(root, c.content.path), "utf8");
      md += `- Văn bản: ${c.content.path}\n- SHA-256: ${c.content.sha256}\n- Nguồn: ${c.sourceUrl}\n\n`;
      html += `<p><a href="${esc(c.content.path)}">Mở toàn văn chương</a></p><pre>${esc(text.slice(0, 700))}…</pre>`;
    } else {
      html += '<div class="pages">';
      for (const key of c.pages) {
        const a = m.assets.find((a) => a.key === key);
        md += `- ${key}: ${a.sourceUrl}\n  - Tác giả/credits: ${a.author}\n  - Giấy phép: ${a.license}\n  - File: ${a.path}; SHA-256: ${a.sha256}\n`;
        html += `<figure><a href="${esc(a.path)}"><img loading="lazy" src="${esc(a.path)}"></a><figcaption>${esc(a.key)}<br>${esc(a.author)}<br>${esc(a.license)}<br>${link(a.sourceUrl)}</figcaption></figure>`;
      }
      html += "</div>";
    }
    html += "</details>";
  }
  html += "</section>";
}
md += "\n## Bìa và tài sản ảnh\n\n";
for (const a of m.assets)
  md += `- ${a.key}: ${a.path}\n  - ${a.author}; ${a.license}\n  - Nguồn: ${a.sourceUrl}\n  - SHA-256: ${a.sha256}\n`;
await fs.writeFile(path.join(root, "SOURCES.md"), md);
await fs.writeFile(path.join(root, "review.html"), html + "</html>");
console.log(
  "Prepared local SOURCES.md and review.html; no network or database writes.",
);
