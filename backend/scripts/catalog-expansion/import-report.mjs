// Produce a local report only after all read-only verification steps pass.
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = fileURLToPath(
  new URL("../../catalog/library-expansion-v2/", import.meta.url),
);
const read = async (name) =>
  JSON.parse(await fs.readFile(path.join(root, name), "utf8"));
const m = await read("manifest.json");
const before = await read("dry-run-before-import.json");
const v = await read("import-verification.json");
const after = await read("dry-run-after-import.json");
if (
  v.status !== "VERIFIED_SUCCESS" ||
  !v.allExistingRowsUnchanged ||
  after.totalNewRows !== 0 ||
  after.counts.images !== 0 ||
  after.counts.skippedStories !== 15 ||
  after.manifestSha256 !== before.manifestSha256 ||
  v.manifestSha256 !== before.manifestSha256
)
  throw Error(
    "Complete verification and zero-create dry-run required; no report generated.",
  );
const images = new Map(v.imageUploads.map((a) => [a.key, a]));
const safe = (s) => String(s).replaceAll("|", "\\|").replaceAll("\n", " ");
let md = `# Báo cáo import library-expansion-v2\n\n**ĐÃ COMMIT VÀ XÁC MINH THÀNH CÔNG.**\n\nThời điểm lập báo cáo: ${new Intl.DateTimeFormat("vi-VN", { dateStyle: "full", timeStyle: "long", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date())}.\n\nĐích SQL xác minh: **webnovel_db/public**. Manifest SHA-256: \`${v.manifestSha256}\`. Danh mục, nguyên văn tiếng Anh, nhãn tiếng Việt, nguồn và attribution giữ nguyên bản phê duyệt. Hai crossover đã thống nhất vẫn bị loại.\n\n## Số bản ghi thực tế\n\n| Loại | Duyệt / dry-run | Tạo thực tế |\n|---|---:|---:|\n| Story | 15 | ${v.actualCreated.stories} (10 NOVEL + 5 COMIC) |\n| Chapter | 482 | ${v.actualCreated.chapters} |\n| ChapterPage | 157 | ${v.actualCreated.chapterPages} |\n| Genre | 8 | ${v.actualCreated.genres} |\n| StoryGenre | 23 | ${v.actualCreated.storyGenres} |\n| Tổng hàng | 685 | ${v.actualCreated.totalRows} |\n\nPublication đã xác minh bằng SQL: **${v.publication.publishedStories}/15 Story và ${v.publication.publishedChapters}/482 Chapter PUBLISHED**.\n\n## Backup và bảo vệ dữ liệu cũ\n\nBackup trước import, đã xác minh lại trước upload: \`${before.backup.proofPath}\`. Archive ${before.backup.archiveBytes} byte; SHA-256 \`${before.backup.archiveSha256}\`. Đã kiểm tra mục lục và giải mã toàn bộ archive; **không restore vào Database nào**, không tuyên bố đã diễn tập phục hồi.\n\nSau import đã có thêm backup hiện trạng để dry-run kiểm tra fingerprint mới: \`${after.backup.proofPath}\`. Không thay proof của backup trước import; bằng chứng gốc giữ trong dry-run-before-import.json.\n\nĐối chiếu mọi hàng cũ với snapshot của backup trước import bằng fingerprint tính trong PostgreSQL, loại đúng các UUID mới khỏi tập so sánh: **toàn bộ hàng cũ giữ nguyên**. Không trả passwordHash/token ra ngoài SQL.\n\n| Bảng | Hàng trước import giữ nguyên | Tổng hàng sau import |\n|---|---:|---:|\n`;
for (const [table, row] of Object.entries(v.existingRows))
  md += `| ${table} | ${row.count} | ${v.tableTotals[table]} |\n`;
