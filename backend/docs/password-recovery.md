# U09 — Quên mật khẩu

## Cấu hình email thật (Gmail cho đồ án)

Backend hiện **chưa có SMTP credentials**, vì vậy chưa gửi hoặc xác minh nhận email thật. Không có mã cố định, chế độ in mã ra Terminal hay endpoint đọc mã. Test tự động chỉ dùng mailer mock.

1. Dùng Gmail của bạn làm tài khoản **gửi** email. Bật xác minh hai bước, tạo App Password riêng cho WebNovel theo [hướng dẫn Google](https://support.google.com/accounts/answer/185833). Không dùng mật khẩu đăng nhập Gmail thông thường. Nếu tài khoản không hỗ trợ App Password, có thể dùng SMTP khác hỗ trợ TLS với các biến dưới đây.
2. Thêm vào **backend/.env** trên máy (không gửi thông tin này qua chat):

```dotenv
SMTP_HOST="smtp.gmail.com"
SMTP_PORT=465
SMTP_USER="YOUR_EMAIL@gmail.com"
SMTP_PASS="YOUR_GOOGLE_APP_PASSWORD"
SMTP_FROM="YOUR_EMAIL@gmail.com"
```

Thay placeholder bằng thông tin thật. Với Gmail, SMTP_FROM nên bằng SMTP_USER; App Password gồm 16 ký tự, bỏ khoảng trắng phân nhóm khi sao chép. File .env đã được gitignore; không thêm SMTP credentials vào mobile/.env hay biến EXPO_PUBLIC_. Port 465 dùng TLS trực tiếp; nếu dùng 587, code yêu cầu STARTTLS. Không tắt kiểm tra chứng chỉ.

3. Trong thư mục backend chạy `npm run mail:check`. Lệnh chỉ kiểm tra kết nối/xác thực SMTP, **không gửi email**, không hiển thị credentials. Nếu thất bại, kiểm tra App Password, xác minh hai bước, mạng/cổng SMTP và SMTP_USER. Tham khảo [Nodemailer Gmail](https://nodemailer.com/guides/using-gmail).
4. Khởi động lại tiến trình Backend hiện tại để nạp .env (không mở thêm server trùng cổng). Nếu chưa chạy: `npm run dev`.
5. Reload Expo Go → màn hình Đăng nhập → **Quên mật khẩu?** → nhập email của tài khoản WebNovel mà bạn sở hữu → **Gửi mã xác minh** → kiểm tra Inbox/Spam → nhập mã, mật khẩu mới, xác nhận → **Đặt lại mật khẩu** → đăng nhập bằng mật khẩu mới.

Email gửi đi không đồng nghĩa đã vào Inbox. Nếu email không đến: kiểm tra SMTP bằng lệnh trên, xem Spam và cảnh báo bảo mật Google; chờ ít nhất 60 giây trước khi yêu cầu lại. Không chia sẻ App Password hoặc mã xác minh. Gmail phù hợp demo nhỏ; dịch vụ production nên dùng nhà cung cấp email giao dịch.

## API và hành vi

- `POST /api/auth/forgot-password` nhận `{ email }`; trả 202 chung cho email tồn tại/không tồn tại, tài khoản BANNED hoặc chưa có mật khẩu cục bộ. Không tiết lộ tài khoản có tồn tại hay không.
- `POST /api/auth/reset-password` nhận `{ email, code, newPassword, confirmPassword }`. Mật khẩu 8–128 ký tự, xác nhận phải trùng. Thành công 200, không trả token và không tự đăng nhập.
- Mã ngẫu nhiên 6 chữ số, có thể bắt đầu bằng 0; hết hạn sau 10 phút, tối đa 5 lần thử sai. Mã dùng một lần; yêu cầu lại sau cooldown tạo challenge mới và vô hiệu mã cũ. Không khóa tài khoản do nhập sai mã.
- Mã chỉ lưu HMAC-SHA256 trong password_resets, có phân tách mục đích và dùng JWT_SECRET hiện có làm khóa. Thay JWT_SECRET cũng vô hiệu các mã cũ. Không lưu mã plaintext.
- Reset thực hiện dưới khóa user, đổi hash Argon2id, tiêu thụ mã và thu hồi mọi phiên trong một transaction. Access JWT cũ bị từ chối bởi middleware kiểm tra phiên sẵn có. Login ngăn phiên được tạo từ hash mật khẩu cũ; U10 cũng vô hiệu challenge khôi phục đang chờ.
- 400 cho input/mã sai, hết hạn hoặc đã dùng; 429 khi vượt giới hạn; 503 nếu email chưa cấu hình/hàng đợi đầy; 500 lỗi nội bộ đã lọc. Không trả dữ liệu nhạy cảm trong lỗi.
- Yêu cầu gửi mã: 5/IP/15 phút, 3/email/giờ, cooldown DB 60 giây. Reset: 20/IP/15 phút và tối đa 5 lần thử/challenge trong DB. Rate limit ngoài DB dùng memory store một process, giống Auth hiện tại.
- Tra cứu tài khoản và SMTP chạy nền sau khi chấp nhận yêu cầu, tránh độ trễ SMTP làm lộ tài khoản. Hàng đợi tối đa 20 việc trong process; lỗi chỉ log thông báo chung. Nếu process dừng trước khi gửi xong, người dùng cần yêu cầu lại; chưa thêm hàng đợi bền vững/Redis cho đồ án.
- Mobile dùng client công khai hiện có, không đợi refresh phiên cũ, không tự retry thao tác reset. Mật khẩu/mã chỉ ở state cục bộ, được xóa khi rời màn hình hoặc sau khi gửi; không đặt trong route params, Zustand, cache hoặc SecureStore.

## Database và an toàn

Migration `20261024010000_password_resets` chỉ thêm một bảng, FK Restrict, index expiry và CHECK attempts/expiry; không sửa dữ liệu bảng cũ. Đã kiểm tra SQL và áp dụng test trước rồi main. Có 15 bảng ứng dụng, migration hai DB đã đồng bộ. Đã tạo backup ngoài project, kiểm tra pg_restore đọc/giải mã được trước khi áp dụng. Receipt nội bộ: backend/test-results/u09-migration.json (gitignored).

Fingerprint 14 bảng cũ không đổi ngay sau migration trên cả hai DB. Kiểm thử ghi chỉ dùng UUID fixture trong webnovel_test_db/public; cleanup theo chính UUID/marker của lần chạy, so sánh fingerprint toàn bộ bảng test trước/sau đạt. Không reset, xóa dữ liệu thật, đổi mật khẩu tài khoản thật, sửa truyện hoặc upload Cloudinary.

## File và kiểm thử

Backend thêm config/mail.ts; types/password-reset.types.ts; services/password-reset.{store,service}.ts; middlewares/password-reset.validation.ts; controllers/password-reset.controller.ts; routes/password-reset.routes.ts; scripts/check-mail.ts; model/migration PasswordReset. Sửa app.ts để đăng ký route, auth.store.ts để U10 thu hồi mã cũ, .env.example, package/lock. Cập nhật inventory/cleanup fixture và SQL tham khảo theo schema mới; không thực thi SQL tham khảo.

Mobile thêm ForgotPasswordScreen.tsx, password-recovery.ts và route forgot-password; thêm liên kết tại AuthScreen và khai báo Stack. Có API/UI test và browser smoke riêng.

- Backend U09 HTTP/service/SMTP mock: **11/11**.
- PostgreSQL thật U09: **9/9** (test cha và 8 test con), gồm khóa đồng thời, hết hạn trong khi đợi khóa, rollback thật và tương thích U10. U10 PostgreSQL chạy lại **6/6**.
- Backend mặc định: **271/274**; 3 test cũ đòi DB rỗng thất bại vì DB có dữ liệu. Lần đầu có thêm một lỗi test cũ `fetch: bad port` do cổng ngẫu nhiên; chạy lại Reading **40/40** và bộ đầy đủ không còn lỗi này. Không xóa dữ liệu để ép test đạt.
- Mobile **356/356** (30 suites), typecheck/lint/format đạt; Android bundle thành công, không tạo APK.
- Browser 393×852: mở Quên mật khẩu từ Login → yêu cầu mã → lỗi mã sai → reset thành công → Login; toàn bộ API mock, 0 request ngoài mock, 0 lỗi render.
- Backend typecheck/build, Prisma Validate/Generate và Migration Status đạt. Chưa xác minh email thật hoặc thao tác Android Native thật.

Lệnh từ backend: `npm run test:password-reset`, `npm run test:password-reset:postgres`, `npm run test:password:postgres`, `npm run typecheck`, `npm run build`. Test PostgreSQL bắt buộc INTEGRATION_DATABASE_URL trong .env.integration trỏ đúng webnovel_test_db/public, không fallback sang main. Không dùng runner dọn DB rỗng cho DB đang chứa demo.

Browser smoke từ mobile: chạy Expo Web riêng cổng 8084, rồi `node e2e/password-recovery.mock.cjs`. Không dùng tài khoản thật trong smoke test.

Giới hạn môi trường có sẵn: Node 25.9.0 ngoài engines Mobile; npm audit còn advisory body-parser/fast-uri của dependency hiện có. Không nâng Node/Expo hoặc chạy audit fix ngoài phạm vi U09. Khi deploy thật phải dùng HTTPS; giữ nguyên cấu hình LAN demo hiện tại trong bước này.
