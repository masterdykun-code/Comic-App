# Chẩn đoán mạng Android / Expo Go

## Bằng chứng trong phiên kiểm tra

Log Metro đã nhận log có `platform: android` từ ứng dụng, với API baseURL thực tế
`http://192.168.1.43:4001/api`. Chuỗi quan sát được:

```text
session.restore.start
vault.read.start
vault.read.complete
session.restore.empty
request.auth.start -> request.auth.ready
request.start GET /api/stories
request.fail kind=network code=ERR_NETWORK (không có HTTP status)
```

Vì kho phiên trống trong phiên đó, refresh không chặn Stories. Request đã qua
interceptor chuẩn bị phiên và kiểm tra URL. Không có HTTP response/parse failure;
không kết luận lỗi Zod, 400 hoặc 500 từ thông báo lỗi mạng.

Kiểm tra TCP cùng lượt: **không có listener cổng 4001**, GET health từ Windows qua
cả loopback lẫn LAN thất bại `ECONNREFUSED`; IP LAN vẫn thuộc adapter Wi-Fi. Đây là
bằng chứng Backend demo không sẵn sàng tại thời điểm kiểm tra, chưa chứng minh
trạng thái của server khi người dùng truy cập Chrome thành công trước đó.

Không tự khởi động/dừng Backend, không seed, không gọi login/refresh/logout thật,
không thay đổi Database hoặc cấu hình bảo mật Android trong lượt chẩn đoán.

## Thu log tiếp theo trên điện thoại

1. Trong Terminal riêng, thư mục `mobile`, chạy `npm run demo:serve -- 192.168.1.43`.
   Đây là lệnh serve, không phải seed. Giữ Terminal mở; nếu có lỗi dừng, cần xử lý
   lỗi đó trước khi thử Mobile. Không chuyển sang Backend production cổng 4000.
2. Kiểm tra lại `http://192.168.1.43:4001/api/health` trong Chrome điện thoại **ngay
   trước khi** mở Home. Chỉ dùng GET; không đăng nhập/đăng xuất hoặc xóa SecureStore
   để thử sửa lỗi mạng.
3. Giữ Metro hiện tại cổng 8082. Nếu chưa chạy, mở Terminal thứ hai tại `mobile`:
   `npx expo start --go --lan --port 8082`. Không mở thêm process trên cổng đang bận.
4. Mở đúng project bằng QR, dùng Reload trong menu Expo Go. Mở Home rồi Explore,
   nhấn Thử lại một lần; tránh nhấn liên tục gây khó đối chiếu.
5. Tìm các dòng `[WebNovel diagnostic]` trong Terminal Metro, hoặc file log cục bộ
   `.expo/dev/logs/start.log`. Nếu Terminal không hiển thị console trên phiên bản
   đang dùng, nhấn `j` trong Metro để mở React Native DevTools khi Android đã kết
   nối và dùng tab Console. Không bật chế độ remote JavaScript chạy ngoài thiết bị.
6. Chỉ gửi các dòng có prefix trên, từ `api.config` tới request hoàn tất/thất bại.
   Không gửi toàn bộ log, token, header hoặc dữ liệu đăng nhập.

## Đọc kết quả

| Log                                                                            | Ý nghĩa                                                                                   |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------- |
| `api.config`                                                                   | URL thực tế khi client được tạo, platform, timeout                                        |
| `request.auth.start` nhưng chưa có `request.auth.ready`                        | Đang đợi chuẩn bị phiên                                                                   |
| `session.refresh.start/fail` rồi `request.auth.fail`, không có `request.start` | Refresh có thể chặn request trước khi gửi                                                 |
| `request.start`                                                                | Qua các request interceptor, chuẩn bị vào adapter mạng; không chứng minh server nhận được |
| `request.complete status=200`                                                  | Axios nhận phản hồi HTTP thành công                                                       |
| `request.fail kind=http status=400/500`                                        | Có phản hồi HTTP; kiểm tra query/server tương ứng                                         |
| `request.fail kind=timeout`                                                    | Axios báo ECONNABORTED/ETIMEDOUT                                                          |
| `request.fail kind=network code=ERR_NETWORK`                                   | Không nhận được HTTP response; chưa xác định nguyên nhân thấp hơn                         |
| `request.complete` rồi `catalog.parse.fail`                                    | Phản hồi Stories không đúng hợp đồng dữ liệu                                              |

Không suy timeout chỉ từ số mili giây: Android có thể báo ERR_NETWORK dù thời gian
gần 12 giây. Không suy cleartext chỉ từ ERR_NETWORK. Muốn xác nhận cleartext cần
native error/logcat như `Cleartext HTTP traffic ... not permitted`; nếu có ADB,
lọc log đúng process Expo Go và loại thông tin riêng tư trước khi chia sẻ. Chưa có
ADB trong phiên hiện tại. Không thay đổi Android manifest/network security khi chưa
có bằng chứng; cấu hình binary Expo Go không được sửa bằng Fast Refresh JS.

## Phạm vi thay đổi

Chỉ thêm quan sát development, không đổi URL, timeout, thứ tự chuẩn bị phiên, refresh,
retry, lưu/xóa SecureStore hoặc logout. Logic cũ có invalidation khi refresh thất bại;
logging không thêm hay chủ động gọi hành vi đó. Không khởi chạy app/test Native tự
động trong lượt này. Các test mới dùng mock, không gọi Database hoặc SecureStore thật.

Logger chỉ xuất khi `__DEV__` là true. Chỉ giữ event, platform, thời gian, origin
và `/api` của URL cấu hình, route trong allowlist, method, số request, duration,
timeout, loại lỗi, HTTP status và mã lỗi trong allowlist. Loại query/hash, ID/path
không thuộc allowlist, URL credentials; không log body/header/cookie/user hoặc raw error.

Kiểm tra sau thay đổi: typecheck, lint và format đạt; **270/270 test, 20/20 suite**
đạt. Bảy test chẩn đoán mới kiểm tra production không xuất log, loại bí mật, phân loại
lỗi, thứ tự request, refresh chặn trước dispatch, parse failure và logger hỏng không
làm gián đoạn request. Không thực hiện mutation HTTP hay Database thật trong các test.
