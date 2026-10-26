# Quản lý Chapters NOVEL/COMIC — Bước 14.3

## Routes và sử dụng

Đăng nhập ADMIN ACTIVE tại http://127.0.0.1:5173, mở Stories → chi tiết truyện →
Quản lý chương. Mục Chapters ở sidebar cũng dẫn về Stories để chọn truyện.

- `/stories/:storyId/chapters`: danh sách cả DRAFT/PUBLISHED, sort chapterNumber
  tăng dần theo Backend, page/limit mặc định 1/20 và limit tối đa 100.
- `/stories/:storyId/chapters/new`: tạo metadata/nội dung NOVEL dưới dạng DRAFT.
  Với COMIC, tạo metadata DRAFT trước rồi mở editor ảnh cho ID chương vừa nhận.
- `/stories/:storyId/chapters/:chapterId`: đọc dữ liệu ADMIN thật, không dùng API
  công khai cho chương nháp. Kiểm tra chapter.storyId khớp route trước khi hiển thị.
- `/stories/:storyId/chapters/:chapterId/edit`: sửa tên/số chương, nội dung NOVEL
  hoặc danh sách ảnh COMIC. Không cho đổi storyId hoặc gán publishStatus qua form.

NOVEL lưu plain text, giữ nguyên xuống dòng và hiển thị `white-space: pre-wrap`;
không render HTML bằng dangerouslySetInnerHTML. Giới hạn đúng Backend: số chương
nguyên 1–2147483647, tên trim 1–200, nội dung tối đa 200.000 UTF-16 code units,
không chứa NUL. NOVEL đã xuất bản không được xóa sạch nội dung.

Publish có dialog riêng, đọc lại điều kiện hiện tại trước khi xác nhận. Truyện
phải PUBLISHED; NOVEL có nội dung không trống và không có trang ảnh; COMIC có ít
nhất một trang đã lưu, không có nội dung chữ. Form không tự publish, không có
nút Publish để xuất bản nội dung chưa lưu và không có chức năng Delete.

## API

| Method | Đường dẫn                              | Dữ liệu                                                                                    |
| ------ | -------------------------------------- | ------------------------------------------------------------------------------------------ |
| GET    | `/api/admin/stories/:storyId/chapters` | `data: ChapterMetadata[]`, `pagination: {page,limit,total,totalPages}`                     |
| GET    | `/api/admin/chapters/:id`              | Chi tiết DRAFT/PUBLISHED, content, pages có storagePublicId, type                          |
| POST   | `/api/admin/stories/:storyId/chapters` | `{chapterNumber,title,content?}`; COMIC bỏ hẳn content                                     |
| PATCH  | `/api/admin/chapters/:id`              | Metadata/nội dung được phép                                                                |
| PUT    | `/api/admin/chapters/:id/pages`        | `{pages:[{pageNumber,imageUrl,storagePublicId}]}` thay toàn bộ trang                       |
| PATCH  | `/api/admin/chapters/:id/publish`      | `{expectedUpdatedAt}`; client cũ vẫn có thể gửi `{}`                                       |
| POST   | `/api/admin/uploads/chapter-pages`     | Multipart `files` nhiều lần; response data `{secureUrl,publicId,order}[]`, order bắt đầu 1 |
| GET    | `/api/admin/stories/:id`               | Loại và trạng thái truyện sở hữu chương                                                    |

GET chi tiết ADMIN được thêm sau khi người dùng xác nhận. Tái sử dụng middleware
authenticate/authorizeRole và kiểm tra lại ADMIN ACTIVE trong transaction đọc.
Không thay đổi visibility của GET `/api/chapters/:id` công khai, không truy vấn
passwordHash, không sửa schema/migration.

## COMIC và tài nguyên ảnh

- Chọn JPEG/PNG/WebP từ máy chỉ tạo preview. Mỗi ảnh tối đa 10 MiB, tối đa 200
  trang/chương. Nội dung file thực tế tiếp tục do Backend kiểm tra.