md += `\nMigration/schema giữ nguyên; migration fingerprint không đổi. Không kết nối webnovel_test_db; không tạo/nâng quyền tài khoản. Transaction create-only SERIALIZABLE, khóa advisory và file lock được giữ khi chạy; ledger hiện committed. Không chạy lại apply.\n\n## Cloudinary\n\n- **${v.completedUploadReceipts}/167 receipt complete**, ${v.imageUploads.length}/167 URL HTTPS trả HTTP 200 với Content-Type ảnh.\n- Tổng dữ liệu ảnh nguồn: **75.885.834 byte (~72,37 MiB)**; đây là dung lượng nguồn upload, không phải số đo lưu trữ sau xử lý Cloudinary.\n- Folder: \`webnovel/library-expansion/v2\`; publicId theo SHA-256, overwrite=false, gửi tuần tự. Bìa COMIC dùng lại trang đầu.\n- Không upload lại, không xóa ảnh Cloudinary. Danh sách đầy đủ secureUrl/publicId/HTTP status của 167 ảnh ở import-verification.json.\n- Loại khỏi import/upload: \`alphonse-gaston-ag020928b\`, \`alphonse-gaston-ag030208b\`. Không phát sinh ảnh khác ngoài danh mục đã duyệt.\n\n## 15 tác phẩm vừa nhập\n\n| Loại | Tác phẩm | Tác giả | Chapter | Page | Bìa |\n|---|---|---|---:|---:|---|\n`;
for (const s of m.stories)
  md += `| ${s.type} | ${safe(s.title)} / ${safe(s.originalTitle)} | ${safe(s.authorName)} | ${s.chapters.length} | ${s.chapters.reduce((n, c) => n + c.pages.length, 0)} | [HTTPS 200](${images.get(s.cover).secureUrl}) |\n`;
md += `\n## Nội dung, thứ tự và API Backend chính\n\n- SQL đối chiếu metadata/ghi công, toàn bộ 325 mục NOVEL với text nguồn và 157 trang COMIC với thứ tự/publicId/URL trong receipt: đạt.\n- Health: HTTP ${v.apiChecks.healthHTTP}; Stories list: HTTP ${v.apiChecks.storiesListHTTP}, tìm thấy đủ 15 ID mới; tổng truyện công khai hiện tại ${v.apiChecks.publicStoriesTotal}.\n- ${v.apiChecks.storyDetailsHTTP200}/15 API chi tiết Story, ${v.apiChecks.chapterListsHTTP200}/15 API danh sách chương, ${v.apiChecks.chapterReadsHTTP200}/482 API đọc chương đều HTTP 200; so khớp nguyên văn NOVEL, thứ tự và URL ảnh COMIC.\n- API được gọi bằng GET không Authorization tại \`${v.apiChecks.baseURL}\`; không POST/PATCH Rating, Comment, History hoặc Progress. Không khởi động thêm Backend.\n\n## Chạy lại dry-run sau import\n\n\`npm run catalog:v2:dry-run\` đã chạy sau khi tạo backup hiện trạng: **15 truyện được nhận diện qua ledger và bỏ qua; 0 hàng cần tạo, 0 ảnh cần upload**. Toàn bộ kiểm tra chống trùng và fingerprint vẫn bật. Không chạy lại import thực tế.\n\n## File và bằng chứng\n\n- [dry-run-before-import.json](dry-run-before-import.json): phạm vi/backup trước lần ghi.\n- [import-verification.json](import-verification.json): SQL, bảo toàn hàng cũ, 167 URL/publicId, API.\n- [dry-run-after-import.json](dry-run-after-import.json): 0 hàng/0 ảnh, skip 15.\n- [SOURCES.md](SOURCES.md): nguồn và attribution đã duyệt; không thay nguồn.\n- src/scripts/verify-library-expansion.ts: verifier chỉ đọc, không có upload/DB write.\n- scripts/catalog-expansion/import-report.mjs: tạo báo cáo cục bộ từ bằng chứng đã đạt.\n- .import-state/ledger.json và receipts: giữ ngoài Git theo .gitignore; không sửa/xóa thủ công.\n\nKhông phát hiện sai lệch phạm vi hoặc lỗi trong lần import/kiểm tra này. Giới hạn nội dung giữ nguyên: bốn bộ COMIC là tuyển tập khả dụng tại nguồn; chỉ Explorigator được nguồn mô tả full run. Không coi các tuyển tập còn lại là trọn bộ lịch sử.\n`;
await fs.writeFile(path.join(root, "IMPORT-REPORT.md"), md);
console.log(
  "Local complete import report generated; no database or Cloudinary operations.",
);
