# U06 — Cài đặt đọc COMIC

## Sử dụng trong Expo Go

Reload ứng dụng → mở truyện **COMIC** → một chương → **Tùy chỉnh đọc**.

- **Cuộn dọc**: giữ FlatList cũ, tải ảnh theo cửa sổ nhỏ, retry và đọc tiếp từ trang đã lưu.
- **Từng trang**: hiển thị một ảnh vừa vùng đọc, dùng **Trước / Sau**. Chuyển theo danh sách ảnh thực tế, kể cả số trang không liên tiếp; nút đầu/cuối bị vô hiệu hóa đúng vị trí.
- Nhấn biểu tượng phóng to trên ảnh để mở màn hình xem chi tiết. Dùng **+ / −** từ 100% đến 300% (có thể giới hạn thấp hơn cho ảnh quá dài), kéo ngang/dọc để xem, nút đặt lại về 100%. Bản này zoom bằng nút, không triển khai pinch gesture.
- Nút X hoặc Android Back đóng ảnh phóng to, giữ nguyên trang đang đọc. Chuyển chương/đổi kích thước màn hình sẽ reset zoom; không lưu zoom tạm thời.
- Ở trang cuối của chế độ từng trang, chỉ nút **Đã đọc hết chương** mới đánh dấu 100%; nút yêu cầu ảnh cuối đã tải. Mở lại trang cuối không tự đánh dấu hoàn tất.

Mode tự lưu trên thiết bị qua AsyncStorage, khóa riêng `webnovel.reader.comic-settings.v1`, version 1. Mặc định vertical; không ghi đè cài đặt NOVEL hoặc SecureStore. Hydrate xong mới mount nội dung COMIC. Dữ liệu lỗi/timeout dùng vertical và báo notice trong tùy chỉnh; lỗi ghi vẫn cho đọc.

Đổi mode giữ pageNumber hiện tại, không tự lưu progress do remount/layout. Trang đã lưu tiếp tục qua ReadingSync với version/queue/409 như trước. Nút chuyển trang là thao tác đọc và được đưa vào queue hiện có; zoom không thay đổi vị trí/tiến độ. Không thay ý nghĩa scrollOffset của Backend.

## Mã nguồn

- Mới: `src/stores/comic-settings.ts`, `src/features/reader/ComicModePicker.tsx`, `ComicPageViewer.tsx`.
- Bổ sung vào `ComicContent.tsx` và `ReaderScreen.tsx`, giữ luồng cuộn dọc và tái sử dụng component ảnh hiện có cho từng trang.
- Test mới `tests/comic-settings.test.ts`, `tests/comic-reader.test.tsx`; mở rộng `reader-ui.test.tsx`.
- Không cài thêm package, không sửa NOVEL content/settings, Backend, Database, Prisma, Admin Web hoặc cấu hình APK.

## Kiểm tra đã chạy

- Mobile typecheck, lint, format: đạt.
- **310/310 tests, 24 suites**: gồm lưu/khôi phục mode sau restart, storage lỗi/hỏng/timeout/ghi nối tiếp, mode switching, pageNumber không liên tục, ảnh lỗi/retry, fit ảnh theo viewport, zoom limits/reset/Back, không tự ghi progress khi zoom/restore, lưu page qua queue và expectedUpdatedAt. Test NOVEL/Auth/Library hiện có vẫn đạt.
- Android export thành công bằng `npm run export:android -- --max-workers 2`; chỉ bundle, không tạo APK.
- Chromium 393×852, toàn bộ API và ảnh mock: chọn paged, chuyển trang 1→3, zoom 200%, cuộn ngang/dọc, đóng viewer giữ trang, đổi vertical giữ trang, reload giữ paged. Kết quả 0 API write và 0 page error; không gọi Backend/Cloudinary thật. Ảnh xem trước ở `test-results/u06-comic-settings.png`, `u06-comic-paged.png`, `u06-comic-zoom.png`.

Chưa xác minh trên thiết bị Android thật trong lượt này. Web và bundle không thay kiểm thử Native. Expo Doctor từ bước U05 còn thông báo hai patch Expo/Router mới hơn; bước U06 không đổi version.

## Checklist Android cần xác nhận

1. Cuộn dọc đến giữa chương, đổi từng trang rồi đổi lại: vẫn ở cùng trang, không nhảy đầu chương.
2. Chuyển Trước/Sau với chương có nhiều trang; ảnh vừa màn hình và nút cuối/đầu đúng.
3. Mở zoom, bấm +/−, kéo ảnh ngang/dọc và Android Back. Kiểm tra riêng thao tác kéo ảnh trong hai ScrollView lồng nhau trên Android.
4. Đóng/mở ứng dụng: mode giữ nguyên; Continue Reading vẫn mở trang đã lưu với tài khoản đang đăng nhập.
5. Thử ảnh lỗi/retry, nền tối, chương một trang và ảnh rất dài. Không gửi dữ liệu thật bằng test tự động; thao tác tài khoản thật do người dùng thực hiện có chủ đích.

Không build APK, seed, upload Cloudinary hoặc thay đổi dữ liệu truyện trong bước triển khai.
