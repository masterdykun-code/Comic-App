# A01 — Quản lý USER / A02 — Dashboard

## Sử dụng Admin Web

Đăng nhập bằng tài khoản ADMIN ACTIVE:

- **Users** (`/users`): tìm theo displayName, username hoặc email (không phân biệt hoa thường), lọc Hoạt động/Đã khóa và phân trang.
- Chọn **Chi tiết**, sau đó **Khóa tài khoản** hoặc **Mở khóa tài khoản**. Chỉ gửi yêu cầu sau khi xác nhận trong hộp thoại; Quay lại/Escape không ghi dữ liệu.
- **Dashboard** (`/dashboard`): các thẻ tổng số USER, truyện, NOVEL, COMIC, chương và lượt đọc đã ghi nhận; Top 10 truyện có lịch sử đọc nhiều nhất. Có nút làm mới, trạng thái tải, rỗng và lỗi.

Nếu xung đột phiên bản, mất mạng hoặc kết quả thao tác chưa rõ, làm mới tài khoản để kiểm tra kết quả trước khi xác nhận tiếp. Yêu cầu ghi không tự động gửi lại.

## API

Tất cả yêu cầu cần Bearer Access Token của ADMIN ACTIVE; response `Cache-Control: no-store`. Guest nhận 401, USER nhận 403. Backend kiểm tra lại quyền trong transaction.

| Method | Đường dẫn | Nội dung |
| --- | --- | --- |
| GET | `/api/admin/users` | Chỉ danh sách role USER; `page=1`, `limit=20` (tối đa 100), `search` (1–200 ký tự), `status=ACTIVE/BANNED` tùy chọn |
| GET | `/api/admin/users/:id` | Chi tiết USER, 404 nếu không tồn tại hoặc là ADMIN |
| PATCH | `/api/admin/users/:id/status` | Body `{ "status": "BANNED", "confirm": true, "expectedUpdatedAt": "<updatedAt đã đọc>" }`; ACTIVE để mở khóa |
| GET | `/api/admin/dashboard` | Tổng số, ý nghĩa chỉ số đọc và tối đa 10 truyện phổ biến |

Danh sách trả `{success:true,data:[...],pagination:{page,limit,total,totalPages}}`. Chi tiết/thống kê/cập nhật trả `{success:true,data:...}`. Không chọn hoặc trả passwordHash, token, session hoặc mã đặt lại mật khẩu. Chỉ cho sửa status; từ chối các trường thừa như role/passwordHash. UUID/bộ lọc/body sai trả 400. Thay đổi phiên bản trả 409 `USER_STALE`; lỗi transaction xung đột trả 409 `USER_WRITE_CONFLICT`; lỗi nội bộ được che thông tin.

## Khóa tài khoản và phiên

- Không cho tự khóa ADMIN (`SELF_BAN_FORBIDDEN`) và không cho quản lý trạng thái tài khoản ADMIN khác (`ADMIN_ACCOUNT_PROTECTED`).
- Khóa hàng USER trước khi sửa trạng thái, theo cùng thứ tự khóa của luồng đăng nhập/đổi mật khẩu. `updatedAt` tăng tối thiểu 1 ms để phát hiện phiên bản cũ.
- Trong cùng transaction: chuyển BANNED, thu hồi toàn bộ AuthSession chưa thu hồi, vô hiệu hóa PasswordReset chưa sử dụng. Lỗi bất kỳ bước nào sẽ rollback.
- Authenticate đang có kiểm tra status ACTIVE và phiên chưa thu hồi ở mỗi request; login/refresh cũng kiểm tra trạng thái. Token cũ bị chặn trên các chức năng cần đăng nhập. Request đã hoàn tất trước khi khóa không được hoàn tác.
- Mở khóa chỉ đặt ACTIVE. Không khôi phục phiên hoặc mã đặt lại cũ; người dùng phải đăng nhập lại. Không xóa lịch sử, bình luận, bookmark, yêu thích hoặc dữ liệu truyện.
- Endpoint đổi trạng thái giới hạn 30 request/IP/15 phút, sau xác thực ADMIN. Các chức năng công khai vẫn dùng được với tư cách Guest.

## Ý nghĩa thống kê

- **Người dùng:** chỉ role USER, bao gồm ACTIVE/BANNED, không tính ADMIN.
- **Truyện/chương:** gồm cả DRAFT và PUBLISHED; có thêm số truyện đã xuất bản.
- **Lượt đọc đã ghi nhận:** số bản ghi ReadingHistory hiện còn lưu; không có cột lượt xem tích lũy trong schema hiện tại. Hệ thống ghi lịch sử mở chương của người đăng nhập, có khử trùng trong 30 giây; không tính Guest. Khi người dùng xóa lịch sử hoặc truyện bị xóa, chỉ số giảm.
- **Top truyện:** nhóm ReadingHistory theo storyId, đếm giảm dần, hòa thì theo storyId tăng dần; gồm mọi trạng thái để ADMIN xem được cả bản nháp. Truyện chưa có lịch sử không xuất hiện. Không tạo dữ liệu thống kê giả.
- Thống kê và danh sách/count dùng transaction RepeatableRead để nhất quán trong từng response. Không thay đổi schema/migration. Nếu sau này cần tổng lượt xem tích lũy cho cả Guest, cần thiết kế bộ đếm riêng; hiện chưa triển khai.

## Kiểm tra

- Backend mới: `npx tsx --test tests/admin-users.test.ts tests/admin-users.store.test.ts` — 11/11 đạt; HTTP với Auth thật trên store giả lập và kiểm tra Prisma adapter bằng mock.
- Đã kiểm tra truy vấn thống kê bằng transaction `READ ONLY` trên `webnovel_db/public`: số liệu nhất quán, xếp hạng đúng; không cập nhật tài khoản thật.
- Backend typecheck/build đạt. Toàn bộ test: 292/295 đạt; 3 bài cũ yêu cầu Database trống (`chapters.db`, `stories.db`, integration đầu của `genres`) thất bại vì DB có truyện. Không dọn dữ liệu để thỏa điều kiện test. Một lần chạy gặp lỗi ngẫu nhiên Node fetch `bad port` ở reading; chạy lại riêng đạt 39/39, lần chạy toàn bộ tiếp theo không còn lỗi này.
- Frontend typecheck/build/lint/format đạt, unit/UI/API 167/167 đạt. Build còn cảnh báo bundle >500 kB. Kiểm thử API/UI và Chromium dùng mock API; không đăng nhập bằng tài khoản thật hoặc đổi trạng thái trong PostgreSQL. Chromium: 14/14 đạt, có ảnh `admin-web/test-results/users-dashboard-desktop.png` và `users-confirm-tablet.png`.

Chạy lại từ `admin-web`: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, `npm test`, `npm run test:e2e:mock`.

## File chính

- Backend: `src/{routes,controllers,middlewares,services}/admin-users.*`, `src/types/admin-users.types.ts`, `src/app.ts`, `tests/admin-users*.test.ts`, `package.json` (thêm test vào suite).
- Admin Web: `src/features/users/{api,queries,UsersPage,DashboardStatistics,users.css}`, `src/pages/DashboardPage.tsx`, `src/layouts/AdminLayout.tsx`, `src/routes/AppRoutes.tsx`, `src/lib/api/errors.ts` và các test Users/Dashboard.

Không thêm dependency, migration, Cloudinary request hoặc thao tác ghi dữ liệu thật trong quá trình triển khai.
