# WebNovel / Comic App

Ứng dụng đọc tiểu thuyết và truyện tranh phục vụ học tập, gồm Backend API,
Admin Web và ứng dụng Mobile Android qua Expo.

## Cấu trúc

| Thư mục | Công nghệ | Vai trò |
| --- | --- | --- |
| backend | Express, TypeScript, PostgreSQL, Prisma 7 | API, phân quyền và dữ liệu |
| admin-web | React, TypeScript, Vite | Quản trị nội dung và tài khoản |
| mobile | React Native, Expo SDK 57, TypeScript | Ứng dụng độc giả |

Các chức năng có đăng ký/đăng nhập, thể loại, truyện NOVEL/COMIC, chương,
upload ảnh Cloudinary, Import EPUB, yêu thích, bookmark, lịch sử/tiến độ đọc,
đánh giá, bình luận, xếp hạng, cài đặt Reader, Coin và mở khóa chương VIP.

## Chuẩn bị

- Node.js phù hợp từng package; Mobile khai báo phiên bản trong mobile/.nvmrc.
- npm, PostgreSQL và database cục bộ tên webnovel_db.
- Expo Go tương thích SDK 57 nếu chạy trên điện thoại.
- Cloudinary khi cần upload ảnh; SMTP khi cần gửi email quên mật khẩu.

Không đưa mật khẩu, JWT, API key hoặc secret vào Git. File .env.example chỉ
chứa placeholder. Biến VITE_* và EXPO_PUBLIC_* là cấu hình công khai,
không dùng để chứa credentials.

## Backend

Chạy trong terminal tại thư mục backend:

```powershell
npm ci
Copy-Item .env.example .env
```

Lệnh Copy-Item chỉ dùng khi chưa có .env; không ghi đè cấu hình riêng.
Tự điền DATABASE_URL, JWT_SECRET và credentials dịch vụ cần dùng trong .env.
Mật khẩu trong DATABASE_URL cần URL-encode khi có ký tự đặc biệt.

Với database mới đã tạo đúng tên, kiểm tra migration trước khi áp dụng:

```powershell
npx prisma migrate status
# Chỉ chạy sau khi đã kiểm tra đúng database đích và các migration:
npx prisma migrate deploy
npm run prisma:generate
npm run db
npm run dev
```

API mặc định http://localhost:4000/api; health: GET /api/health.
Không chạy migrate reset hoặc db push để thay thế quy trình migration.
Database đã có dữ liệu cần được sao lưu và kiểm tra trước khi thay đổi.

Tạo ADMIN đầu tiên bằng lệnh thủ công sau khi kiểm tra môi trường:

```powershell
npm run admin
```

Script yêu cầu nhập thông tin tại máy, không có tài khoản/mật khẩu ADMIN mặc định.

## Admin Web

Trong terminal riêng tại admin-web:

```powershell
npm ci
Copy-Item .env.example .env # Chỉ khi chưa có .env
npm run dev
```

Mặc định http://127.0.0.1:5173; VITE_API_BASE_URL trỏ Backend cổng 4000.
Xem thêm admin-web/README.md và các tài liệu module trong thư mục này.

## Mobile

Trong terminal riêng tại mobile:

```powershell
npm ci
Copy-Item .env.example .env # Chỉ khi chưa có .env
npx expo start --lan
```

Điện thoại cần cùng mạng với máy chạy Backend. Đặt EXPO_PUBLIC_API_BASE_URL
thành http://IP_LAN_CUA_MAY:4000/api trong mobile/.env rồi khởi động lại Expo.
Android Emulator thường dùng http://10.0.2.2:4000/api.
Không dùng localhost trên điện thoại để chỉ máy tính.
Xem mobile/README.md và mobile/ANDROID-NATIVE.md.

## Kiểm tra

Backend: npm run typecheck, npm run build và các script test trong package.json.
Admin Web: npm run typecheck, npm run lint, npm run format:check,
npm test, npm run build.
Mobile: npm run typecheck, npm run lint, npm run format:check, npm test.

Kiểm thử PostgreSQL phải dùng webnovel_test_db và file .env.integration riêng,
cấu hình từ backend/.env.integration.example; không dùng database chính cho test ghi.
Một số bài smoke test Backend cũ giả định bảng nội dung trống và sẽ thất bại
nếu chạy trên database đã có truyện. Kiểm tra hợp đồng môi trường trước khi chạy.
Chromium mock của Admin Web: npm run test:e2e:mock.

## Dữ liệu không nằm trong repository

Repository chỉ chứa mã nguồn, migrations, cấu hình mẫu và tài liệu.
Không chứa .env thật, database backup, EPUB, nội dung truyện trích xuất,
file upload, node_modules hoặc bản build. Việc bỏ qua các file này bằng
.gitignore không xóa chúng trên máy.

Các lệnh catalog/import/demo dựa vào dữ liệu cục bộ trong backend/catalog hoặc
backend/imports; các dữ liệu đó không được phân phối cùng repository.
Không chạy seed/import trên database hiện có nếu chưa kiểm tra và xác nhận.
Chỉ đăng tải/phân phối nội dung và bản dịch khi có quyền sử dụng tương ứng.

## Giới hạn hiện tại

- Không có thanh toán thật; Coin phục vụ mô hình đồ án.
- Cấu hình LAN/demo cần được đổi theo môi trường khi triển khai.
- npm audit còn cảnh báo ở Backend và chuỗi dependency Expo; cần xử lý theo
  phiên bản SDK, không tự chạy npm audit fix --force.
- Giấy phép Expo trong mobile/LICENSE thuộc phần template gốc; không phải
  tuyên bố cấp phép toàn bộ mã và nội dung của dự án.
