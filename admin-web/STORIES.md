# Quản lý Stories — Bước 14.2

## Bổ sung Ẩn / Xóa truyện

Danh sách và trang chi tiết có nút **Ẩn** cho PUBLISHED và **Xóa** cho cả DRAFT/PUBLISHED; luôn mở hộp thoại xác nhận trước khi gọi API. Ẩn chuyển về DRAFT, giữ nguyên chương và dữ liệu đọc; mở chi tiết rồi **Xuất bản** để công khai lại. DRAFT bao gồm bản nháp mới và truyện đã ngừng xuất bản.

Xóa vĩnh viễn yêu cầu xác nhận và phiên bản updatedAt đã xem; nếu truyện đổi trong lúc chờ sẽ trả 409, cần tải lại trước khi xác nhận mới. Không tự retry DELETE. Mọi dữ liệu liên quan của chính truyện được xóa trong transaction, giữ thể loại/tài khoản dùng chung và ảnh Cloudinary. Xem hợp đồng chi tiết tại `../backend/docs/story-lifecycle.md`.

API mới: `PATCH /api/admin/stories/:id/unpublish` và `DELETE /api/admin/stories/:id`. Kiểm thử chỉ dùng mock, không xóa truyện thật. Chạy Chromium độc lập bằng `npm run test:e2e:mock` (Vite 5185, API mock toàn bộ).

## Trang và hành vi

- `/stories`: danh sách ADMIN gồm cả bản nháp/xuất bản; ảnh bìa, tên, tác giả,
  loại, trạng thái, ngày tạo/sửa; tìm **tên truyện** (Backend chưa tìm tác giả),
  lọc type/status/publishStatus/genreId, sắp xếp newest/updated/title và phân trang.
  Bộ lọc nằm trong URL, áp dụng phía server, đổi bộ lọc trở về trang 1.
- `/stories/new`: React Hook Form + Zod, title 1–200, authorName 1–100,
  description tối đa 10.000, URL HTTP/HTTPS tối đa 2048 hoặc rỗng, tối đa 50
  UUID thể loại không trùng. Chỉ tạo DRAFT, không gửi createdBy/publishStatus.
- `/stories/:id`: chi tiết ADMIN, kể cả DRAFT, thể loại, số chương, trạng thái,
  mốc thời gian. Publish phải xác nhận, gửi PATCH với `{}`; lỗi điều kiện xuất
  bản được ánh xạ từ mã lỗi Backend sang thông báo tiếng Việt an toàn.
- `/stories/:id/edit`: sửa các trường cho phép, type khóa nếu chapterCount > 0
  và bị loại khỏi PATCH. Truyện đã xuất bản phải giữ mô tả/ảnh/thể loại hợp lệ.
  Không cho sửa createdBy, slug hoặc tự đổi publishStatus bằng form metadata.

Chỉ ADMIN ACTIVE vào được; tái sử dụng Session, AuthProvider, ProtectedRoute,
Axios singleton và TanStack Query. Cache danh sách/chi tiết được invalidation
sau ghi; phản hồi ghi về muộn của phiên cũ không được đưa vào cache của phiên
mới. Không có dữ liệu mẫu trong UI. Bảng cuộn ngang trong vùng riêng trên tablet.
Có loading skeleton, lỗi/tải lại, empty state, toast và dialog với focus trap,
Escape, trả focus. Routing dùng `useTransitions={false}` vì Chromium phát hiện
DOM form bị thay thế khi nhập ngay sau điều hướng với transition mặc định.

## API tích hợp

Đường dẫn bên dưới đã bao gồm `/api`; Axios nhận prefix từ VITE_API_BASE_URL.

| Method | API                        | Mục đích                                     |
| ------ | -------------------------- | -------------------------------------------- |
| GET    | `/api/admin/stories`       | Danh sách, bộ lọc, pagination từ Backend     |
| GET    | `/api/admin/stories/:id`   | Chi tiết quản trị, gồm DRAFT và chapterCount |
| POST   | `/api/stories`             | Tạo bản nháp                                 |
| PATCH  | `/api/stories/:id`         | Sửa thông tin                                |
| PATCH  | `/api/stories/:id/publish` | Xuất bản sau xác nhận                        |
| GET    | `/api/genres`              | Danh sách thể loại                           |
| POST   | `/api/admin/uploads/cover` | Multipart một field `file`                   |

GET chi tiết ADMIN là phần Backend bổ sung đã được người dùng cho phép.
Tái sử dụng authenticate/authorizeRole và kiểm tra lại ADMIN ACTIVE trong
transaction đọc. Guest 401, USER 403, BANNED 401, UUID sai 400, không tồn tại 404.
API công khai `/api/stories/:id` vẫn chỉ đọc PUBLISHED, không bị thay đổi.
Không thay schema/migration, không tạo/xóa dữ liệu thật khi triển khai hoặc test.

## Ảnh bìa và dữ liệu chưa lưu

