# HƯỚNG DẪN TEST CHI TIẾT - App Đọc Truyện Chữ

## 1. Tổng quan đã làm xong (Phase 1)

✅ **Backend** `D:\QLDAPM\AppAndroidWebNovel\backend\` - Node + Express + PostgreSQL
- `GET /health`, `/api/novels`, `/api/novels/:id`, `/api/novels/:id/chapters`, `/api/categories`, `/api/auth/*`, `/api/bookshelf`
- Schema đã migrate: users, categories, novels, chapters, bookshelf, reading_history, ratings
- Seed 8 truyện + 40 chương mẫu (giống ảnh: Quỷ Xá, Duy nhất là em, v.v.)
- Chạy trên `http://localhost:3000`

✅ **Frontend** `D:\QLDAPM\AppAndroidWebNovel\frontend\` - React Native Expo
- 5 tabs y hệt ảnh: Giá sách / Nổi bật / Viết / Kho sách / Tài khoản
- Stack: NovelDetail, Reader (đổi font, đổi nền, prev/next)
- Kết nối API qua `src/api/client.js` (10.0.2.2 cho emulator, localhost cho web)

✅ **Database** Docker `webnovel_postgres` port 5433 (đổi từ 5432 vì máy bạn đã có postgres-x64-16)

---

## 2. Test Backend (BẮT BUỘC test trước)

### 2.1 Khởi động DB
```powershell
cd D:\QLDAPM\AppAndroidWebNovel
docker compose up -d postgres
docker ps  # phải thấy webnovel_postgres Up, 0.0.0.0:5433->5432
docker logs webnovel_postgres --tail 20
```
Nếu báo `port already in use` → bạn đang có postgres local chạy, giữ nguyên dùng 5433 như hiện tại là đúng.

### 2.2 Migrate & Seed (chỉ chạy 1 lần đầu)
```powershell
cd D:\QLDAPM\AppAndroidWebNovel\backend
npm.cmd run migrate
npm.cmd run seed
# Phải ra: ✅ Migration done / ✅ Seed done
# Nếu báo password failed → chạy:
# docker exec webnovel_postgres psql -U webnovel -d webnovel_db -c "ALTER USER webnovel WITH PASSWORD 'webnovel123'"
```

### 2.3 Chạy backend
```powershell
cd D:\QLDAPM\AppAndroidWebNovel\backend
npm.cmd run dev
# Hoặc: npm.cmd start
# Log phải có: 🚀 Backend listening on http://localhost:3000 + ✅ PostgreSQL connected
```
### 2.4 Test API bằng trình duyệt / curl
Mở trình duyệt:
- http://localhost:3000/health → {"status":"ok"}
- http://localhost:3000/api/novels → danh sách 8 truyện JSON
- http://localhost:3000/api/novels/1 → chi tiết truyện 1
- http://localhost:3000/api/novels/1/chapters → 5 chương
- http://localhost:3000/api/categories → 7 thể loại

Test bằng PowerShell:
```powershell
Invoke-WebRequest http://localhost:3000/health -UseBasicParsing | Select-Object -Expand Content
Invoke-WebRequest http://localhost:3000/api/novels -UseBasicParsing | Select-Object -Expand Content
```


### 2.5 Test Auth
```powershell
# Đăng ký
Invoke-WebRequest -Uri http://localhost:3000/api/auth/register -Method POST -Body '{"username":"test1","email":"test1@gmail.com","password":"123456"}' -ContentType "application/json" -UseBasicParsing | Select-Object -Expand Content
# Đăng nhập
Invoke-WebRequest -Uri http://localhost:3000/api/auth/login -Method POST -Body '{"email":"test1@gmail.com","password":"123456"}' -ContentType "application/json" -UseBasicParsing | Select-Object -Expand Content
```

---

## 3. Test Frontend trên giả lập

### 3.1 Yêu cầu
- Node v24 ✅ đã có
- Docker ✅
- **Chọn 1 trong 2 cách:**
  - **A. Expo Go + Điện thoại / Giả lập Android Studio** (khuyên dùng cho đồ án)
  - **B. Web browser** (test nhanh không cần giả lập)

### 3.2 Cách A - Chạy trên Android Emulator (giống yêu cầu: chạy giả lập trên máy tính, không qua điện thoại)

1. Cài Android Studio → More Actions → Virtual Device Manager → Create Device → Pixel 7 → System Image Android 14 → Finish → Play ▶️ để khởi động emulator. Kiểm tra:
```powershell
# Sau khi cài Android Studio, adb sẽ có ở:
C:\Users\%USERNAME%\AppData\Local\Android\Sdk\platform-tools\adb.exe
& "C:\Users\...\adb.exe" devices  # phải thấy emulator-5554 device
```

2. Chạy frontend:
```powershell
cd D:\QLDAPM\AppAndroidWebNovel\frontend
npm.cmd install  # đã cài rồi, bỏ qua nếu đã chạy
npm.cmd run android
# Hoặc: npx expo start --android
# Lệnh này sẽ build và cài APK lên emulator, thấy app WebNovel mở lên với 5 tabs như ảnh.
```

**Lưu ý IP:** `src/api/client.js` đã config:
```js
Platform.OS === 'web' ? 'http://localhost:3000/api' : 'http://10.0.2.2:3000/api'
```
`10.0.2.2` là localhost của máy host khi nhìn từ emulator. Nếu dùng Expo Go qua WiFi/LAN thì đổi thành IP máy bạn (ví dụ `http://192.168.1.x:3000/api`) và chạy `ipconfig` để lấy.

3. Kiểm tra trong emulator:
- Tab **Giá sách**: thấy banner "Gợi Ý Hàng Ngày", tab "Danh sách sách", card "Favourite Books", grid "Gợi ý cho bạn (từ API)" load từ backend.
- Tab **Nổi bật**: grid "Yêu Thích" 8 truyện, list "Xếp Hạng" sắp theo views.
- Tab **Kho sách**: trái là filter "Thể loại/Cấp/.../Phổ biến", phải là "Bảng xếp hạng".
- Tab **Tài khoản**: Số dư Coins, Phần thưởng, Cửa hàng.
- Nhấn vào bất kỳ truyện nào → **NovelDetail** → Nhấn "Đọc ngay" → **Reader** (đổi cỡ chữ A+, đổi nền, nút Trước/Tiếp).

### 3.3 Cách B - Test nhanh trên Web (không cần emulator)
```powershell
cd D:\QLDAPM\AppAndroidWebNovel\frontend
npm.cmd run web
# Mở http://localhost:8081 hoặc http://localhost:19006
```
Sẽ thấy giao diện tương tự, có thể test click điều hướng, gọi API.

### 3.4 Cách C - Expo Go trên điện thoại (nếu muốn demo nhanh)
```powershell
cd D:\QLDAPM\AppAndroidWebNovel\frontend
npm.cmd start
# Quét QR bằng Expo Go (Android) hoặc Camera (iOS)
```

---

## 4. Lỗi thường gặp & cách fix

| Lỗi | Nguyên nhân | Fix |
|-----|-------------|-----|
| `password authentication failed for user webnovel` | Port 5432 bị postgres local chiếm, hoặc password lệch giữa volume và env | Dùng port 5433 như đã fix; chạy `docker exec webnovel_postgres psql -U webnovel -d webnovel_db -c "ALTER USER webnovel WITH PASSWORD 'webnovel123'"` |
| `npm.ps1 cannot be loaded` | PowerShell ExecutionPolicy | Dùng `npm.cmd` thay vì `npm` |
| `adb not recognized` | Chưa cài Android Studio / chưa thêm vào PATH | Cài Android Studio, thêm `Sdk\platform-tools` vào PATH |
| Frontend trắng màn hình | Backend chưa chạy | Đảm bảo `http://localhost:3000/health` trả về ok trước khi mở app |
| Ảnh không load | `cover_url` dùng picsum | Bình thường, picsum cần internet |

---

## 5. Roadmap tiếp theo (vibe dần dần)

Mình đề xuất đi theo thứ tự, mỗi phase xong bạn test rồi mới sang phase sau:

**Phase 2 (tiếp theo):** Hoàn thiện Backend - Auth JWT lưu bằng SecureStore, bookshelf API có auth, tìm kiếm/filter, phân trang, upload cover.

**Phase 3:** Frontend - Search bar thực, lọc theo thể loại, đăng nhập/đăng ký UI, lưu token, thêm/xóa khỏi Giá sách, Reader lưu lịch sử đọc.

**Phase 4:** Viết truyện (Write tab) - cho user tạo truyện, thêm chương, quản lý truyện của mình.

**Phase 5:** Polish - dark mode trong Reader, đánh giá 5 sao, bình luận, xếp hạng theo tuần/tháng, build APK.

Bạn muốn mình làm **Phase 2** luôn bây giờ không? Hoặc bạn test Phase 1 trước và báo lỗi để mình fix?
