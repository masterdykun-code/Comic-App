# Module Stories

## File tạo/sửa

Tạo mới (đường dẫn tương đối từ backend):
- `src/routes/story.routes.ts`
- `src/controllers/story.controller.ts`
- `src/services/story.service.ts`, `src/services/story.store.ts`
- `src/middlewares/story.validation.ts`
- `src/types/story.types.ts`
- `tests/stories.test.ts`, `tests/stories.db.test.ts`
- `tests/helpers/memory-story.store.ts`
- `docs/stories.md`

Chỉnh sửa: `src/app.ts` (mount router), `package.json` (scripts test).
Không sửa Authentication, Prisma Schema, migration hoặc dữ liệu PostgreSQL.
Generate/build cập nhật các artifact bị Git bỏ qua.

## API

| Method | Đường dẫn | Quyền | Chức năng |
| --- | --- | --- | --- |
| GET | `/api/stories` | Công khai | Truyện PUBLISHED, lọc và phân trang |
| GET | `/api/stories/:id` | Công khai | Metadata và thể loại của truyện PUBLISHED |
| POST | `/api/stories` | ADMIN ACTIVE | Tạo truyện DRAFT |
| PATCH | `/api/stories/:id` | ADMIN ACTIVE | Sửa metadata, thay danh sách thể loại |
| PATCH | `/api/stories/:id/publish` | ADMIN ACTIVE | Xuất bản truyện, không sửa chương |
| GET | `/api/admin/stories` | ADMIN ACTIVE | Cả DRAFT/PUBLISHED, lọc và phân trang |
| GET | `/api/admin/stories/:id` | ADMIN ACTIVE | Chi tiết cả DRAFT/PUBLISHED, gồm createdBy và chapterCount |

API quản trị dùng `Authorization: Bearer <accessToken>` và trả
`Cache-Control: no-store`. Tái sử dụng authenticate/authorizeRole và kiểm tra lại
ADMIN ACTIVE trong transaction ghi. Đã bổ sung ẩn/xóa có xác nhận tại `/api/admin/stories/:id/unpublish` và `/api/admin/stories/:id`; xem [story-lifecycle.md](story-lifecycle.md). API chương được mô tả trong module Chapters.

API chi tiết ADMIN bổ sung ở Bước 14.2 dùng cùng authenticate/authorizeRole và
kiểm tra lại ADMIN ACTIVE trong transaction đọc. UUID sai trả 400, truyện không
tồn tại trả 404, Guest 401, USER 403, tài khoản BANNED 401. Không đổi hành vi của
GET chi tiết công khai; không truy xuất passwordHash hoặc nội dung chương.

