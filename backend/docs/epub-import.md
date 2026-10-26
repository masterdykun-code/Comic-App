# Nhập NOVEL từ EPUB

Admin Web → Quản lý truyện → **Nhập EPUB** (`/stories/import-epub`). Chọn file, đọc xem trước, chỉnh metadata/chọn thể loại nếu cần rồi bấm nhập. Story và tất cả Chapter luôn DRAFT; không tự publish, không gọi Cloudinary. Không tự giải mã DRM hoặc xác nhận quyền phân phối.

Giới hạn: một EPUB/request, 25 MiB; tối đa 5.000 ZIP entry/64 MiB giải nén, 2.000 chương/32 MiB text; mỗi chương <=200.000 UTF-16 code units. Kiểm tra CRC, path traversal, symlink, file mã hóa, DTD entity và UTF-8. Không tải DTD/font/ảnh ngoài. Mục lục/spine quyết định thứ tự; khi TOC bao phủ phần lớn spine thì loại tài liệu ngoài TOC; các tài liệu bìa/mục lục và không chữ được bỏ qua có cảnh báo. Cần xem trước vì cấu trúc EPUB mỗi nguồn khác nhau. Giữ văn bản, đoạn/br; bỏ HTML thực thi và heading đầu trang lặp chính xác. Không sửa chính tả hoặc viết thêm nội dung.

API chỉ ADMIN ACTIVE:

- `POST /api/admin/epub-imports/preview` — multipart field `file`; chỉ phân tích, chưa ghi Database. Trả previewId, metadata, danh sách chương, sample và bìa raster data URL đã giải mã kiểm tra.
- `POST /api/admin/epub-imports/:id/confirm` — `{title,authorName,description,genreIds,useCover}`. Chỉ nhận metadata, không nhận nội dung chương từ client. Transaction tạo Story/Chapter/StoryGenre mới; không update/delete/upsert truyện cũ. Kiểm tra ADMIN ACTIVE lại trong transaction.
- `GET /api/admin/epub-imports/:id` — kiểm tra `ready/pending/imported/unknown` và kết quả sau lỗi mạng; không tự replay POST.
- `DELETE /api/admin/epub-imports/:id` — hủy xem trước, không xóa truyện đã nhập.

Preview gắn với đúng ADMIN, sống 15 phút trong RAM; mất khi restart Backend. Tối đa hai preview/ADMIN, bốn preview toàn hệ thống, 64 MiB nội dung được giữ; một lượt giải nén tại mỗi router. Chống gửi lặp bằng trạng thái preview và transaction advisory lock; ID Story ổn định theo hash metadata nguồn+nội dung, cùng kiểm tra title/slug và unique constraint. Nhập trùng trả 409, không ghi đè. Kết quả DB không rõ thì khóa preview và yêu cầu kiểm tra danh sách trước.

Bìa JPEG/PNG/WebP tĩnh <=5 MiB/16 MP lưu ở `backend/storage/epub-covers` (Git ignore). `GET /api/epub-covers/:storyId`: nháp chỉ ADMIN, đã xuất bản có thể đọc công khai. Admin Web lấy bìa nháp bằng authenticated blob request. Bìa không hợp lệ/SVG bị bỏ qua và báo cảnh báo. Không có chức năng xóa ảnh trong bước này. Có thể còn file ảnh nếu transaction lỗi; giữ lại thay vì tự xóa khi kết quả commit chưa rõ. Khi backup ứng dụng phải backup cả thư mục ảnh.

Để Mobile đọc URL bìa qua LAN, đặt `EPUB_PUBLIC_BASE_URL=http://<IPv4-máy-tính>:4000` trong `.env` rồi restart Backend; production dùng origin HTTPS tương ứng. Nếu không đặt, dùng origin của request ADMIN lúc xác nhận. Không đưa `/api` vào biến này. Không nhúng secret vào cấu hình public.

Test mock: `npm run test:epub`. Kiểm thử transaction PostgreSQL riêng, giữ dữ liệu demo có sẵn: `npx tsx --test tests/integration/epub-import.postgres.test.ts` (đọc `.env.integration`, chỉ webnovel_test_db/public, tạo/dọn đúng fixture ngẫu nhiên). Không chạy runner reset hoặc xóa dữ liệu test đang dùng.

Không sửa schema/migration. Đợt triển khai chỉ đọc hai EPUB có sẵn để kiểm tra parser; không nhập lại tác phẩm trong Database chính.

## Kết quả xác minh triển khai

- Backend typecheck/build: đạt; 10/10 test EPUB mock/HTTP đạt.
- PostgreSQL: 1/1 test transaction/rollback/chống trùng đạt trên `webnovel_test_db`, chỉ tạo và dọn fixture riêng của bài test.
- Admin Web typecheck/lint/format/build: đạt; 144/144 unit/UI test và 12/12 Chromium test đạt. Chromium mock toàn bộ API, không nhập sách thật.
- Backend `npm test` đầy đủ: 241/245 đạt ở lượt cuối. Ba bài cũ bắt buộc Database không có Stories/Chapters/Genres thất bại vì thư viện đang có nội dung; không xóa dữ liệu để thỏa điều kiện test. Một bài Reading thất bại do Node fetch gặp cổng ngẫu nhiên bị chặn (`bad port`); chạy riêng bộ Reading đạt 39/39.
- Chạy lại các test Backend, loại ba bài có tiền điều kiện Database trống: 244 kết quả đạt, không lỗi (Node tính cả file khi toàn bộ test con bị lọc). Không thay đổi lệnh `npm test` mặc định hoặc sửa test cũ để che lỗi.
- Health Backend đang chạy trên cổng 4000 trả 200; route preview EPUB không đăng nhập trả 401.
- Build Frontend còn cảnh báo bundle hơn 500 kB; build vẫn thành công.

Các file chính: `src/services/epub.parser.ts`, `epub-import.service.ts`, `epub-import.store.ts`, `src/controllers/epub-import.controller.ts`, `src/routes/epub-import.routes.ts`, đăng ký tại `src/app.ts`; trang Admin `src/features/stories/EpubImportPage.tsx`, `epub-api.ts`, `epub.css`, route, nút Stories và hiển thị bìa có xác thực. Thêm dependency ZIP/XML và fixture ZIP; không sửa Mobile hoặc Prisma schema.
