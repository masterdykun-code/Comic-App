# Bước 16.3 — Demo Android riêng

Các lệnh chạy trong `mobile`, dùng Node 24 LTS. Backend production, schema,
migration và Admin Web không thay đổi. Không có thao tác seed tự động khi cài/chạy app.

## Kiểm tra và tạo fixture

```powershell
npm run demo:inspect
npm run demo:seed -- <IP_LAN_WINDOWS> --confirm
```

Nếu seed dừng sau dòng `Verified...` mà chưa hỏi mật khẩu, chạy kiểm tra chỉ đọc:

```powershell
npm run demo:diagnose -- <IP_LAN_WINDOWS>
```

Lệnh không hỏi mật khẩu và không seed. `stdinTTY`, `stdoutTTY`, `rawModeSupported`
phải đều `true`. Nếu `LOCAL_TERMINAL_REQUIRED`, dùng Windows Terminal hoặc VS Code
Terminal tương tác; không dùng Output/Debug Console, pipe, redirect hoặc công cụ
chạy command bằng stdin/stdout dạng pipe. Không bỏ chốt TTY hay bật echo để sửa lỗi.
Đã kiểm tra npm trong PowerShell PTY: cả ba khả năng đều true; môi trường không TTY
tái hiện dừng đúng tại `terminal-check`. Không kết luận Terminal của người dùng lỗi
TTY chỉ từ thông báo cũ vì catch cũ không giữ mã lỗi.

Thông báo mới phân biệt phase và mã lỗi an toàn, không in exception/stack gốc:
`password-input`, `password-confirmation`, `password-validation` (`INVALID_PASSWORD`),
`password-hash`, `fixture-transaction`. `--confirm` là xác nhận cho phép seed, khác
với lần nhập lại mật khẩu. Cổng 4001 chỉ được bind bởi `demo:serve`, không bởi seed.

Chỉ chạy seed sau khi chủ dự án xác nhận. `backend/.env.integration` chỉ được chứa
`INTEGRATION_DATABASE_URL`, trỏ local `webnovel_test_db`, schema `public`. Không có
fallback sang `.env`. Script kiểm tra tên database thực, migration/checksum, marker,
dữ liệu ngoài fixture, dùng transaction và advisory lock chung với runner integration.
Database có dữ liệu ngoài fixture hoặc fixture thiếu một phần sẽ bị từ chối; không reset.

Lần đầu nhập mật khẩu USER 8–128 ký tự hai lần, **ẩn hoàn toàn trong terminal**.
Không truyền password bằng tham số, không gửi qua chat. Email đăng nhập demo:
`android_demo_v1_user@example.invalid`. ADMIN chỉ dùng làm tác giả dữ liệu, có mật
khẩu ngẫu nhiên bị loại bỏ; không dùng ADMIN thật. Hash dùng cấu hình Argon2id hiện có.

Fixture marker `android_demo_v1`, UUID cố định, tạo trong một transaction:
2 users + 2 genres + 2 stories + 2 story_genres + 4 chapters + 6 chapter_pages = **18 bản ghi**.
NOVEL và COMIC đều PUBLISHED, mỗi truyện 2 chương PUBLISHED; NOVEL có tiếng Việt nhiều
dòng. COMIC mỗi chương 3 ảnh PNG tự tạo, có số thứ tự. Chạy seed lại không tạo trùng,
không thay mật khẩu hoặc ghi đè tiến độ. Nếu đổi IP LAN phải dừng và cleanup rồi seed lại.

## Khởi động Backend demo

```powershell
npm run demo:serve -- <IP_LAN_WINDOWS>
```

Server bind `0.0.0.0:4001`; nếu cổng bận sẽ dừng, không dùng lại process khác. Giữ
terminal chạy. Server xác minh DB/fixture trước listen, giữ advisory lock để runner
integration và cleanup không chạy cùng lúc, kiểm tra DB trước request ghi. JWT secret
ngẫu nhiên theo process: restart server làm Access Token cũ hết hiệu lực; đăng nhập lại.
Chặn Upload và Register trong wrapper demo, credentials Cloudinary bị xóa trong process.
Không gọi Cloudinary thật. Native không cần Origin CORS; chỉ cho Origin Web đúng
`http://<IP_LAN_WINDOWS>:8082`, không trả wildcard. Không đổi CORS production.

PNG được tạo trong RAM từ hình học và chữ số, phục vụ cùng server ở `/__demo__/cover.png`
và `/__demo__/page-1.png` đến `page-6.png`; không dùng ảnh có bản quyền hoặc URL localhost.
Chỉ dùng Wi-Fi tin cậy: demo HTTP, không mở cổng ra Internet; không mở PostgreSQL ra LAN.

Sau khi server **thực sự báo đang chạy**, đổi trên máy trong `mobile/.env`:

```dotenv
EXPO_PUBLIC_API_BASE_URL=http://<IP_LAN_WINDOWS>:4001/api
```

Không có credentials trong EXPO_PUBLIC. Khởi động lại Metro để nhận env mới; không
chỉ dựa vào Fast Refresh. Tránh tự restart Metro đang chạy khi chưa kết thúc phiên hiện tại.

## Kiểm tra trên Android

1. Cùng Wi-Fi, mở `http://<IP_LAN_WINDOWS>:4001/api/health` trong Chrome điện thoại.
2. Mở `/api/stories`: phải có 2 truyện; mở `/__demo__/page-1.png`: phải thấy ảnh demo.
3. Mở Expo Go: Home/Explore có NOVEL và COMIC, mỗi truyện 2 chương đã xuất bản.
4. Đọc Guest trước: kiểm tra xuống dòng NOVEL, thứ tự ảnh COMIC, Back và đổi chương.
5. Đăng nhập bằng USER demo và mật khẩu tự nhập để tự thử Favorites, ReadingProgress,
   History, Ratings/Comments/Profile, đóng/mở lại ứng dụng và logout. Các thao tác này
   ghi vào DB test; công cụ chuẩn bị không tự gửi thay người dùng.

Kiểm tra HTTP từ Windows không thay thế xác nhận ảnh/API trên điện thoại. Không tạo
APK và không đánh dấu Native PASS khi chưa quan sát hoặc được người dùng xác nhận.

## Dọn fixture (không tự động)

Dừng server demo bằng Ctrl+C trước. Cleanup xóa đúng UUID/tham chiếu fixture và dữ liệu
tương tác của hai tài khoản demo trên hai truyện demo, gồm session/refresh token. Không
dùng TRUNCATE, migrate reset hoặc DROP. Nếu có dữ liệu ngoài phạm vi sẽ rollback/dừng.

```powershell
npm run demo:cleanup -- <IP_LAN_WINDOWS> --confirm
npm run demo:inspect
```

Không chạy test integration yêu cầu DB trống trong khi đang giữ demo. Dừng server,
cleanup có xác nhận trước rồi mới dùng các runner đó.

## Trạng thái chuẩn bị

Đã kiểm tra chỉ đọc: `webnovel_test_db/public`, 13 bảng ứng dụng trống, migration khớp.
**Chưa seed; 0 bản ghi tạo. Chưa khởi động server 4001; chưa đổi mobile/.env.** Chờ
xác nhận tạo fixture. Không sửa hoặc ghi `webnovel_db`.

Kiểm tra công cụ: **257/257 test Mobile đạt**, gồm 8 test an toàn demo bằng mock;
typecheck, lint cho script/test mới và format đạt. Chưa chạy seed/cleanup thật hoặc
kiểm tra HTTP có dữ liệu; các bước đó cần xác nhận và mật khẩu nhập cục bộ trước.