Query danh sách:
- `page`: mặc định 1, số nguyên dương.
- `limit`: mặc định 20, từ 1–100; vượt 100 trả 400.
- `search`: chuỗi 1–200 ký tự sau trim, tìm substring tên truyện không phân biệt
  hoa thường. `%`, `_`, `\` được escape để tìm ký tự thật trong PostgreSQL LIKE.
- `type`: NOVEL/COMIC; `genreId`: UUID; `status`: ONGOING/COMPLETED.
- `sort`: newest (mặc định, createdAt giảm dần), updated (updatedAt giảm dần),
  title (title tăng dần). Luôn dùng id tăng dần làm khóa sắp xếp phụ.
- Chỉ danh sách ADMIN nhận thêm `publishStatus`: DRAFT/PUBLISHED.

Query không được hỗ trợ, query lặp, số thập phân, offset vượt PostgreSQL/Prisma
Int hoặc UUID sai trả 400. Genre filter không khớp trả danh sách rỗng.

Response danh sách:

```json
{
  "success": true,
  "message": "Stories retrieved successfully",
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 0, "totalPages": 0 }
}
```

Trang vượt tổng số trang trả `data: []` nhưng vẫn giữ tổng số kết quả thực tế.
Count và dữ liệu trang dùng cùng snapshot RepeatableRead. Metadata công khai
không có createdBy, chapterCount, chương/nội dung chương hoặc thông tin User.
Danh sách ADMIN có createdBy, publishStatus và chapterCount, không có nội dung
chương. Truyện DRAFT và ID không tồn tại cùng trả 404 tại endpoint công khai.

## Tạo và sửa

Body tạo: bắt buộc title (1–200), type (NOVEL/COMIC), authorName (1–100).
Tùy chọn description (0–10000), coverUrl (HTTP/HTTPS URL tối đa 2048 hoặc chuỗi
rỗng cho draft), status (mặc định ONGOING), genreIds (mảng tối đa 50 UUID).
Chuỗi văn bản được trim. Không chấp nhận trường lạ hoặc mass assignment.

createdBy lấy từ tài khoản đã xác thực, publishStatus luôn DRAFT. Các trường
description/coverUrl chưa cung cấp được lưu là chuỗi rỗng vì cột hiện tại NOT NULL.
UUID thể loại được chuẩn hóa lowercase trước khi kiểm tra trùng; toàn bộ ID phải
tồn tại. Dữ liệu truyện và liên kết thể loại ghi trong một transaction.

Slug tạo từ title, hỗ trợ bỏ dấu tiếng Việt, fallback `story` cho tên không có
ký tự ASCII. Unique index trong PostgreSQL là lớp bảo vệ cuối. Khi P2002 xảy ra,
retry toàn bộ transaction với hậu tố UUID ngẫu nhiên; không dựa vào một lần
check-then-insert. Khi sửa title, slug giữ nguyên để URL ổn định; client không
được tự sửa slug. Tối đa 5 lần thử; hết lượt trả 409.

Body PATCH có ít nhất một trường hợp lệ từ body tạo. Không nhận createdBy,
role, id, slug hoặc publishStatus. Không gửi genreIds thì giữ nguyên liên kết;
gửi [] xóa liên kết thể loại của draft; gửi danh sách mới thay toàn bộ liên kết
trong transaction. Lỗi sau khi thay quan hệ sẽ rollback cả metadata lẫn quan hệ.

Chỉ đổi type khi không có chương nào (kể cả chương DRAFT). Gửi lại cùng type
vẫn được phép. Transaction ghi Serializable có retry P2034, tối đa 5 lần;
xung đột kéo dài trả 409. Module Chapters hiện dùng cùng khóa parent Story trước
khóa Chapter; sửa/publish Stories cũng khóa Story trước khi đọc số chương/type.
Ghi chương cập nhật updatedAt của truyện để snapshot cũ retry khi cần. Writer mới
sau này phải tiếp tục dùng cơ chế phối hợp này; xem `chapters.md`.

## Xuất bản

PATCH publish nhận body rỗng `{}` hoặc không có body. Yêu cầu metadata hoàn chỉnh:
title, authorName, type/status hợp lệ, description không rỗng, coverUrl HTTP/HTTPS
hợp lệ và ít nhất một thể loại. Không yêu cầu đã có chương trong bước này.
Thiếu metadata trả 400 STORY_NOT_PUBLISHABLE; thiếu truyện trả 404. Gọi lại với
truyện đã PUBLISHED hợp lệ trả 200 (idempotent).

Chỉ cập nhật trạng thái truyện, không xuất bản chương DRAFT và không thao tác
content/pages. PATCH truyện đang PUBLISHED phải tiếp tục thỏa điều kiện metadata;
không thể xóa hết thể loại hoặc làm rỗng mô tả/ảnh bìa của truyện đang công khai.

## Kiểm thử và giới hạn

`npm run test:stories`: HTTP tests dùng store trong bộ nhớ và JWT/Argon2 thực;
tài khoản và truyện chỉ tồn tại trong bộ nhớ của process test. Có thêm test GET
với PostgreSQL trống, chỉ đọc và không seed/reset. Các suite hiện có vẫn chạy
qua `npm test`.

Kiểm thử rollback, slug collision và retry mô phỏng conflict qua store giao dịch.
Chưa có kiểm thử ghi/concurrency end-to-end với PostgreSQL test riêng. Việc đọc
có dữ liệu, lọc và phân trang đã được kiểm thử qua mock; PostgreSQL thật chỉ được
kiểm thử khi bảng stories đang trống. Không thêm dữ liệu thật để mở rộng coverage.

Tham khảo cơ chế transaction/retry Prisma 7:
[Prisma transactions](https://docs.prisma.io/docs/orm/v7/prisma-client/queries/transactions).
