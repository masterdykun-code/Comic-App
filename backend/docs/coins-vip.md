# Coin và chương VIP

## Cách thử

1. Khởi động Backend và Admin Web như hiện tại; Mobile tiếp tục dùng URL LAN tương ứng Backend. Không cần đổi `.env` hoặc cấu hình thanh toán.
2. Expo Go: đăng nhập → Hồ sơ/Tài khoản → **Ví Coin · Điểm danh · Nhiệm vụ**.
3. Điểm danh nhận 10 Coin. Mở 3 chương khác nhau trong ngày rồi trở về ví nhận 20 Coin; thêm một truyện vào yêu thích rồi nhận 5 Coin. Một ngày tối đa 35 Coin từ các thưởng này. Ngày tính theo `Asia/Ho_Chi_Minh`.
4. Admin Web: Stories → chọn truyện → Chapters → **Chi tiết** chương → **Quyền đọc chương** → chọn VIP, giá mặc định 10 Coin → Lưu → Xác nhận. Có thể đổi về miễn phí tương tự; dùng được cho NOVEL/COMIC, DRAFT/PUBLISHED.
5. Mobile dùng tài khoản USER mở chương VIP đã xuất bản → xem giá/số dư → Mở khóa → Xác nhận. Thiếu Coin sẽ không trừ ví. Đọc lại chương đã mua không bị trừ thêm. ADMIN ACTIVE được đọc nội dung để quản lý mà không cần mua.

## API

Các API `me` và mở khóa cần Access Token hợp lệ, tài khoản ACTIVE. Danh tính lấy từ token; không nhận userId, ngày hoặc số Coin thưởng từ client.

- `GET /api/me/coins?page=1&limit=20`: số dư và lịch sử giao dịch, có phân trang.
- `GET /api/me/coins/tasks`: điểm danh, tiến độ và trạng thái nhận thưởng hôm nay.
- `POST /api/me/coins/check-in`, body `{}`.
- `POST /api/me/coins/missions/READ_THREE/claim`, body `{}`.
- `POST /api/me/coins/missions/FAVORITE/claim`, body `{}`.
- `GET /api/chapters/:id/access`: thông tin giá/quyền đọc; không có nội dung hoặc URL trang ảnh.
- `POST /api/chapters/:id/unlock`, body `{ "expectedCoinPrice": 10 }`: xác nhận đúng giá đang hiển thị. Nếu giá đã thay đổi trả 409 `VIP_PRICE_CHANGED`, không trừ Coin.
- `GET /api/chapters/:id`: trả 402 `CHAPTER_LOCKED` khi VIP chưa có quyền; không trả văn bản hoặc danh sách ảnh. Guest vẫn đọc được chương miễn phí. Token được gửi lên phải hợp lệ.
- API ADMIN tạo/sửa chương hiện tại nhận thêm `isVip` và `coinPrice` (số nguyên 1–100.000); giữ `expectedUpdatedAt` chống ghi đè đồng thời.

## Lưu trữ và an toàn

Migration `20261024020000_coin_wallet_vip` thêm 4 bảng `coin_wallets`, `coin_transactions`, `chapter_unlocks`, `coin_daily_activities`; thêm `chapters.is_vip=false` và `coin_price=10`. Không đổi nội dung hoặc đặt VIP cho chương cũ. Migration đã áp dụng trên main/test sau kiểm tra đích, backup main và đối chiếu dữ liệu cũ.

Số dư ban đầu 0; ví chỉ tạo khi phát sinh giao dịch. Sổ Coin có event key unique cho từng thưởng/ngày và mua/chương. Mỗi người có khóa transaction PostgreSQL dùng chung giữa các process; số dư, sổ giao dịch và quyền mở khóa ghi trong cùng transaction. Không tự thử lại yêu cầu ghi. Có CHECK chống số dư âm/giá và mức thưởng sai. API nhận thưởng/mở khóa có rate limit.

Tiến độ nhiệm vụ ghi cùng transaction yêu thích/lịch sử; tính theo chương khác nhau đã mở và ghi lịch sử thành công, không xác minh người đọc hết từng chữ. Xóa lịch sử/yêu thích không xóa tiến độ thưởng hoặc cho nhận lại. Không truy hồi hoạt động trước khi tính năng được triển khai.

Quyền mua theo user/chapter, không mất khi đổi giá hoặc đổi FREE/VIP. Truyện/chương bị ẩn vẫn tuân thủ quy tắc xuất bản. Xóa chương xóa grant liên quan bằng FK Cascade nhưng giữ sổ Coin; không tự hoàn Coin. URL Cloudinary đang công khai vẫn là URL công khai nếu đã biết; đây là kiểm soát truy cập API, không phải DRM/CDN riêng tư.

Reader dùng cache theo tài khoản và phiên; đăng xuất/đổi tài khoản không tái sử dụng nội dung VIP của người trước. Không dùng tiền thật, không nạp/rút/chuyển Coin.

## Kiểm tra

- Backend: `npm run test:coins`, `npm run test:coins:postgres` (chỉ `webnovel_test_db` từ `.env.integration`, không fallback main). PostgreSQL test tạo UUID fixture riêng, kiểm tra 2 kết nối đồng thời, rollback, CHECK, API bảo vệ nội dung và dọn đúng fixture; số bản ghi trước/sau khớp. Không cần xóa dữ liệu demo đang có.
- Admin Web: `npm test`, `npm run test:e2e:mock`; có kiểm tra hủy/xác nhận FREE/VIP cho cả NOVEL và COMIC.
- Mobile: `npm test`; kiểm tra ví/nhiệm vụ, xác nhận mua, thiếu Coin, Guest, Reader khóa và tách cache khi đăng xuất.
- Các kiểm tra typecheck/build/lint/format và Android bundle đã chạy. Kiểm thử tự động không thay thế thao tác trực tiếp trên điện thoại.
- Bộ Backend cũ còn 3 bài yêu cầu Database trống; thất bại khi main có truyện, không reset/dọn main để vượt test.

Kiểm tra cuối bằng kết nối READ ONLY: cả hai DB đồng bộ 5 migration, 4 bảng Coin chưa có dữ liệu thật/fixture sót. Các bảng truyện/chương/tài khoản khớp backup; `refresh_tokens` thay đổi so với snapshot trong lúc hệ thống đang chạy. Không sửa hoặc khôi phục bảng phiên này trong quá trình triển khai.


Kết quả cuối: Backend typecheck/build và Prisma Validate đạt; Coin unit 6/6, PostgreSQL 14/14. Toàn bộ Backend 299/302 đạt (3 bài Database trống nêu trên). Admin Web typecheck/lint/format/build đạt, unit/UI 171/171, Chromium 16/16. Mobile typecheck/lint/format đạt, unit/UI 371/371, Android bundle thành công. Build Admin Web vẫn có cảnh báo bundle >500 kB. Chưa xác minh thao tác Coin trực tiếp trên điện thoại của người dùng.