- Frontend chia batch tối đa 20 ảnh, payload file dưới 50 MiB trừ 256 KiB dành
  cho multipart. File lớn có thể khiến batch có ít hơn 20 ảnh.
- Mỗi batch phải xác nhận riêng. Frontend chạy một request tại một thời điểm;
  Backend giữ concurrency upload ảnh tối đa 2. Không tự bắt đầu batch kế tiếp.
- Có tiến độ gửi bytes; 99% chưa phải Cloudinary đã lưu xong. Chỉ coi thành công
  sau khi nhận đủ kết quả hợp lệ, `order` không trùng và đủ 1..n (đúng hợp đồng Backend).
- Response được sắp theo `order`, không theo thời gian upload hoàn tất. Ảnh mới
  nối vào cuối danh sách hiện có; URL và storagePublicId cũ được giữ lại.
- Nút lên/xuống/loại ảnh chỉ đổi danh sách cục bộ. PageNumber được đánh lại 1..n
  khi ADMIN xác nhận Lưu danh sách trang. Không gửi PUT chỉ vì chọn/upload ảnh.
- Lưu trang thay thế toàn bộ danh sách: dialog nêu rõ số trang sẽ lưu; COMIC đã
  xuất bản không được lưu danh sách rỗng. Không xóa ảnh thật trên Cloudinary.
- Batch lỗi hoặc kết quả không rõ sẽ bị khóa khỏi retry tự động. Sau khi kiểm
  tra Cloudinary, ADMIN có thể bỏ batch lỗi khỏi hàng chờ; ảnh đã lên nhưng không
  được dùng có thể vẫn còn trên dịch vụ.
- Metadata và pages là hai request ghi độc lập. Thông báo phân biệt hai lần lưu;
  lỗi lần sau không tự rollback hay gửi lại lần đã thành công. Publish chỉ ở
  trang chi tiết, sử dụng dữ liệu đã lưu.

## Bảo vệ dữ liệu chưa lưu và xung đột

App dùng React Router data router để hỗ trợ useBlocker, tái sử dụng AppRoutes,
AuthProvider, Session và Axios singleton; không tạo cơ chế Auth khác. Giữ
`useTransitions={false}` để tránh lỗi thay form khi nhập ngay sau chuyển trang.
Các form chương chặn rời qua sidebar/link/Back khi dirty, có upload hoặc đang
ghi. Đóng/reload tab dùng cảnh báo native. Đang upload/ghi không cho xác nhận rời
trang trong dialog; khi logout/quyền hết hiệu lực, Auth vẫn ưu tiên đóng UI.

Trước khi sửa metadata, thay pages hoặc publish, Frontend GET lại bản hiện tại
và so sánh updatedAt với snapshot đã mở. Nếu khác, không gửi request ghi.
Mọi HTTP 409 khóa ghi tiếp; ADMIN phải xác nhận bỏ thay đổi và tải lại bản mới.
Không tự áp dữ liệu server lên form đang dirty, không retry mutation tự động.
Lỗi mạng/5xx khi ghi cũng khóa để kiểm tra kết quả trước khi thử tiếp.

Frontend còn gửi `expectedUpdatedAt` (phiên bản snapshot gốc) trong cả PATCH
metadata, PUT pages và PATCH publish. Backend so sánh sau khi khóa parent Story
và Chapter trong cùng transaction Serializable, trước mọi ghi/xóa trang. Phiên
bản không khớp trả HTTP 409 `CHAPTER_STALE`; không đổi chương, trang hoặc truyện.
Kiểm tra được thực hiện lại khi transaction retry, nên thay đổi phát sinh sau
preflight GET cũng được chặn tại API ghi. Frontend không thay snapshot cũ bằng
kết quả preflight để tự vượt xung đột.

`expectedUpdatedAt` là chuỗi ISO 8601 tùy chọn, không phải cột Prisma. PATCH cần
ít nhất một trường metadata/nội dung ngoài phiên bản; POST tạo không nhận phiên
bản. Mỗi ghi thực sự tăng updatedAt ít nhất 1 ms, kể cả khi cùng mili giây hoặc
đồng hồ máy chủ lùi. Publish đã hoàn tất có thể trả lại bản hiện tại nếu phiên
bản còn khớp; phiên bản cũ vẫn bị từ chối. Client cũ không gửi phiên bản tiếp tục
hoạt động như trước nhưng không nhận bảo vệ form cũ của cơ chế này. Ghi SQL trực
tiếp phải tự tuân thủ quy tắc updatedAt, không nằm trong bảo đảm của API.

