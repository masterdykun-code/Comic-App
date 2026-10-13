# HƯỚNG DẪN CHẠY APP COMICAPP (cho người mới)

App đọc truyện chữ gồm 3 phần chạy cùng lúc:

```
Điện thoại / Giả lập (Expo Go)  --->  Backend API (Node.js, cổng 3000)  --->  Database (PostgreSQL trong Docker, cổng 5433)
```

Tóm tắt: mở 2 cửa sổ terminal — một cửa sổ chạy **backend**, một cửa sổ chạy **frontend**. Database chạy ngầm trong Docker.

---

## 0. Chuẩn bị (chỉ làm 1 lần đầu)

1. Cài **Node.js 20+** (kiểm tra: mở PowerShell gõ `node -v`).
2. Cài **Docker Desktop** và mở lên, chờ chữ *Running*.
3. Điện thoại cài app **Expo Go** (trên CH Play / App Store).
4. Trên Windows, mọi lệnh `npm`/`npx` phải gõ là `npm.cmd` / `npx.cmd` (nếu gõ `npm` mà báo lỗi đỏ thì đây là nguyên nhân).

> Lưu ý quan trọng: **điện thoại và máy tính phải dùng chung 1 WiFi** (cùng mạng nhà/trường/công ty). Dùng 4G trên điện thoại là không thấy app.

---

## 1. Khởi động Database (làm mỗi lần mở máy)

```powershell
cd D:\QLDAPM\AppAndroidWebNovel
docker compose up -d postgres
docker ps
```

- Thấy dòng `webnovel_postgres ... Up ... 0.0.0.0:5433->5432` là được.
- Nếu báo lỗi password khi chạy backend ở bước sau:
```powershell
docker exec webnovel_postgres psql -U webnovel -d webnovel_db -c "ALTER USER webnovel WITH PASSWORD 'webnovel123'"
```

---

## 2. Chạy Backend — cửa sổ terminal số 1 (giữ nguyên, không tắt)

```powershell
cd D:\QLDAPM\AppAndroidWebNovel\backend
copy .env.example .env   # chỉ làm 1 lần đầu, nếu chưa có file .env
npm.cmd install          # chỉ làm 1 lần đầu
npm.cmd run migrate:all  # tạo bảng, chạy lại không mất dữ liệu cũ
npm.cmd run seed         # nạp 12 truyện mẫu tiếng Việt + tài khoản admin, chạy lại không bị trùng
npm.cmd run dev          # chạy server
```

- Thấy `🚀 Backend listening on http://localhost:3000` là được.
- Mở trình duyệt trên máy tính vào `http://localhost:3000/health` — thấy `{"status":"ok"}` là backend sống.
- Cửa sổ này **để nguyên** trong suốt buổi test.

---

## 3. Chạy Frontend — cửa sổ terminal số 2 (mở terminal mới)

### Cách A — Chạy trên điện thoại thật (khuyên dùng để demo/bảo vệ)

```powershell
cd D:\QLDAPM\AppAndroidWebNovel\frontend
npm.cmd install     # chỉ làm 1 lần đầu
npm.cmd run start:lan
```

- Màn hình hiện mã **QR**. Mở **Expo Go** trên điện thoại → bấm *Scan QR code* → quét.
- App ComicApp mở lên với 5 tab: Giá sách / Nổi bật / Viết / Kho sách / Tài khoản.
- Điện thoại và máy tính **bắt buộc chung WiFi**. Đổi sang mạng WiFi khác thì:
  1. Chạy `ipconfig`, tìm dòng `IPv4 Address` của Wi-Fi (VD `192.168.1.3`).
  2. Sửa file `frontend/.env`: `EXPO_PUBLIC_API_URL=http://<IP-mới>:3000/api`.
  3. Tắt Metro (Ctrl+C) rồi chạy lại `npm.cmd run start:lan`.
- Muốn test mất mạng (đọc offline): tải chương trước (vào chương → ⚙️ → *Tải chương này đọc offline*), rồi tắt WiFi điện thoại, vào Giá sách → *Tải offline* đọc thử.

### Cách B — Chạy trên giả lập Android Studio (không cần điện thoại)

1. Mở Android Studio → *Virtual Device Manager* → bấm Play ▶️ máy ảo, chờ boot xong hẳn.
2. Mở terminal mới:
```powershell
cd D:\QLDAPM\AppAndroidWebNovel\frontend
npm.cmd run android
```
3. App tự cài vào máy ảo và mở lên. (Giả lập tự dùng địa chỉ `10.0.2.2`, không cần sửa `.env`.)

### Cách C — Chạy nhanh trên trình duyệt (không cần điện thoại/giả lập)

