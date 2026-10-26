# Bước 16.2 — Android Native QA

## Kết quả tiếp tục ngày 18/10/2026

Người dùng xác nhận đã mở ứng dụng bằng Expo Go trên Android. QA chưa trực tiếp
điều khiển hoặc quan sát thiết bị; không đánh dấu toàn bộ chức năng Native đã đạt.

Xác nhận trực tiếp từ người dùng trong lượt này: **Home và Explore mở được trên
điện thoại thật, hiển thị chưa có truyện**. Chưa xác nhận tải một truyện có dữ liệu.
GET công khai từ Windows qua LAN trả HTTP 200: Stories có tổng 0, Genres có danh
sách rỗng. Kết quả này phù hợp giao diện rỗng; không chứng minh toàn bộ API trên
điện thoại đã hoạt động và không tạo dữ liệu mẫu để kiểm tra.

| Bằng chứng                          | Kết quả                                                                 |
| ----------------------------------- | ----------------------------------------------------------------------- |
| Metro đang chạy                     | Cổng 8082, `/status` HTTP 200                                           |
| Log `.expo/dev/logs/start.log`      | Hai request bundle Android, hoàn tất lúc 22:30 và 22:32 (giờ Việt Nam)  |
| Client warn/error trong log hiện có | 0; không thay thế logcat hoặc chứng minh không có lỗi Native            |
| ADB                                 | Không có thiết bị; không đọc được logcat                                |
| Metro inspector                     | Không có target tại thời điểm kiểm tra                                  |
| API trong `.env`                    | HTTP qua IP LAN, cổng 4000, path `/api`, không có credentials trong URL |
| GET health qua IP LAN từ Windows    | HTTP 200, JSON đúng yêu cầu                                             |
| Kết nối API từ điện thoại           | Chưa trực tiếp xác minh                                                 |

Không sửa `.env`, không khởi động lại Metro/Backend đang chạy. Chỉ gọi GET health;
không đăng nhập, đăng ký hoặc gọi API ghi dữ liệu. Không chạy integration test ghi.

## Rà mã nguồn và sửa tối thiểu

- `app.json` đã khai báo plugin `expo-secure-store`. Native sử dụng SecureStore,
  kiểm tra availability, không lưu Refresh Token vào AsyncStorage. Web dùng bộ nhớ.
  Đây là kiểm tra cấu hình và mock test, chưa chứng minh lưu phiên thực trên Android.
- Expo Router có Stack và các route Home/Explore/Library/Profile, Auth và Reader.
- Reader trước đây chỉ chờ lưu tiến độ khi dùng nút Back trong giao diện. Android
  system Back có thể đi vòng qua cơ chế đó. Đã thêm `hardwareBackPress` bằng
  `useFocusEffect`, chỉ đăng ký khi Reader có focus và gỡ khi blur/unmount.
- System Back dùng cùng hàng đợi đóng/lưu với nút Back; chặn nhấn lặp lúc đang lưu.
  Regression test giữ request lưu ở trạng thái chờ, xác minh chưa đổi route rồi mới
  cho phép chuyển khi lưu hoàn tất. Không gọi API thật trong test.
- Các modal Reader có `onRequestClose`; cần kiểm tra nút/gesture Back thật để xác nhận
  đóng modal trước khi rời Reader. Thay đổi Back chưa được xác minh trên thiết bị.

Các file thay đổi trong lượt này: `src/features/reader/ReaderScreen.tsx`,
`tests/reader-ui.test.tsx` và tài liệu này. Không sửa Backend, schema hoặc migration.

## Kiểm tra tự động

Kết quả: typecheck đạt; Expo lint đạt; format toàn dự án đạt; **249/249 test, 17/17
suite đạt**; Expo Doctor **21/21**; Android Hermes bundle thành công trong `dist`
(không phải APK). Regression Reader đạt **20/20**. Sử dụng Node 24.19.0 LTS;
không đổi Node toàn hệ thống. Lượt đầu sandbox chặn Jest ghi cache (EPERM), chặn
Hermes ghi file tạm và chặn DNS của Expo Doctor; đã yêu cầu chạy lại ngoài sandbox.
Đây là lỗi môi trường kiểm tra, không phải bằng chứng lỗi runtime Android.

Cảnh báo `NO_COLOR` bị bỏ qua vì `FORCE_COLOR` đến từ môi trường CLI; không phải lỗi
của ứng dụng trên điện thoại. Không nâng cấp Expo hoặc dependencies để xử lý cảnh báo.

## Hạng mục Native còn phải kiểm tra

- Từ trình duyệt điện thoại mở health của Backend qua cùng IP LAN để xác nhận mạng.
  Không dùng localhost trên điện thoại. Không tắt Firewall hoặc mở PostgreSQL ra LAN.
- Home/Explore/Library/Profile, Safe Area, bàn phím, điều hướng và Android Back.
- SecureStore, Login/Register, đóng/mở app, refresh rotation, logout, background/foreground.
- NOVEL: xuống dòng, font/theme, cuộn dài, khôi phục vị trí, đổi chương và Back trong khi lưu.
- COMIC: thứ tự ảnh, cuộn, tải lỗi/thử lại, khôi phục trang, đổi chương.
- Favorites, Continue Reading, History, Ratings/Comments và sửa Profile.
- Mất mạng/đổi mạng, background/foreground khi đang lưu; startup, FPS và memory chưa đo.

Mọi kiểm tra có ghi (kể cả login/refresh và Reader đã đăng nhập) phải dùng Backend
riêng với `webnovel_test_db` và fixture được quản lý. Không thực hiện trên `webnovel_db`.
Không tạo APK/AAB, không gọi Cloudinary thật. Unit/UI tests và Android bundle không
thay thế Native smoke test. Dừng ở Bước 16.2, chưa bắt đầu bước tiếp theo.
