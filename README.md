# WebNovel - App Đọc Truyện Chữ (Android)

App đọc truyện chữ kiểu WebNovel: đọc truyện, giá sách, xếp hạng, bình luận, coins/unlock chương VIP, tự đăng truyện, phân quyền user/admin. Chạy giả lập Android trên máy tính, không cần điện thoại thật.

## Công nghệ

| Phần | Stack |
|---|---|
| Frontend | React Native (Expo SDK 52), React Navigation (bottom tabs + stack), axios |
| Backend | Node.js + Express, JWT (7 ngày), bcrypt, multer (upload bìa) |
| Database | PostgreSQL 15 (chạy bằng Docker) |

## Tính năng

- **Đọc truyện**: lưu cỡ chữ/theme/giãn dòng, mục lục, thanh tiến trình %, toàn màn hình, vuốt đổi chương, chương khóa VIP mở bằng coins, tải chương đọc offline.
- **Khám phá**: banner carousel, BXH Ngày/Tuần/Tháng, dải Mới cập nhật, tìm kiếm có debounce + lịch sử, lọc thể loại/trạng thái/sắp xếp, phân trang.
- **Tương tác**: đánh giá sao + biểu đồ phân bố, bình luận trả lời/like/xóa, chia sẻ, báo cáo vi phạm.
- **Coins**: điểm danh chuỗi ngày, 4 nhiệm vụ hàng ngày, nạp demo, lịch sử giao dịch, vote Đề cử.
- **Viết truyện**: dashboard thống kê, tạo/sửa/xóa truyện và chương, trạng thái nháp, đặt giá chương VIP, upload ảnh bìa.
- **Tài khoản**: sửa profile, đổi mật khẩu, kệ sách + lịch sử đọc (đọc tiếp đúng chương, xóa từng mục/xóa hết).
- **Admin**: thống kê hệ thống, xóa mọi truyện, cấp/hạ quyền user, duyệt báo cáo vi phạm.

## Cấu trúc

```
AppAndroidWebNovel/
  backend/           # API Express (src/routes, middlewares, migrate/seed)
  frontend/          # App Expo (src/screens, api, context, components, theme)
  docker-compose.yml # PostgreSQL (port host 5433) + backend (port 3000)
  HUONG_DAN_TEST.md  # hướng dẫn test chi tiết từng màn hình
```

## Yêu cầu

- Node.js 20+ và npm
- Docker Desktop (đang chạy)
- Android Studio + 1 máy ảo Android (VD: Pixel 7, Android 14)
- Cùng 1 terminal chạy Metro (Expo), không mở 2 Metro cùng lúc (kẹt port 8081)

## Triển khai từ đầu (làm đúng thứ tự)

### Bước 1 — Database (Docker)

```powershell
cd D:\QLDAPM\AppAndroidWebNovel
docker compose up -d postgres
docker ps   # phải thấy webnovel_postgres Up, 0.0.0.0:5433->5432
```

> Port host là **5433** (vì nhiều máy đã có PostgreSQL local chiếm 5432).
> Lần đầu / khi đổi schema mà báo lỗi password: `docker exec webnovel_postgres psql -U webnovel -d webnovel_db -c "ALTER USER webnovel WITH PASSWORD 'webnovel123'"`.

### Bước 2 — Backend (chạy local, nối DB Docker)

```powershell
cd D:\QLDAPM\AppAndroidWebNovel\backend
copy .env.example .env   # nếu chưa có .env; file .env mẫu đã trỏ đúng localhost:5433
npm install              # lần đầu
npm run migrate:all      # tạo toàn bộ bảng (migrate.js + migrate_phase45.js)
npm run seed             # 12 truyện mẫu + tài khoản admin
npm run dev              # chạy API ở http://localhost:3000
```

Kiểm tra trình duyệt: `http://localhost:3000/health` phải trả `{"status":"ok"}`.
Nếu đổi code backend thì `npm run dev` (nodemon) tự reload; đổi schema thì chạy lại `migrate:all`.

### Bước 3 — Frontend trên giả lập Android

1. Mở Android Studio → Virtual Device Manager → Play máy ảo, chờ boot xong hẳn.
2. Mở terminal mới (terminal cũ vẫn để backend chạy):