```powershell
cd D:\QLDAPM\AppAndroidWebNovel\frontend
npm.cmd run web
```

- Mở `http://localhost:8081` test click, điều hướng, gọi API. (Một số nút mobile như vuốt chương sẽ không test được ở đây.)

> Cả 3 cách đều dùng chung 1 backend ở Bước 2. Chỉ mở **1 Metro** tại 1 thời điểm (kẹt cổng 8081 nếu mở 2).

---

## 4. Tài khoản để đăng nhập

| Loại | Email | Mật khẩu | Quyền |
|---|---|---|---|
| Admin (có sẵn) | `admin@comicapp.app` | `admin123` | Mọi quyền user + panel **Quản trị** ở tab Tài khoản (xem/xóa truyện, duyệt báo cáo, cấp quyền) |
| User | tự **Đăng ký** trong app (VD `test1@gmail.com` / `123456`) | tự đặt (≥6 ký tự) | đọc, bình luận, vote, điểm danh, viết truyện |

---

## 5. Quy trình test gợi ý (đi hết 1 vòng là đủ demo)

1. **Nổi bật**: tìm kiếm → xem *Đề xuất hàng ngày*, *Yêu thích*, *Mới cập nhật* → đổi 4 tab BXH Tổng/Ngày/Tuần/Tháng.
2. **Kho sách**: lọc thể loại + trạng thái + sắp xếp, sang trang 2.
3. **Chi tiết truyện**: bấm *Đọc tiếp*, *+ Tủ sách*, *Đề cử*, đánh giá sao, bình luận + trả lời, *Báo cáo vi phạm*.
4. **Reader**: đổi cỡ chữ/nền/giãn dòng → mục lục → mở khóa chương VIP bằng coins → tải offline → **tắt WiFi đọc thử**.
5. **Giá sách**: kiểm tra 3 tab *Kệ sách* / *Đã đọc* / *Tải offline*.
6. **Tài khoản**: điểm danh → nhận nhiệm vụ → nạp demo → xem lịch sử coins.
7. **Viết**: tạo truyện mới → thêm chương (thử chương VIP + gợi ý giá) → sửa/xóa.
8. **Admin**: đăng xuất → đăng nhập `admin@comicapp.app` → tab Tài khoản → panel *Quản trị*: xem thống kê, duyệt báo cáo, cấp quyền user.

---

## 6. Lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|---|---|---|
| `password authentication failed for user webnovel` | Sai cổng DB hoặc lệch mật khẩu volume Docker | Giữ `localhost:5433` trong `backend/.env`, chạy lệnh ALTER USER ở Bước 1 |
| `npm.ps1 cannot be loaded` | PowerShell chặn script | Dùng `npm.cmd` thay cho `npm` |
| Quét QR xong Expo Go quay mãi / báo network | Khác WiFi, sai IP `.env`, firewall chặn cổng 3000 | Chung WiFi → đúng IP (`ipconfig`) → mở firewall: `netsh advfirewall firewall add rule name="ComicApp API 3000" dir=in action=allow protocol=TCP localport=3000` (PowerShell admin) |
| Expo Go báo SDK không tương thích | Expo Go quá cũ | Cập nhật Expo Go mới nhất (project dùng SDK 57) |
| App trắng / bấm vào truyện báo lỗi | Backend chưa chạy | Kiểm tra `http://localhost:3000/health` trước, rồi gõ `r` trong Metro để reload |
| Đăng nhập admin không thấy panel Quản trị | Token cũ thiếu `role` | Đăng xuất, đăng nhập lại bằng tài khoản admin |
| Bìa hiện chữ cái thay vì ảnh | Mất mạng (ảnh picsum cần internet) | Có mạng là hiện lại, đây là fallback bình thường |
| Port 8081 bị chiếm | Mở 2 Metro cùng lúc | Tắt bớt, chỉ giữ 1 terminal frontend |

---

## 7. Lệnh tóm tắt (cheat sheet)

```powershell
# Mỗi lần mở máy test:
cd D:\QLDAPM\AppAndroidWebNovel
docker compose up -d postgres

# Terminal 1 - backend:
cd D:\QLDAPM\AppAndroidWebNovel\backend
npm.cmd run dev

# Terminal 2 - frontend (chọn 1):
cd D:\QLDAPM\AppAndroidWebNovel\frontend
npm.cmd run start:lan   # điện thoại thật (quét QR)
npm.cmd run android     # giả lập Android Studio
npm.cmd run web         # trình duyệt

# Lần đầu / khi code mới về:
cd D:\QLDAPM\AppAndroidWebNovel\backend
npm.cmd run migrate:all
npm.cmd run seed
```
