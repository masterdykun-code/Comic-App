# APK Android demo — đã cấu hình, chưa build

## Cấu hình đã áp dụng

- Expo 57.0.30 / React Native 0.86.3; giữ nguyên SDK và thư viện native hiện có.
- Android applicationId `com.webnovel.reader.demo`, versionCode `1`, version `1.0.0`.
- `app.config.js` kế thừa app.json, bảo toàn plugin và `extra.eas.projectId`.
- Khi `APP_VARIANT=demo`, tên app là **WebNovel Reader Demo**, cho phép HTTP qua
  `expo-build-properties ~57.0.22`. Mặc định và biến thể khác: cleartext **false**.
- `eas.json` có duy nhất profile `preview-apk`: `distribution=internal`,
  `developmentClient=false`, `android.buildType=apk`, environment `preview`,
  Node 24.19.0, version lấy local. Không dùng Gradle debug command hoặc dev client.
- Env riêng profile: APP_VARIANT=demo và
  EXPO_PUBLIC_API_BASE_URL=http://192.168.1.43:4001/api.
- APK release sẽ chứa JS bundle/assets để mở không cần Expo Go/Metro; chưa tạo APK
  nên chưa xác minh độc lập trên thiết bị bằng artifact thực tế.

Cleartext được bật cho bản demo vì API và ảnh minh họa dùng HTTP LAN. Không dùng
profile này làm production; khi chuẩn bị bản chính thức cần HTTPS và package/profile
riêng. Không thay đổi chính sách bảo mật của điện thoại.

## Giới hạn mạng

Backend demo và ảnh vẫn cần máy Windows đang chạy, cùng LAN, đúng IP 192.168.1.43,
port 4001 và webnovel_test_db. APK độc lập không có nghĩa dữ liệu đọc offline.
Sửa .env trên laptop không đổi URL đã nhúng trong APK; đổi IP cần build lại (chưa
cấu hình OTA update). Không seed lại hoặc thay đổi dữ liệu để chuẩn bị build.

## Bảo vệ source và secrets

`.easignore` kế thừa toàn bộ .gitignore và loại thêm .env*, credentials.json,
keystore, .expo/logs, dist*, test output, tests, scripts, e2e và tài liệu QA.
Không loại app config, src, assets hoặc package-lock. Git root của project là mobile,
không bao gồm Backend và các file .env Backend. Test xác nhận các quy tắc ignore.

Không đặt password, JWT, API secret, DATABASE_URL hoặc credential vào extra,
EXPO_PUBLIC hoặc profile env. URL API công khai được cấu hình trực tiếp trong profile,
không cần upload .env. Chưa tạo/upload archive EAS; phải kiểm tra lại archive và các
EAS environment variables trước build sau khi chủ dự án xác thực. Diagnostic logger
chỉ chạy khi **DEV** true, có regression test production không xuất log.

## Kiểm tra đã chạy

- Manifest introspection (không prebuild/build): package/versionCode đúng; cleartext
  `true` cho demo và `false` cho mặc định; có quyền INTERNET.
- Typecheck, lint, format đạt; 276/276 test, 21 suite đạt.
- Expo Doctor 21/21; `expo install --check` xác nhận dependency khớp SDK.
- npm audit --omit=dev báo 61 advisory (16 moderate, 45 high) trong dependency graph,
  gồm cả công cụ liên quan build/test. Chưa phân loại khả năng ảnh hưởng APK thực tế;
  không tự chạy audit fix hoặc nâng SDK ngoài phạm vi. Cần rà riêng trước phát hành.
- Npm installer trên máy có cảnh báo Node 25 hệ thống; các bước kiểm tra dùng Node
  24.19.0 LTS và profile EAS ghim Node 24.19.0; không thay Node toàn hệ thống.

Chưa compile native release, chưa tạo APK, chưa đăng nhập/liên kết project hoặc
cấu hình signing. Không thay đổi Backend, schema, migration, Database hoặc fixture.

## Chủ dự án thực hiện xác thực

Trong Terminal cục bộ, dùng Node 24 LTS:

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\mobile
npx eas-cli@latest login
npx eas-cli@latest init
```

Giữ slug `webnovel-reader` và applicationId đã cấu hình. Nếu dynamic app.config.js
khiến CLI không tự lưu được projectId, chỉ thêm UUID do EAS cấp vào app.json tại
`expo.extra.eas.projectId`; không bịa ID, không gửi token hoặc mật khẩu qua chat.
Không cần chạy build:configure ghi đè profile đã tạo. Khi hoàn tất, chỉ báo đã đăng
nhập/liên kết để kiểm tra tiếp. Android signing chưa được thiết lập; có thể để EAS
sinh và lưu keystore khi bước build được phê duyệt. Giữ signing key cho các lần cập nhật.

## Chỉ chạy build sau xác nhận cuối cùng

```powershell
npx eas-cli@latest build --platform android --profile preview-apk
```

Build cần Internet và upload source lên EAS, không cần cloud worker truy cập LAN
Backend. Không submit lên Play Store ở bước này. Sau build, tải APK, cài trên điện
thoại, đóng Expo Go và dừng Metro để kiểm tra mở độc lập. Kiểm tra Guest Home/Explore,
NOVEL/COMIC và ảnh; chỉ tự đăng nhập USER demo khi thực hiện kiểm thử có ghi đã được
cho phép. SecureStore của APK tách khỏi Expo Go, không tự mang phiên cũ sang.

Tài liệu: [EAS APK](https://docs.expo.dev/build-reference/apk/),
[BuildProperties SDK 57](https://docs.expo.dev/versions/v57.0.0/sdk/build-properties/),
[Thiết lập EAS](https://docs.expo.dev/build/setup/).
