# U10 — Đổi mật khẩu

## Sử dụng

Reload Expo Go → đăng nhập → **Profile/Hồ sơ** hoặc **Tài khoản** → **Đổi mật khẩu**. Nhập mật khẩu hiện tại, mật khẩu mới và xác nhận, rồi nhấn **Lưu mật khẩu mới**. Mật khẩu mới phải khác mật khẩu hiện tại, dài 8–128 ký tự. Có nút hiện/ẩn mật khẩu và hủy.

Mật khẩu hiện tại sai: hiển thị lỗi, xóa các ô mật khẩu và giữ phiên hiện tại. Thành công: hiển thị thông báo, xóa token trong bộ nhớ/SecureStore và cache riêng, yêu cầu đăng nhập lại. Mọi phiên cũ trên các thiết bị đều bị thu hồi. Nội dung truyện, bookmark và tiến độ đọc trên máy chủ được giữ nguyên.

Nếu mất kết nối khi gửi, ứng dụng không tự gửi lại; hãy thử đăng nhập bằng mật khẩu mới để xác định kết quả trước khi thử lại. Chưa xác minh trực tiếp thao tác/bàn phím trên Android thật trong lần triển khai này.

## API

`POST /api/auth/change-password` yêu cầu Bearer Access Token của tài khoản ACTIVE.

Body: `currentPassword`, `newPassword`, `confirmPassword` (không trim mật khẩu).

- 200: `{ success: true, message: "Password changed. Sign in again.", data: { sessionsRevoked: true } }`.
- 400: thiếu trường, độ dài sai, xác nhận sai, trùng mật khẩu cũ hoặc trường ngoài hợp đồng.
- 401: thiếu/hết hạn/thu hồi phiên, BANNED hoặc phiên/mật khẩu đã thay đổi trong lúc thực hiện.
- 403 `CURRENT_PASSWORD_INCORRECT`: mật khẩu hiện tại sai hoặc tài khoản chưa có mật khẩu cục bộ.
- 429: quá 5 lần thử/IP trong 15 phút, dùng middleware rate limit hiện có (memory store một process).
- 500: lỗi nội bộ đã được lọc; không trả hash, mật khẩu hoặc token.

Tái sử dụng Argon2id và AuthSession. Đổi hash và thu hồi tất cả phiên trong cùng transaction, không phát token mới. Middleware xác thực sẵn có kiểm tra revokedAt nên access JWT cũ cũng bị từ chối. Refresh Token dạng hash vẫn giữ trong DB theo cơ chế hiện có, nhưng không thể dùng phiên đã thu hồi để refresh.

Đăng nhập kiểm tra lại hash đã xác minh dưới khóa user trước khi tạo phiên. Đổi mật khẩu so sánh snapshot hash, dùng cùng khóa user; hai lần đổi đồng thời chỉ có một lần thành công. Cập nhật hồ sơ giữ cùng thứ tự khóa user → session để tránh khóa ngược. Không thêm bảng, schema hoặc migration. Không có chức năng quên mật khẩu/email trong U10.

## File

Backend sửa: src/types/auth.types.ts, src/middlewares/auth.validation.ts, src/routes/auth.routes.ts, src/controllers/auth.controller.ts, src/services/auth.service.ts, src/services/auth.store.ts và package.json. Test: tests/auth.test.ts, tests/helpers/memory-auth.store.ts; thêm tests/integration/change-password.postgres.test.ts.

Mobile thêm src/features/auth/ChangePasswordForm.tsx và change-password.ts. Sửa ProfileScreen.tsx, AuthScreen.tsx, src/stores/auth.ts. Thêm tests/change-password.test.ts, change-password-ui.test.tsx và e2e/change-password.mock.cjs. Mật khẩu chỉ ở state cục bộ của form/request; không đặt trong Zustand, Query mutation cache, storage hoặc diagnostic logs.

## Kiểm tra

- Backend Auth: **35/35**; gồm 12 regression mới cho U10.
- PostgreSQL thật: **6/6** (test cha + 5 test con), kiểm tra rollback thật, thu hồi phiên, concurrency, hash cũ không tạo phiên mới và dữ liệu ngoài fixture không đổi. Chỉ chạy webnovel_test_db/public; cleanup theo UUID fixture do test sở hữu.
- Backend mặc định: **260/263**; 3 test cũ đòi DB rỗng tiếp tục thất bại vì DB có truyện. Không dọn dữ liệu thật để ép test đạt.
- Mobile: **342/342**, gồm 15 test mới; typecheck/lint/format và Android bundle đạt.
- Browser smoke: đạt ở 393×852, API được mock toàn bộ; xác minh lỗi mật khẩu cũ giữ phiên, xóa ô nhập và đổi thành công trở về Guest; không lỗi render hoặc request API ngoài mock.
- Backend typecheck/build đạt. Không reset DB, không sửa dữ liệu truyện hoặc mật khẩu tài khoản thật, không tạo APK/gọi Cloudinary.

Chạy lại từ backend: `npm run test:auth`, `npm run test:password:postgres`, `npm run typecheck`, `npm run build`. Test PostgreSQL chỉ đọc cấu hình INTEGRATION_DATABASE_URL từ .env.integration, bắt buộc DB đích webnovel_test_db/public; không fallback .env chính.

Chạy lại từ mobile: `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm test`, `npm run export:android -- --max-workers 2`. Browser smoke: khởi động Expo Web riêng cổng 8084 rồi chạy `node e2e/change-password.mock.cjs`.

Môi trường hiện tại Node 25.9.0 nằm ngoài engines Mobile; chưa thay Node hoặc nâng Expo trong bước này. Khi triển khai thật, giữ API qua HTTPS; cấu hình HTTP LAN demo hiện tại không được thay đổi ở U10.
