# U05 — Cài đặt đọc NOVEL

Mở một chương NOVEL → **Tùy chỉnh đọc**. Chọn font Mặc định/Có chân/Đơn cách, cỡ 14–30, dòng 1.5/1.8/2.1, nền sáng/sepia/tối. Có xem trước chữ và nút khôi phục mặc định. Font là font hệ thống theo Android/iOS/Web, không tải font qua Internet.

Cài đặt tự lưu bằng AsyncStorage 2.2.0 (Expo chọn bản tương thích SDK57), khóa `webnovel.reader.novel-settings.v1`. Đây là sở thích chung trên thiết bị, không phụ thuộc đăng nhập; không dùng SecureStore, Database hoặc API. Gỡ app/xóa dữ liệu app có thể xóa cài đặt. Reader đợi hydrate trước khi mount chữ; lỗi đọc/ghi có thông báo, không chặn đọc.

Đổi font/cỡ/dòng giữ anchor đoạn UTF-16 theo Reader cũ. Bổ sung font vào layoutKey; sự kiện scroll do restore/relayout không được tự ghi ReadingProgress, kể cả đến trễ hơn 300 ms. Sau thao tác cuộn thực, việc đồng bộ tiếp tục dùng queue/version/conflict handler hiện có. Không sửa ReadingSync, Backend hoặc dữ liệu truyện.

## File thay đổi

- Mới: `src/stores/reader-settings.ts`, `src/features/reader/fonts.ts`, `NovelSettingsPanel.tsx`, `tests/reader-settings.test.ts`, tài liệu này.
- Sửa: `ReaderScreen.tsx`, `NovelContent.tsx`, `tests/reader-ui.test.tsx`, `tests/setup.ts`, `package.json`, `package-lock.json`.
- Không sửa Backend, schema, migrations, Database, Admin Web hoặc cấu hình APK.

## Kết quả kiểm tra

- Typecheck, lint, format: đạt.
- Toàn bộ Jest: **291/291**, 22 suites. Có regression lưu/khôi phục sau restart, dữ liệu hỏng, storage lỗi/timeout, ghi nối tiếp, chọn font/reset, chờ hydrate, giữ anchor và chặn late programmatic scroll.
- Android export/bundle: thành công, không tạo APK.
- Chromium 393×852, API mock: chọn font/size/spacing/dark rồi reload, giữ serif/24px/50px và màu tối; 0 API write, 0 page error. Ảnh kiểm tra ở `test-results/u05-settings-android-layout.png` và `u05-reader-restored.png`.
- Expo Doctor: **20/21**. Một check báo Expo 57.0.30/Router 57.0.28 có bản vá đề xuất 57.0.31/57.0.29; không tự nâng version hoặc tắt check.
- Môi trường Node hiện tại 25.9.0 nằm ngoài engines dự án; các kiểm tra trên vẫn chạy được. Nên dùng Node22/24/26 trong engines khi phát triển. npm audit báo 10 advisory (6 moderate/4 high) trong dependency Expo/tooling; AsyncStorage không có trong danh sách package bị báo. Không chạy audit fix --force hoặc đổi dependency ngoài phạm vi U05.

Chưa kiểm tra Native trực tiếp trên điện thoại cho bản sửa này. Web và Android bundle không thay thế kiểm thử Native.

## Tự kiểm tra trên Android

1. Nếu Metro đang chạy từ trước khi thêm package, khởi động lại bằng `npm start -- --clear`, rồi Reload ứng dụng trong Expo Go.
2. Mở NOVEL, cuộn đến một đoạn giữa chương; mở tùy chỉnh, thử ba font với chữ tiếng Việt, cỡ chữ/dòng/nền. Đóng tùy chỉnh: vẫn ở đoạn đang đọc.
3. Rời Reader rồi mở lại; đóng và mở lại Expo Go: cài đặt vẫn giữ. Tiến độ/Continue Reading tiếp tục theo cơ chế đang có.
4. Thử nền tối và Android Back; bảng tùy chỉnh đóng trước khi rời Reader. Nếu storage có lỗi, đọc thông báo trong bảng tùy chỉnh.

Không cần seed, migration hoặc thay đổi Backend để sử dụng U05.