Chọn JPEG/PNG/WebP tối đa 5 MiB chỉ tạo preview cục bộ (object URL được thu hồi).
Chọn ảnh không gửi request. Bấm “Xác nhận tải ảnh lên” mở dialog, rồi bấm “Tải lên
Cloudinary” mới gửi một request. Backend tiếp tục kiểm tra chữ ký/nội dung ảnh.
Không tự retry upload; timeout 45 giây. Lỗi không rõ kết quả nhắc kiểm tra Cloudinary
trước khi gửi lại. Nhận secureUrl/publicId, gắn secureUrl vào form; upload không
tự ghi Story. Không có API Secret hoặc token trong component/log/storage.

Form chặn lưu khi còn ảnh được chọn nhưng chưa upload; có thể bỏ ảnh đã chọn.
Ảnh đã upload nhưng chưa lưu có cảnh báo thường trực; nút Hủy/liên kết quay lại
trong form yêu cầu xác nhận và nhắc ảnh có thể còn trên Cloudinary. Tải lại/đóng
tab có cảnh báo native khi chưa lưu. Chưa chặn mọi điều hướng SPA qua sidebar
hoặc Back của trình duyệt; không tự dọn ảnh mồ côi. Nếu đã tải nhiều ảnh rồi chỉ
dùng một URL, toast nhắc các ảnh không dùng còn tồn tại.

Story chưa có coverPublicId trong schema; publicId không được gửi vào body Story.
Việc theo dõi/dọn ảnh chưa được gắn vào Database và kiểm soát điều hướng toàn cục
là phần việc tiếp theo. Đã có xóa truyện có xác nhận; chưa có xóa ảnh. Quản lý Chapters chỉ là vị trí
disabled; không xây CRUD Chapters, Users hoặc Genres.

## Chạy và kiểm tra

Backend cần chạy source mới để có GET chi tiết ADMIN. Nếu đang dùng bản build cũ,
khởi động lại Backend bằng cách đang dùng tại dự án, không mở thêm server cổng 4000.

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\admin-web
npm run dev
```

Mở http://127.0.0.1:5173, đăng nhập ADMIN ACTIVE, vào Stories. Không đưa mật khẩu
hoặc token vào chat. Reload mất phiên theo cơ chế memory-only hiện có.
VITE_API_BASE_URL mặc định cục bộ là `http://localhost:4000/api`; không đặt secret
Cloudinary/JWT/Database trong bất kỳ biến VITE_* nào.

```powershell
npm run typecheck
npm run build
npm run lint
npm run format:check
npm test
npm run test:e2e
```

Tất cả test Frontend mock API; test Chromium mock cả URL ảnh. Không có đăng nhập
thật, ghi PostgreSQL hoặc upload Cloudinary thật. Test bổ sung Backend dùng
MemoryStoryStore/MemoryAuthStore, không kết nối Database. Screenshot QA nằm trong
test-results (ignored). Typecheck/build Backend chỉ generate client cục bộ và
biên dịch, không chạy migration.

## Danh sách file Bước 14.2

Tạo trong `admin-web`:

- `src/features/stories/model.ts`, `api.ts`, `queries.ts`, `components.tsx`
- `src/features/stories/StoriesPage.tsx`, `StoryFormPage.tsx`, `StoryDetailPage.tsx`
- `src/features/stories/CoverField.tsx`, `stories.css`
- `src/components/ConfirmDialog.tsx`, `ToastProvider.tsx`, `toast-context.ts`
- `tests/stories.test.tsx`, `tests/stories-api.test.ts`, `tests/e2e/stories.spec.ts`
- `STORIES.md`

Chỉnh sửa trong `admin-web`:

- `src/App.tsx`, `src/app/providers.tsx`, `src/routes/AppRoutes.tsx`
- `src/layouts/AdminLayout.tsx`, `src/pages/DashboardPage.tsx`
- `src/lib/api/errors.ts`
- `tests/setup.ts`, `tests/pages.test.tsx`, `tests/e2e/auth.spec.ts`
- `README.md`

Chỉnh sửa trong `backend`:

- `src/routes/story.routes.ts`
- `src/controllers/story.controller.ts`
- `src/services/story.service.ts`
- `tests/stories.test.ts`
- `docs/stories.md`

Không cài thêm dependency. Không chỉnh .env, schema hoặc migration.

## Kết quả kiểm tra ngày 18/10/2026

- Frontend: TypeScript, production build, Oxlint và Prettier check đạt.
- Vitest/Testing Library: 60/60 test đạt (gồm 26 test cũ).
- Chromium: 5/5 test đạt; desktop/tablet/mobile, nhập ngay sau điều hướng,
  chọn ảnh chưa upload, xác nhận upload mock, tạo/sửa/xuất bản, Escape và focus trap.
- Backend: typecheck/build đạt; 20/20 test Stories dùng store in-memory đạt.
- Build còn cảnh báo chunk JavaScript khoảng 536 kB minified (168 kB gzip).
  Đây là cảnh báo tối ưu tải trang, không phải lỗi build; chưa chia bundle theo route.
- Không chạy test tích hợp ghi Database, migration hoặc Cloudinary thật. Không
  thay đổi dữ liệu trong webnovel_db.
