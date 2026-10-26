# Module Upload

## File tạo/sửa

Tạo mới (đường dẫn tương đối từ backend):
- `src/config/cloudinary.ts`
- `src/routes/upload.routes.ts`, `src/controllers/upload.controller.ts`
- `src/services/upload.service.ts`, `src/middlewares/upload.validation.ts`
- `src/types/upload.types.ts`, `src/utils/upload-capacity.ts`
- `tests/uploads.test.ts`, `docs/uploads.md`

Sửa: `src/app.ts` (mount trước JSON parser), `package.json`, `package-lock.json`
(dependencies và scripts test), `.env.example` (placeholder).

Dependencies: Cloudinary Node.js SDK chính thức, Busboy (stream multipart),
Sharp (decode ảnh), @types/busboy. Không sửa schema/migration hoặc API ghi Stories/
Chapters; không tạo bản ghi database hay gọi API xóa Cloudinary.

## Cấu hình

Tự thêm ba biến vào `backend/.env` trên máy, dùng giá trị từ tài khoản Cloudinary:

```dotenv
CLOUDINARY_CLOUD_NAME="your_cloud_name"
CLOUDINARY_API_KEY="your_api_key"
CLOUDINARY_API_SECRET="your_api_secret"
```

Đây là placeholder, phải thay bằng credentials thật tại máy. Không gửi secret
qua chat, không đưa `.env` vào Git. `.gitignore` hiện đã loại bỏ `.env`.
Khởi động lại process Backend sau khi chỉnh env. Thiếu/placeholder credentials
trả 503 UPLOAD_NOT_CONFIGURED, không làm lỗi Health/Genres/Auth/Stories/Chapters.

Trong bước này chưa cấu hình credentials thật và chưa upload ảnh thật. Chỉ thử
với Cloudinary thật sau khi có sự cho phép riêng của người dùng. Test tự động
luôn dùng storage mock; test adapter SDK cũng stub upload_stream, không gọi mạng.

## API và dữ liệu trả về

Cả hai endpoint yêu cầu `Authorization: Bearer <accessToken>`, tài khoản ACTIVE
và ADMIN qua middleware hiện có. USER trả 403; Guest/token sai trả 401. Xác thực
và rate limit chạy trước khi nhận body. Response có Cache-Control: no-store.

`POST /api/admin/uploads/cover`: multipart/form-data, đúng một file ở field
`file`, không nhận text field. Tối đa 5 MiB/file; tổng body tối đa 5 MiB + 64 KiB
(dành cho multipart overhead). Response 201:

```json
{
  "success": true,
  "message": "Cover uploaded",
  "data": { "secureUrl": "https://res.cloudinary.com/...", "publicId": "webnovel/covers/..." }
}
```

`POST /api/admin/uploads/chapter-pages`: multipart/form-data, lặp field `files`,
từ 1 đến 20 ảnh, mỗi ảnh tối đa 10 MiB. Tổng raw body tối đa 50 MiB, gồm cả
headers/boundaries; vì vậy 20 ảnh không đồng nghĩa được gửi 20 × 10 MiB.
Response 201:

```json
{
  "success": true,
  "message": "Chapter images uploaded",
  "data": [
    { "order": 1, "secureUrl": "https://res.cloudinary.com/...", "publicId": "webnovel/chapter-pages/..." }
  ]
}
```

order tính từ 1 theo thứ tự file trong multipart, không sắp theo tên file và
không theo thứ tự upload hoàn tất. Public ID sinh bằng UUID phía server, folder
cố định webnovel/covers hoặc webnovel/chapter-pages, overwrite=false. Client
không được tự chọn folder, đường dẫn hoặc public ID.

Gắn ảnh là bước gọi API ADMIN hiện có riêng biệt:
- Ảnh bìa: `PATCH /api/stories/:id` với coverUrl = secureUrl.
- Trang ảnh: `PUT /api/admin/chapters/:id/pages` với
  `{pages: [{pageNumber: order, imageUrl: secureUrl, storagePublicId: publicId}]}`.

Endpoint Upload không tự gắn ảnh vào truyện/chương hoặc tạo ChapterPage. URL
trả về tương thích validation hiện tại; không thay đổi kiểm tra quyền ADMIN
của Stories/Chapters và không coi URL bên ngoài là bằng chứng được phép ghi.

## Validation và giới hạn tài nguyên

