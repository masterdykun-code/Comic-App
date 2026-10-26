# U08 — Bookmark

## Sử dụng trên Expo Go

1. Reload ứng dụng, đăng nhập bằng tài khoản của bạn.
2. Mở chương NOVEL hoặc COMIC, đọc đến vị trí muốn lưu rồi nhấn **Đánh dấu chương**.
3. Vào **Giá sách → Dấu trang đã lưu** để xem danh sách.
4. Nhấn **Đọc tiếp tại đây** để mở đúng truyện, chương và vị trí đã lưu.
5. Nhấn biểu tượng thùng rác rồi xác nhận để xóa riêng dấu trang.

Mỗi tài khoản giữ một dấu trang trên mỗi chương; có thể đánh dấu nhiều chương và nhiều truyện. Nhấn đánh dấu lại giữ nguyên vị trí cũ. Muốn chọn vị trí khác trong cùng chương, xóa dấu trang cũ rồi đánh dấu lại.

NOVEL khôi phục đoạn văn bằng textOffset UTF-16 theo cơ chế Reader sẵn có; COMIC khôi phục trang ảnh, không lưu mức zoom. Nếu chương đã chỉnh sửa, vị trí được kiểm tra lại và giới hạn theo nội dung hiện tại. Chương/truyện không còn công khai không thể mở từ dấu trang, nhưng vẫn xóa được dấu trang.

Bookmark có dữ liệu riêng. Thêm/xóa dấu trang không ghi ReadingProgress, ReadingHistory hoặc Favorites. Mở Reader vẫn ghi lịch sử theo hành vi sẵn có; thao tác đọc tiếp vẫn lưu tiến độ bình thường, dùng phiên bản ReadingProgress thật.

## API và Database

Tất cả endpoint yêu cầu xác thực tài khoản ACTIVE; dữ liệu chỉ thuộc người đang đăng nhập.

| API                                   | Mục đích                              |
| ------------------------------------- | ------------------------------------- |
| GET /api/me/bookmarks?page=1&limit=20 | Danh sách có phân trang               |
| POST /api/me/bookmarks                | Tạo dấu trang; 201 mới, 200 nếu đã có |
| GET /api/me/bookmarks/:id             | Kiểm tra và lấy vị trí để mở Reader   |
| DELETE /api/me/bookmarks/:id          | Xóa dấu trang của chính mình          |

POST nhận storyId, chapterId và textOffset (NOVEL) hoặc pageNumber (COMIC). Không gửi cả hai loại vị trí. Lỗi được trả qua error handler hiện có, không chứa bí mật.

Migration `20261024000000_bookmarks` chỉ thêm bảng bookmarks và các constraint/index liên quan. Có khóa ngoại kết hợp chapterId/storyId, unique userId/chapterId, CHECK vị trí và khóa transaction theo user để chống tạo trùng đồng thời. Không thay đổi schema các bảng cũ. Đã áp dụng lên cả webnovel_db và webnovel_test_db sau khi kiểm tra SQL; backup chính đã kiểm tra đọc được trước migration. Đối chiếu fingerprint sau kiểm thử: 13 bảng ứng dụng cũ của cả hai DB không đổi; bảng bookmarks còn 0 bản ghi sau cleanup fixture.

## File triển khai

Backend: prisma/schema.prisma, migration bookmarks, src/types/bookmark.types.ts, src/services/bookmark.store.ts, src/services/bookmark.service.ts, src/middlewares/bookmark.validation.ts, src/controllers/bookmark.controller.ts, src/routes/bookmark.routes.ts; đăng ký route trong src/app.ts. Tái sử dụng adapter đọc và error/auth middleware hiện có. Cập nhật danh sách bảng của bộ kiểm thử và tài liệu SQL tổng hợp; không chạy lại SQL tổng hợp.

Mobile: src/features/bookmarks/{api,queries,position}.ts, BookmarksScreen.tsx, src/app/bookmarks.tsx; tích hợp trong ReaderScreen, LibraryScreen, Stack và đường dẫn quay lại sau đăng nhập.

Test: backend/tests/bookmarks.test.ts, backend/tests/integration/bookmarks.postgres.test.ts, mobile/tests/bookmarks-api.test.ts, bookmarks-ui.test.tsx, bookmark-fixtures.ts, reader-ui.test.tsx và mobile/e2e/bookmarks.mock.cjs.

## Kiểm thử và giới hạn

- Backend Bookmark HTTP/mock: 6/6 đạt.
- PostgreSQL thật trong webnovel_test_db: 7/7 đạt (gồm test cha và 6 test con); chỉ tạo/xóa fixture ngẫu nhiên do test sở hữu. Kiểm tra concurrency, rollback, FK/CHECK/unique, quyền sở hữu và không ghi tiến độ.
- Bộ Backend mặc định: 248/251 đạt; 3 test cũ đòi DB rỗng thất bại vì DB đã có truyện thật. Không xóa dữ liệu để làm test đạt. Khi loại đúng 3 test phụ thuộc DB rỗng, các test còn lại đạt.
- Mobile bổ sung kiểm tra vị trí NOVEL/COMIC, tài khoản/phiên thay đổi, xóa có xác nhận và không ghi tiến độ chỉ vì khôi phục bookmark.
- Kết quả cuối: Mobile 327/327 test (26 suite); typecheck, lint, format và Android bundle đạt. Backend typecheck/build và Prisma validate/generate đạt; migration hai DB đã đồng bộ.
- Browser smoke dùng toàn bộ API mock, không gọi Backend/Cloudinary thật. Lệnh: `node e2e/bookmarks.mock.cjs` khi Expo Web riêng đang chạy cổng 8084.
- Browser smoke đạt ở viewport 393×852: mở danh sách → đọc bookmark → đánh dấu lại → xóa; 0 request ghi tiến độ, 0 request API không được mock, 0 lỗi render. Đã sửa điều kiện render chuỗi rỗng ở thông báo Bookmark trong Reader và thêm kiểm tra lỗi này vào smoke test.
- Chưa xác minh trực tiếp thao tác trên điện thoại Android thật. Cần thực hiện các bước Expo Go phía trên.

Chạy lại: Backend `npm run test:bookmarks`, `npm run test:bookmarks:postgres`; Mobile `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run export:android -- --max-workers 2`. Test PostgreSQL chỉ dùng INTEGRATION_DATABASE_URL trong backend/.env.integration trỏ đúng webnovel_test_db/public, không fallback sang DB chính.

Node hiện tại v25.9.0 nằm ngoài engines Mobile; nên dùng Node thuộc dải engines trong package.json. Không nâng phiên bản Node/Expo trong thay đổi U08 này.
