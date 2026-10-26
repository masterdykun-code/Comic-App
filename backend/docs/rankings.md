# U01 — Bảng xếp hạng truyện

API công khai: `GET /api/stories/rankings`.

Query: `kind=reads|rating|updated` (mặc định `reads`), `type=NOVEL|COMIC`
(không bắt buộc), `page=1`, `limit=20` (tối đa 100). Chỉ trả truyện
`PUBLISHED`, phân trang và thứ hạng tuyệt đối trong bảng đã lọc.

- Top lượt đọc: đếm bản ghi ReadingHistory còn lưu, chỉ tính chương đang
  PUBLISHED. Đây là lịch sử người dùng đăng nhập, không phải bộ đếm truy cập
  tích lũy hoặc lượt đọc khách; xóa lịch sử có thể làm giảm số liệu.
- Top đánh giá: điểm trung bình giảm dần, sau đó số đánh giá giảm dần;
  chỉ có truyện đã được đánh giá. Điểm hiển thị làm tròn hai chữ số nhưng
  thứ tự dùng điểm trung bình gốc.
- Mới cập nhật: Story.updatedAt giảm dần, không suy diễn ngày đăng chương.
- Khi bằng nhau: updatedAt giảm dần (nếu phù hợp), rồi UUID tăng dần.

Response gồm `success`, `data`, `pagination`, `ranking`. Mỗi truyện có
metadata công khai, `rank`, `readCount`, `averageScore`, `ratingCount`.
Không trả nội dung chương, dữ liệu tài khoản hoặc thông tin nội bộ.
Truy vấn đếm và lấy trang dùng cùng snapshot RepeatableRead; các request
phân trang riêng vẫn có thể thay đổi thứ hạng khi dữ liệu thực tế thay đổi.

Mobile: Home hoặc Explore → Bảng xếp hạng truyện. Có ba bảng, lọc loại
truyện, tải thêm, kéo để làm mới, thử lại và mở chi tiết bằng UUID.
Không thay đổi Reader, phiên đăng nhập hoặc tiến độ đọc.

## Kiểm tra

Backend: `npm run test:rankings`, `npm run test:rankings:postgres`,
`npm run typecheck`, `npm run build`.

PostgreSQL test chỉ dùng cấu hình `.env.integration`, bắt buộc đúng
`webnovel_test_db/public`. Fixture nằm trong transaction và rollback;
kiểm tra số bản ghi của toàn bộ bảng trước/sau. Không reset hoặc seed DB chính.

Mobile: `npm test -- --runTestsByPath tests/rankings-api.test.ts tests/rankings-ui.test.tsx tests/navigation.test.tsx`.
Smoke Chromium: khởi động Expo Web riêng cổng 8086 rồi chạy
`node e2e/rankings.mock.cjs` trong thư mục mobile. Script chỉ mock GET,
chặn request ngoài danh sách và mọi request ghi. Đây là kiểm thử Web,
không thay thế kiểm tra trực tiếp Android Native.

Không bổ sung schema/migration, không ghi dữ liệu production hoặc gọi Cloudinary.