```powershell
cd D:\QLDAPM\AppAndroidWebNovel\frontend
npm install      # lần đầu
npm run android  # build vào Expo Go trên giả lập
```

> App gọi API qua `http://10.0.2.2:3000` (localhost của máy host khi nhìn từ giả lập) — đã cấu hình sẵn trong `src/api/client.js`, không cần sửa.
> Chạy trên trình duyệt thay giả lập: `npm run web` (dùng `http://localhost:3000`).

### Bước 4 — Đăng nhập và dùng thử

| Tài khoản | Dùng để |
|---|---|
| User: `test1@gmail.com` / `123456` (tự Đăng ký tài khoản mới cũng được) | đọc, vote, bình luận, điểm danh, viết truyện |
| Admin: `admin@webnovel.app` / `admin123` | tất cả quyền user + panel **Quản trị** ở tab Tài khoản |

Flow gợi ý: Nổi bật (tìm kiếm, BXH) → Kho sách (lọc) → Chi tiết (Đọc tiếp, đề cử, đánh giá, bình luận, báo cáo) → Reader (đổi theme, mục lục, mở khóa chương VIP, tải offline) → Giá sách (tủ, lịch sử, offline) → Tài khoản (điểm danh, nhiệm vụ, nạp demo) → Viết (đăng/sửa/xóa truyện + chương) → login admin duyệt báo cáo.

## API chính

```
GET  /health
POST /api/auth/register | POST /api/auth/login | GET /api/auth/me
GET  /api/novels?search=&category=&status=&sort=&period=daily|weekly|monthly&page=&limit=
GET  /api/novels/featured/banner | GET /api/novels/:id | GET|POST /api/novels (auth)
PUT|DELETE /api/novels/:id (chủ truyện hoặc admin)
GET  /api/novels/:id/chapters | POST (auth) | PUT|DELETE /:novelId/chapters/:num (chủ/admin)
GET|POST /api/novels/:id/ratings | GET|POST /api/novels/:id/comments (auth khi gửi)
POST /api/novels/comments/:commentId/like | DELETE /api/novels/comments/:commentId (chủ/admin)
POST /api/novels/:id/reports (auth)
GET|POST|DELETE /api/bookshelf/* (auth) | GET|POST|DELETE /api/history/* (auth)
GET /api/wallet/me | POST /wallet/checkin|recharge|unlock|vote | GET|POST /wallet/missions*
GET /api/admin/stats|novels|users|reports (admin) | DELETE /api/admin/novels/:id | PUT /api/admin/users/:id/role
```

## Lỗi thường gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `password authentication failed for user webnovel` | Đang trỏ nhầm port 5432 hoặc lệch pass volume: giữ `localhost:5433` trong `.env`, chạy lệnh ALTER USER ở Bước 1 |
| `npm.ps1 cannot be loaded` (PowerShell) | Dùng `npm.cmd` thay cho `npm` |
| Port 8081 bị chiếm / Metro hỏi input | Tắt bớt terminal expo, chỉ giữ 1 Metro rồi trả lời prompt |
| Giả lập thấy app mà bấm không ăn | Cold Boot giả lập (Device Manager → ⋮ → Cold Boot Now); máy yếu không nên chạy Docker + Metro + giả lập cùng lúc ở chế độ nặng |
| Ảnh bìa hiện chữ cái thay vì ảnh | Bình thường khi mất mạng (picsum cần internet) hoặc URL uploads cũ — đã có fallback, có mạng là hiện lại |
| Không thấy panel Quản trị | Đăng xuất rồi đăng nhập lại bằng tài khoản admin (token cũ thiếu `role`) |
| Frontend trắng màn hình | Backend chưa chạy — kiểm tra `/health` trước rồi bấm `r` trong Metro để reload |

## Ghi chú cho người chấm/bảo vệ

- Truyện seed (`owner_id` null) để mở cho dễ demo; truyện do user tạo thì chỉ chủ sở hữu và admin được sửa/xóa (trả 403 nếu không có quyền).
- Nạp coins là demo, không thanh toán thật. Unlock chương VIP trừ đúng `price_coins`.
