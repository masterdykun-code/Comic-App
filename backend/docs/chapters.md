# Module Chapters

## File tạo/sửa

Tạo mới (đường dẫn tương đối từ backend):
- `src/routes/chapter.routes.ts`
- `src/controllers/chapter.controller.ts`
- `src/services/chapter.service.ts`, `src/services/chapter.store.ts`
- `src/middlewares/chapter.validation.ts`, `src/types/chapter.types.ts`
- `tests/chapters.test.ts`, `tests/chapters.db.test.ts`
- `tests/helpers/memory-chapter.store.ts`
- `docs/chapters.md`

Chỉnh sửa:
- `src/app.ts`: mount Chapters trước parser JSON chung.
- `package.json`: thêm test:chapters và đưa vào npm test.
- `src/types/story.types.ts`, `src/services/story.store.ts`,
  `src/services/story.service.ts`: phối hợp khóa truyện khi sửa/publish Stories.
- `tests/helpers/memory-story.store.ts`: thêm snapshot chương vào transaction
  mock để test chéo Stories/Chapters và rollback.
- `docs/stories.md`: cập nhật cơ chế phối hợp đã triển khai.

Không sửa schema/migration, Authentication hay dữ liệu PostgreSQL. Không thêm
dependency mới. Generate/build cập nhật các artifact đã được Git bỏ qua.

## API

| Method | Endpoint | Quyền |
| --- | --- | --- |
| GET | `/api/stories/:storyId/chapters` | Công khai |
| GET | `/api/chapters/:id` | Công khai |
| GET | `/api/admin/stories/:storyId/chapters` | ADMIN ACTIVE |
| GET | `/api/admin/chapters/:id` | ADMIN ACTIVE |
| POST | `/api/admin/stories/:storyId/chapters` | ADMIN ACTIVE |
| PATCH | `/api/admin/chapters/:id` | ADMIN ACTIVE |
| PUT | `/api/admin/chapters/:id/pages` | ADMIN ACTIVE |
| PATCH | `/api/admin/chapters/:id/publish` | ADMIN ACTIVE |

API quản trị tái sử dụng Bearer JWT, authenticate và authorizeRole('ADMIN').
Các phản hồi quản trị có Cache-Control: no-store. Service kiểm tra lại ADMIN
ACTIVE trong transaction. Không có API xóa chương hoặc thay storyId.

GET chi tiết ADMIN bổ sung tại Bước 14.3 theo xác nhận người dùng. Response
`data` gồm metadata, publishStatus, content, type và pages đầy đủ (gồm
storagePublicId), theo pageNumber tăng dần. Đọc được DRAFT và PUBLISHED, kể cả
truyện cha DRAFT. Không truy xuất passwordHash. UUID sai 400, không tồn tại 404,
Guest 401, USER 403, BANNED 401. Không thay đổi API đọc công khai bên dưới.

Danh sách nhận `page` (mặc định 1), `limit` (mặc định 20, tối đa 100), sắp theo
chapterNumber tăng dần, id tăng dần làm khóa phụ. Query lặp/không hỗ trợ hoặc
offset vượt Prisma Int trả 400. Có `pagination: {page, limit, total, totalPages}`;
không có kết quả trả data: [], totalPages: 0. Trang vượt cuối vẫn giữ total đúng.
Danh sách chỉ lấy metadata, không query content/pages. ADMIN xem cả DRAFT và
PUBLISHED. Public chỉ thấy chương PUBLISHED khi truyện cha cũng PUBLISHED;
truyện DRAFT/không tồn tại trả 404, kể cả database đang hoàn toàn trống.

GET chương kiểm tra cả trạng thái chương và truyện trong một snapshot. NOVEL
trả `content`; COMIC trả `pages: [{pageNumber, imageUrl}]` tăng dần. Không trả
storagePublicId, nội dung loại khác, thông tin User hoặc trạng thái quản trị.
Nếu gặp dữ liệu đọc không hợp lệ do sửa trực tiếp database, endpoint đọc trả 404.

## Body và validation

POST tạo chương (mặc định DRAFT):

```json
{"chapterNumber": 1, "title": "Chương đầu", "content": "Văn bản cho NOVEL"}
```

chapterNumber là số nguyên JSON từ 1 đến 2147483647, unique trong truyện.
title được trim, 1–200 ký tự. NOVEL nhận content string tối đa 200000 ký tự hoặc
null khi DRAFT; giữ nguyên khoảng trắng trong nội dung. COMIC từ chối trường
content kể cả null/chuỗi rỗng và luôn tạo content = null.

PATCH nhận ít nhất một trong title, chapterNumber, content. Không nhận storyId,
publishStatus, role, createdBy hoặc các field lạ. NOVEL đã PUBLISHED không thể
chuyển content về null/rỗng/toàn khoảng trắng. Đổi số chương đã dùng trả 409.

PUT pages chỉ dành cho COMIC, nhận body:

```json
{
  "pages": [
    {"pageNumber": 2, "imageUrl": "https://example.test/2.png"},
    {"pageNumber": 1, "imageUrl": "https://example.test/1.png", "storagePublicId": "optional-id"}
  ]
}
```

Tối đa 200 trang. pageNumber là số nguyên dương unique; không yêu cầu liên tiếp.
imageUrl là HTTP/HTTPS URL tối đa 2048 ký tự. storagePublicId tùy chọn, null hoặc
chuỗi 1–512 ký tự sau trim. Ký tự NUL không được chấp nhận trong văn bản/URL/ID.
Danh sách gửi lên thay toàn bộ trang cũ và được sắp theo pageNumber. Có thể đổi
thứ tự bằng cách gửi lại URL với pageNumber mới. DRAFT cho phép [], PUBLISHED
phải còn ít nhất một trang. Không xóa ảnh tại Cloudinary hoặc gọi dịch vụ ngoài.