Theo dõi/dọn ảnh mồ côi, gộp metadata+pages thành một transaction và lưu nháp
offline chưa được triển khai ở bước này. Không lưu token, password hoặc secrets
vào localStorage/sessionStorage/Git. Reload tab vẫn cần đăng nhập lại theo
memory-only session hiện có.

## File Bước 14.3

Tạo trong admin-web:

- `src/features/chapters/model.ts`, `api.ts`, `queries.ts`
- `src/features/chapters/ChapterListPage.tsx`, `ChapterDetailPage.tsx`, `ChapterFormPage.tsx`
- `src/features/chapters/ComicPagesEditor.tsx`, `PublishChapter.tsx`, `UnsavedChanges.tsx`, `chapters.css`
- `tests/chapter-fixtures.ts`, `chapters.test.tsx`, `chapters-api.test.ts`, `tests/e2e/chapters.spec.ts`
- `CHAPTERS.md`

Sửa trong admin-web:

- `src/App.tsx`, `src/routes/AppRoutes.tsx`
- `src/components/ConfirmDialog.tsx`, `src/lib/api/errors.ts`
- `src/features/stories/StoryDetailPage.tsx`
- `src/layouts/AdminLayout.tsx`, `src/pages/DashboardPage.tsx`
- `tests/pages.test.tsx`, `README.md`

Sửa trong backend:

- `src/routes/chapter.routes.ts`, `src/controllers/chapter.controller.ts`, `src/services/chapter.service.ts`
- `src/services/chapter.store.ts`, `src/middlewares/chapter.validation.ts`, `src/types/chapter.types.ts`
- `tests/helpers/memory-chapter.store.ts`
- `tests/chapters.test.ts`, `docs/chapters.md`

Không thêm dependency, không sửa .env hoặc schema/migration. Build/generated
artifacts nằm trong đường dẫn ignored hiện có.

## Kiểm tra

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\admin-web
npm run typecheck
npm run build
npm run lint
npm run format:check
npm test
npm run test:e2e
```

Test Frontend chặn toàn bộ API bằng mock, Chromium mock cả ảnh trả về. Không
đăng nhập thật, không ghi webnovel_db, không gọi Cloudinary thật. Test Backend
liên quan dùng MemoryAuthStore/MemoryChapterStore/MemoryStoryStore và mock SDK.
Không chạy integration ghi dữ liệu hoặc migration. Screenshot trong test-results
đã bị ignore. Để chạy UI thật, Backend cần được khởi động bằng source mới có
GET chi tiết ADMIN; không mở thêm server trùng cổng 4000.

## Kết quả kiểm tra ngày 18/10/2026

- Typecheck, production build, Oxlint và Prettier check đạt.
- Frontend: 101/101 test đạt, gồm các test Login/Stories hiện có và test Chapters mới.
- Chromium: 8/8 test đạt; đã xem screenshot desktop/tablet, NOVEL editor và COMIC editor.
- Backend: typecheck/build đạt; 92/92 test Auth/Stories/Chapters/Upload đạt,
  đều dùng stores hoặc SDK mock, không ghi Database thật.
- Build còn cảnh báo bundle chính khoảng 623 kB minified (192 kB gzip);
  đây là cảnh báo tối ưu tải trang, không phải lỗi biên dịch.
- Đã bổ sung kiểm tra phiên bản trong transaction theo quyền được cấp riêng.
  Test dùng store in-memory: stale metadata/pages/publish, hai writer chung phiên
  bản chỉ một thắng, rollback, retry, timestamp đơn điệu và tương thích client cũ.
  Chưa chạy concurrency test ghi PostgreSQL thật; ảnh mồ côi vẫn để bước sau.
