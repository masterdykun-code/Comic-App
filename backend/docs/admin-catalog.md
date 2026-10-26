# Bước 14.4 — Genres ADMIN và danh sách Comments

Không đổi Prisma Schema, migration, Authentication hoặc API Genres công khai.
Tái sử dụng Prisma Client, error handler và middleware xác thực hiện có.

## Hợp đồng HTTP

Tất cả API bên dưới yêu cầu Bearer token của ADMIN ACTIVE và trả `Cache-Control: no-store`.

| API | Đầu vào | Kết quả |
| --- | --- | --- |
| POST `/api/admin/genres` | `{name, slug}` | 201, `{success, message, data: {id,name,slug,createdAt}}` |
| PATCH `/api/admin/genres/:id` | Một hoặc cả hai trường name/slug | 200, cùng cấu trúc Genre |
| DELETE `/api/admin/genres/:id` | Không có body/query | 200, `data: {id,removed:true}` |
| GET `/api/admin/comments` | Các query bên dưới | 200, `{success,message,data:[],pagination}` |
| PATCH `/api/admin/comments/:id/moderate` | `{status: "VISIBLE" hoặc "HIDDEN"}` | API có sẵn, 200 với id/storyId/status/updatedAt |

Guest 401, USER 403; input sai 400, thiếu Genre/Comment 404, trùng hoặc xung đột 409,
quá hạn mức 429. Error handler không trả thông tin driver hoặc stack trace.

Genre name được trim, chuẩn hóa NFC, 1–100 ký tự, không chứa control/HTML hoặc chỉ ký tự
vô hình. Giữ nguyên hoa/thường của tên; PostgreSQL quyết định tính unique theo collation
hiện tại. Slug trim/lowercase, 1–120 ký tự, chỉ `a-z`, số và dấu `-` giữa các từ.
Các giới hạn này là chính sách đầu vào; cột Prisma String hiện tại không có giới hạn độ dài.
Body strict, không nhận id/createdAt/role hoặc trường khác. PATCH không được rỗng.

## Xóa Genre an toàn

StoryGenre có khóa chính `(storyId, genreId)` và FK Genre `onDelete: Restrict`.
Trong transaction Serializable, kiểm tra ADMIN, khóa hàng Genre bằng `FOR UPDATE`,
kiểm tra StoryGenre.count, rồi mới xóa Genre. Có liên kết trả `409 GENRE_IN_USE`.
FK Restrict là chốt chặn nếu có liên kết đồng thời; P2003 cũng chuyển thành 409.
Không gọi delete/deleteMany trên StoryGenre và không thay đổi Story.
Transaction conflict retry tối đa ba lần rồi trả `GENRE_WRITE_CONFLICT`; rollback do Prisma.

## Danh sách bình luận quản trị

- `page`: mặc định 1; `limit`: mặc định 20, tối đa 100; offset giới hạn int32.
- `sort`: newest (mặc định) hoặc oldest; thứ tự phụ theo UUID ổn định.
- `storyId`, `parentId`: UUID tùy chọn; `status`: VISIBLE hoặc HIDDEN.
- Bộ lọc kết hợp AND; không có kết quả trả mảng rỗng với totalPages=0.
- Query lặp, trường lạ, UUID hoặc phân trang sai trả 400.
- COUNT và SELECT chạy cùng snapshot RepeatableRead, không sửa dữ liệu.
- Trả id/storyId/parentId/content/status/createdAt/updatedAt/replyCount;
  user chỉ có username/displayName/avatarUrl; story có id/title/slug/publishStatus;
  parent có id/status và cùng whitelist user. Không trả email/passwordHash/token.
- Hiển thị cả bình luận của truyện DRAFT và bình luận HIDDEN trong ADMIN.
- HIDDEN root vẫn che các reply VISIBLE qua API công khai. Hiện reply không tự hiện root,
  hiện bình luận không tự xuất bản Story. Quy tắc công khai hiện có giữ nguyên.

Chưa có tìm kiếm toàn văn: schema không có index nội dung, nên không bổ sung scan nội
dung hoặc sửa schema trong bước này. List không lọc có thể cần index bổ sung nếu dữ liệu
lớn; kiểm tra query plan trước khi tối ưu ở một bước được phê duyệt sau.
Moderation tái sử dụng transaction/advisory lock hiện có; không thêm expectedUpdatedAt.
Hai ADMIN có thể tuần tự ghi trạng thái, trạng thái cuối cùng theo lần ghi sau.

Rate limit theo IP dùng cơ chế in-memory hiện có: Genres 60/phút chung cho writes,
Comments list 120/phút, moderation 60/phút. Khi triển khai nhiều process cần shared store.

## File

Tạo:

- `src/types/admin-genre.types.ts`, `src/types/admin-comment.types.ts`
- `src/middlewares/admin-genre.validation.ts`, `src/middlewares/admin-comment.validation.ts`
- `src/services/admin-genre.store.ts`, `src/services/admin-genre.service.ts`
- `src/services/admin-comment.store.ts`, `src/services/admin-comment.service.ts`
- `src/controllers/admin-genre.controller.ts`, `src/routes/admin-genre.routes.ts`
- `tests/admin-catalog.test.ts`, `tests/admin-catalog.store.test.ts`, tài liệu này.

Sửa: `src/app.ts`, `src/controllers/comment.controller.ts`, `src/routes/comment.routes.ts`,
`package.json` (bổ sung hai test mới vào npm test).

## Kiểm tra

Backend typecheck/build thành công; npm test **260/260 đạt** (bao gồm 13 test mới).
Test mới dùng memory stores và Prisma mock, không ghi PostgreSQL. Các DB smoke test
có sẵn trong npm test chỉ đọc. Prisma Validate hợp lệ; Migration Status báo hai migration
đã đồng bộ trên webnovel_db. Không chạy integration test ghi, seed, migrate deploy/dev,
db push, reset hoặc gọi Cloudinary thật.