Body của endpoint ghi Chapters giới hạn 1 MiB và chỉ parse sau xác thực ADMIN.
Body lớn hơn trả 413; sai cấu trúc/độ dài/số lượng trả 400. Parser 16 KiB của
Auth/Stories vẫn giữ nguyên. Không nhận file upload trong bước này.

## Xuất bản và transaction

Publish nhận `{expectedUpdatedAt?}` (vẫn nhận {} hoặc không body), không nhận quyền/trạng thái từ client. Truyện
cha phải PUBLISHED (nếu chưa: 409). NOVEL yêu cầu văn bản không rỗng/toàn khoảng
trắng và không có trang ảnh. COMIC yêu cầu content null và ít nhất một ảnh hợp
lệ. Gọi lại một chương đã xuất bản hợp lệ là idempotent. Chỉ cập nhật chương
được yêu cầu, không xuất bản các chương khác hoặc thay trạng thái truyện.

Mỗi lần tạo/sửa/thay trang/publish là một transaction Serializable. Tất cả đường
ghi khóa parent Story trước rồi đến Chapter bằng SELECT ... FOR UPDATE. Khi tạo
chương, khóa truyện trước kiểm tra type. Thao tác sửa/publish Stories dùng cùng
khóa truyện. Ghi chương cập nhật updatedAt của truyện, để snapshot Serializable
cũ không đọc lại số chương/type từ trước một thao tác đồng thời đã commit.

Thay trang thực hiện deleteMany có chapterId rồi createMany trong cùng transaction;
lỗi chèn hoặc validation sau đó rollback trang cũ, metadata và timestamp truyện.
Không dùng skipDuplicates. Unique constraint PostgreSQL xử lý xung đột số chương
với HTTP 409; P2034 retry toàn bộ transaction tối đa 5 lần, hết lượt trả 409.
Điều kiện hợp lệ được kiểm tra lại trong transaction khi sửa chương PUBLISHED.

### Kiểm tra phiên bản khi ghi (Bước 14.3)

PATCH metadata, PUT pages và PATCH publish nhận thêm `expectedUpdatedAt` tùy
chọn: chuỗi ISO 8601, lấy nguyên giá trị updatedAt từ response đã đọc. Null,
số, ngày không hợp lệ hoặc chuỗi không có timezone trả 400. POST tạo chương
không nhận field này. PATCH chỉ có expectedUpdatedAt mà không có trường cần
sửa cũng trả 400; các field khác vẫn theo strict validation hiện có.

Controller tách phiên bản khỏi input Prisma. Service kiểm tra ADMIN ACTIVE,
khóa Story rồi Chapter, so sánh timestamp bên trong cùng transaction Serializable
trước khi ghi. Không khớp trả 409 `CHAPTER_STALE`, không sửa metadata, xóa/chèn
trang, đổi trạng thái hoặc touch Story. Khi P2034 xảy ra, toàn bộ transaction
retry và kiểm tra lại phiên bản gốc. Frontend có preflight GET nhưng kiểm tra
trong transaction mới chặn được thay đổi xảy ra giữa GET và request ghi.

Timestamp của mỗi thay đổi thực sự được đặt thành max(thời gian hiện tại,
updatedAt cũ + 1 ms), tránh hai lần ghi có cùng phiên bản hoặc đồng hồ máy chủ
lùi. Publish đã PUBLISHED không ghi lại khi điều kiện và phiên bản khớp; phiên
bản stale vẫn trả 409. Lỗi sau kiểm tra, kể cả chèn trang thất bại, rollback cả
dữ liệu và timestamp. Không thêm cột hoặc migration.

Client cũ bỏ qua expectedUpdatedAt vẫn hoạt động nhưng không được bảo vệ khỏi
ghi đè form cũ. Tất cả request ghi từ Admin Web mới gửi phiên bản snapshot gốc.
Writer SQL ngoài API phải tự bảo đảm updatedAt thay đổi. Test mới dùng store
in-memory, không kiểm thử ghi đồng thời lên PostgreSQL chính.

## Kiểm thử và rủi ro còn lại

`npm run test:chapters` chạy HTTP mock và smoke test PostgreSQL chỉ đọc.
`npm test` chạy cả Auth, Genres, Stories và Chapters. Server test dùng cổng tạm,
đóng sau khi chạy. Tài khoản ADMIN/USER, truyện và chương trong test ghi chỉ nằm
trong bộ nhớ, không tạo dữ liệu thật hoặc xóa dữ liệu webnovel_db.

Mock chia sẻ transaction queue/snapshot cho Stories và Chapters, kiểm tra race
logic, rollback sau khi xóa trang cũ, duplicate chapterNumber, publish vs empty
pages, tạo chương vs đổi type, giới hạn body và phân quyền. Smoke test database
trống xác nhận đọc ID không tồn tại trả 404; list [] được kiểm tra bằng parent
PUBLISHED không có chương trong mock.

Chưa kiểm thử ghi hoặc khóa nhiều process trên PostgreSQL test riêng. Các quy
tắc chéo NOVEL/COMIC/trạng thái được bảo đảm qua API và transaction, chưa có SQL
trigger chống sửa dữ liệu trực tiếp. Writer mới sau này phải dùng cùng thứ tự
khóa Story → Chapter. Chưa tích hợp upload/xác minh sở hữu ảnh Cloudinary.

Tài liệu tham khảo:
[PostgreSQL row locks](https://www.postgresql.org/docs/17/explicit-locking.html),
[Prisma 7 transactions](https://www.prisma.io/docs/orm/v7/prisma-client/queries/transactions).
