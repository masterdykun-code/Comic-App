# Bước 14.4 — Quản lý thể loại và kiểm duyệt bình luận

## Trang đã hoàn thiện

`/genres` dùng GET `/api/genres` hiện có, sắp xếp theo tên từ Backend. Form tạo/sửa
kiểm tra name/slug bằng Zod; nút tạo slug hỗ trợ tên tiếng Việt. Tạo, sửa và xóa đều
có dialog xác nhận. Xóa thể loại đang được Story dùng hiển thị 409, giữ hàng trong bảng.
Thành công làm mới query `genres` dùng chung với form Stories và cache Stories.
Có loading, empty, lỗi an toàn, tải lại, toast và trạng thái đang xử lý.

`/comments` dùng GET `/api/admin/comments`. Hiển thị tác giả, truyện, nội dung văn bản,
ngày tạo/cập nhật, VISIBLE/HIDDEN và quan hệ parent/reply. Bộ lọc trạng thái, Story UUID,
sắp xếp, page size, trang và parentId nằm trong URL. Trang không hợp lệ không gửi query.
Nút xem phản hồi áp dụng parentId; không tải toàn bộ chuỗi phản hồi lồng nhau.
Ẩn/hiện dùng PATCH `/api/admin/comments/:id/moderate` có xác nhận.
Không có nút xóa bình luận ADMIN. UI giải thích reply VISIBLE dưới root HIDDEN và Story DRAFT.

Mọi dữ liệu vận hành đến từ API thật; fixture chỉ nằm trong tests.
Sidebar Genres/Comments đã bật, Users/Settings vẫn chưa triển khai.

## API và bảo mật

Backend bổ sung POST/PATCH/DELETE `/api/admin/genres[/:id]` và GET `/api/admin/comments`.
Chi tiết body/query, whitelist và quy tắc xóa: [Backend contract](../backend/docs/admin-catalog.md).

Tái sử dụng Session trong bộ nhớ, Axios client, Protected Routes, QueryClient,
ConfirmDialog, Alert và Toast. Backend kiểm tra ADMIN ACTIVE độc lập với Frontend.
Không lưu token vào file/storage, không đổi Authentication hoặc thêm API client thứ hai.
HTTP errors đi qua safeError; không hiển thị message thô từ driver/server.
Mutation không tự retry khi 401, không gửi request trước khi xác nhận.
Comments gặp lỗi 409/network/5xx yêu cầu tải lại trước khi kiểm duyệt tiếp.

## File tạo/sửa

Tạo:

- `src/features/genres/{GenresPage.tsx,api.ts,model.ts,queries.ts,genres.css}`
- `src/features/comments/{CommentsPage.tsx,api.ts,model.ts,queries.ts,comments.css}`
- `tests/catalog-fixtures.ts`, `tests/catalog.test.tsx`, `tests/catalog-api.test.ts`
- `tests/e2e/catalog.spec.ts`, tài liệu này.

Sửa: `src/routes/AppRoutes.tsx`, `src/layouts/AdminLayout.tsx`, `src/pages/DashboardPage.tsx`,
`src/lib/api/errors.ts`, `tests/pages.test.tsx`, `README.md`.
Không cài thư viện mới, sửa schema/migration hoặc thay đổi cấu hình secrets.

## Kiểm tra

- Typecheck, production build và lint thành công.
- Vitest **133/133 đạt** (32 test mới), với Axios/module mocks; không gửi thao tác ghi thật.
- Chromium **10/10 đạt**, kiểm tra hành vi thật của trình duyệt, intercept tất cả API kể cả writes;
  ảnh chụp nằm trong `test-results`, chỉ có dữ liệu mô phỏng.
- Không dùng tài khoản ADMIN thật hoặc Cloudinary thật trong kiểm thử.
- Backend **260/260 đạt**, Prisma Validate và Migration Status thành công.

Lệnh tái kiểm tra: `npm run typecheck`, `npm run build`, `npm run lint`,
`npm run format:check`, `npm test`, `npm run test:e2e`.

## Giới hạn

Chưa có tìm kiếm nội dung bình luận vì schema chưa có index phù hợp. Lọc Story bằng UUID,
không thêm endpoint danh sách Stories phụ. Moderation giữ hành vi ghi tuần tự hiện có,
chưa có kiểm tra phiên bản giữa hai ADMIN; danh sách phản ánh lần làm mới gần nhất.
Rate limit hiện có theo process/IP, cần shared store nếu triển khai nhiều instance.
Production bundle còn cảnh báo chunk lớn hơn 500 kB; build vẫn thành công.
Không kiểm thử ghi trực tiếp trên webnovel_db, không sửa dữ liệu thật.