Chỉ chấp nhận raster JPEG, PNG, WebP tĩnh. Kiểm tra magic bytes, đối chiếu format
và decode toàn bộ pixel qua Sharp; không tin MIME/đuôi file. SVG, GIF, PDF,
ảnh hỏng/truncated, ảnh động hoặc ảnh quá 16 triệu pixel bị từ chối với 400.
Giới hạn pixel hỗ trợ chặn ảnh nén nhỏ nhưng giải nén quá lớn.

Busboy stream request vào thư mục tạm ngẫu nhiên của hệ điều hành; không dùng
filename client làm đường dẫn. Dữ liệu theo file được spool xuống disk, không
giữ toàn bộ batch trong RAM. Chỉ buffer một file đã giới hạn dung lượng khi
decode, nhằm tránh libvips giữ handle WebP trên Windows. Tất cả ảnh được kiểm
tra trước khi gửi bất kỳ ảnh nào lên Cloudinary.

Mỗi process cho tối đa 2 request Upload hoạt động; request dư nhận 429 UPLOAD_BUSY
và Retry-After. Có tối đa 2 transfer Cloudinary đồng thời, dùng semaphore chung
cho cả hai endpoint. Không tạo hàng chờ không giới hạn cho request. Sharp vẫn
cần bộ nhớ native cho decode; pixel cap và số request hạn chế mức sử dụng này.

Counter raw stream áp dụng giới hạn tổng body kể cả không có Content-Length.
Mỗi file có limit riêng, giới hạn số file/part và từ chối text field. Nhận body
quá 60 giây trả 408. SDK timeout 30 giây/file, có guard 35 giây. Client ngắt kết
nối sẽ hủy stream và không bắt đầu các upload đang chờ tiếp theo.

Rate limit hiện tại: 30 request/15 phút/IP, dùng lại middleware và memory store
hiện có. Khi chạy nhiều instance cần shared store hoặc giới hạn tại reverse
proxy để có quota chung; không thêm Redis trong bước này.

## Lỗi và dọn dẹp

400: file/form không hợp lệ, quá số file hoặc không có file. 413: file/body quá
dung lượng. 429: rate limit/capacity. 502: Cloudinary lỗi; không trả lỗi SDK,
stack, credentials hoặc đường dẫn tạm. 503: chưa cấu hình. Lỗi I/O nội bộ trả
thông báo chung. Không ghi token, mật khẩu hoặc credentials vào log.

Các stream ghi file được hủy cùng nhau khi parser lỗi. Dọn thư mục tạm sau khi
thành công hoặc thất bại, chờ stream đóng trước khi xóa; kiểm tra absolute path
thuộc đúng temp root và prefix do server tạo. Process bị kill/crash vẫn có thể
để lại thư mục tạm, cần quy trình housekeeping riêng trong tương lai.

## Ảnh mồ côi và công việc tiếp theo

Cloudinary upload và cập nhật PostgreSQL là hai thao tác riêng. Ảnh upload thành
công nhưng chưa gắn vào Database sẽ tồn tại ở Cloudinary. Nếu một batch lỗi sau
khi một số file đã upload, các ảnh đó cũng có thể còn tồn tại. Không tự xóa hoặc
rollback tài nguyên Cloudinary trong bước này. Client nên giữ publicId của kết
quả thành công để gắn hoặc phục vụ đối soát sau này.

Bước tiếp theo nên thiết kế upload ledger/quyền sở hữu asset, liên kết với
truyện/chương, thời hạn ảnh chưa gắn và quy trình dọn có xác nhận. Chưa có bảng
ledger, job dọn hoặc kiểm thử tích hợp Cloudinary thật trong bước này.

## Kiểm thử

`npm run test:uploads` hoặc `npm test`. Dùng JWT/Argon2 thật với tài khoản memory,
Sharp decode ảnh test thật và Cloudinary mock. Kiểm tra format, spoofed MIME,
file/part/body limits, streaming không Content-Length, thứ tự 20 file, concurrency,
rate limit, credential sanitization, cleanup, lỗi Cloudinary và khả năng tương
thích Stories/Chapters. Chỉ đọc row counts PostgreSQL để đối chiếu không phát
sinh bản ghi. Không upload ảnh thật hoặc seed database.

Tham khảo:
[Cloudinary Node SDK](https://cloudinary.com/documentation/node_image_and_video_upload),
[Busboy](https://github.com/mscdex/busboy),
[Sharp](https://sharp.pixelplumbing.com/api-constructor/).
