# WebNovel Reader — Bước 16.1

Ứng dụng độc giả React Native + Expo + TypeScript strict, độc lập với `backend` và
`admin-web`. Home, Explore, Search và Story Detail đã kết nối API GET công khai.
Xem [STORIES.md](STORIES.md) để biết hợp đồng API, file thay đổi và kiểm thử Bước 15.2.
Reader NOVEL/COMIC đã hoàn thành; xem [READER.md](READER.md) cho tiến độ, kiểm thử và giới hạn.
Unit/UI tests dùng mock; integration Bước 16.1 chỉ ghi fixture qua Backend thật vào
`webnovel_test_db` đã xác minh, rồi cleanup. Không ghi Database chính hoặc gọi Cloudinary.
Login/Register, Profile, Library/Continue Reading và History đã có giao diện thật. Xem
[AUTH-LIBRARY.md](AUTH-LIBRARY.md) cho file, hợp đồng API, bảo mật và kết quả Bước 15.4.
Ratings, Comments/Replies và sửa Profile đã hoàn thành trong Bước 15.5. Xem
[FEEDBACK-PROFILE.md](FEEDBACK-PROFILE.md) cho file thay đổi, API và kiểm thử Bước 15.5.
Bộ kiểm thử tích hợp Expo Web → Express → PostgreSQL test nằm tại
[INTEGRATION.md](INTEGRATION.md), gồm môi trường cô lập, fixture, cleanup và cách chạy.
Kiểm tra Bước 16.2 chưa tìm thấy emulator/thiết bị Android: xem
[ANDROID-NATIVE.md](ANDROID-NATIVE.md) cho kết quả môi trường, hướng dẫn Expo Go và
checklist Native còn chờ thiết bị. Kết quả bundle/Jest không phải chứng nhận Native.

## Phiên bản và môi trường

- Expo SDK **57.0.30**, React Native **0.86.3**, React **19.2.3**.
- Expo Router **57.0.28**; native packages theo `expo install` và package-lock.json.
- TanStack Query, Axios, Zustand, Expo SecureStore và Lucide React Native.
- Jest **29.7.0**, jest-expo **57.0.6**, React Native Testing Library **13.3.3** phù hợp
  Router SDK 57. Không dùng cấu hình Jest/Router SDK 58 máy móc cho SDK 57.
- Kiểm tra cuối bằng **Node 24.19.0 LTS**. Node hệ thống hiện là 25.9.0 và không bị đổi;
  phiên kiểm tra dùng runtime LTS có sẵn riêng của công cụ. Nên dùng Node 24 LTS khi chạy
  bằng VS Code. `.nvmrc`/`.node-version` ghi phiên bản này; không tự cài Node hoặc SDK nặng.

SDK 57 được chọn để chạy bằng Expo Go trên điện thoại trong giai đoạn chuyển tiếp SDK 58,
theo [hướng dẫn tạo dự án Expo](https://docs.expo.dev/get-started/create-a-project/).
Tham khảo [Router testing](https://docs.expo.dev/router/reference/testing/) (phân biệt SDK
57/RNTL 13 và SDK 58/RNTL 14), [Expo CLI](https://docs.expo.dev/more/expo-cli/).

## Chạy trên Windows / Android

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\mobile
node --version # Nên là Node 24 LTS
npm ci
Copy-Item .env.example .env # Chỉ khi .env chưa có; không ghi đè cấu hình riêng
npx expo start --lan
```

Mở Expo Go tương thích SDK 57 và quét QR. Windows và điện thoại cần cùng mạng Wi-Fi.
Hiện máy có ADB nhưng `adb devices` không có thiết bị, không tìm thấy emulator trong PATH;
chưa xác nhận chạy trên thiết bị Android thật. Không cài Android Studio/SDK hoặc tạo APK.
Nếu Expo Go báo không tương thích, dùng phiên bản tương ứng tại
[Expo Go](https://expo.dev/go) và kiểm tra SDK trước; không tự nâng toàn bộ dependencies.

Backend cần được người dùng chạy riêng như hiện có tại cổng 4000. Mobile không tự khởi
động, sửa cấu hình hoặc chỉnh dữ liệu Backend.

### Điện thoại Android thật

Chạy `ipconfig` trên Windows, lấy IPv4 LAN của adapter đang dùng, tự điền vào `.env`:

```dotenv
EXPO_PUBLIC_API_BASE_URL=http://YOUR_WINDOWS_LAN_IPV4:4000/api
```

Thay placeholder bằng IPv4 thực trên máy; không đưa IP cá nhân vào mã nguồn. Không dùng
localhost vì địa chỉ đó sẽ trỏ đến chính điện thoại. Backend hiện `listen(port)` không giới
hạn loopback; cần bảo đảm cổng 4000 truy cập được từ mạng riêng. Nếu Windows Firewall chặn,
cho phép Node/Backend và Metro trên mạng Private thích hợp, không mở PostgreSQL 5432 ra LAN.
Expo tunnel chỉ phục vụ Metro, không tự làm Backend LAN có thể truy cập qua Internet.
Có thể mở `http://<LAN_IP>:4000/api/health` trên trình duyệt điện thoại để kiểm tra **chỉ đọc**.
Sau khi đổi `.env`, khởi động lại Expo (`npx expo start --clear`).

### Android Emulator có sẵn

```dotenv
EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4000/api
```

10.0.2.2 là alias máy host của Android Emulator tiêu chuẩn, không phải IP LAN cá nhân.
Mở emulator đã cài rồi `npm run android`; bước này không tự cài emulator.
Nếu đã dùng ADB reverse trên thiết bị USB, có thể tự cấu hình riêng; không mặc định
localhost hoạt động cho mọi thiết bị. Production cần API HTTPS.

### Web preview

```powershell
npm run web -- --port 8082
```

Để kiểm tra Backend từ trình duyệt trên cùng Windows có thể đặt URL localhost:4000/api
trong `.env` riêng. Web chỉ là preview; không thay thế kiểm tra native Android/SecureStore.
Nếu chưa có API URL, ứng dụng vẫn mở Guest và thông báo chưa cấu hình. Không có URL/IP
mặc định âm thầm trong code; chỉ `.env.example` dùng alias emulator làm ví dụ công khai.
Không đặt JWT_SECRET, mật khẩu, DATABASE_URL hoặc Cloudinary secret vào `EXPO_PUBLIC_*`.

## Cấu trúc

```text
mobile/
  src/
    app/
      _layout.tsx
      (tabs)/_layout.tsx, index.tsx, explore.tsx, library.tsx, profile.tsx
      login.tsx, register.tsx, account.tsx, search.tsx, history.tsx, +not-found.tsx
      story/[id].tsx, reader/[id].tsx
    components/ AppHeader, ScreenContainer, StoryCard, States
    features/foundation/screens.tsx # placeholder lịch sử, routes không còn sử dụng
    features/auth/ AuthScreen, ProfileScreen, validation, navigation
    features/library/ api, session, queries, FavoriteButton, LibraryScreen, HistoryScreen
    features/stories/ api, queries, ui, HomeScreen, ExploreScreen, SearchScreen, StoryDetailScreen
    features/reader/ api, positions, sync, use-reading-sync, ReaderScreen, NovelContent, ComicContent, theme
    hooks/use-auth.ts
    lib/ theme.ts, config.ts, errors.ts, providers.tsx
    services/ http.ts, api.ts, auth.ts, runtime.ts, secure-vault.ts
    stores/auth.ts
    types/auth.ts
  tests/ auth, api, vault, components, navigation, fixtures, setup
  assets/book-icon.svg, book-icon.png
  app.json, package.json, package-lock.json, tsconfig.json
  eslint.config.js, jest.config.js, .prettierrc.json
  .env.example, .gitignore, .nvmrc, .node-version
```

Template dùng `src/app` theo Expo Router. Các ví dụ màn hình/template đã được thay bằng
UI độc giả; asset scaffold không tham chiếu không đi vào bundle. Icon sách mới được dựng
bằng SVG do dự án tự tạo, không lấy logo/ảnh truyện của WebNovel.

## Routes và UI

- `/` Home, `/explore`, `/library`, `/profile`: bốn Bottom Tabs hoạt động cho Guest.
- `/login`, `/register`: form thật; đăng ký USER xong về Login, không tự đăng nhập.
- `/history`: lịch sử có phân trang và xóa sau xác nhận, yêu cầu phiên ACTIVE.
- `/search`: tìm tên truyện, debounce 400 ms và tải thêm.
- `/story/[id]`: thông tin truyện và chương PUBLISHED; `/reader/[id]?storyId=...` là Reader NOVEL/COMIC,
  `id` là UUID chương; Guest được đọc, phiên ACTIVE có thể đồng bộ vị trí/history. UUID sai hiển thị ErrorState.
- `/account`: nền tảng protected route; Guest/BANNED về Login, ACTIVE USER/ADMIN đều có
  thể mở không gian độc giả. Không có quản trị hoặc CRUD trong Mobile.
- Token màu/typography/spacing/radius trong `src/lib/theme.ts`; light theme ưu tiên,
  SafeArea cả bốn cạnh, UI linh hoạt cho điện thoại, nội dung tối đa 600px trên màn hình lớn.
- Component dùng lại: AppHeader, StoryCard (NOVEL/COMIC, ảnh 2:3 và fallback trung tính),
  ScreenContainer, LoadingState, EmptyState, ErrorState có nút retry rõ ràng.
- Không hiển thị số liệu/thư viện/truyện giả như kết quả Backend, không giả lập trạng thái
  “đã kết nối”. TanStack Query đã có provider, cache đọc và chính sách không tự retry.

## Hợp đồng HTTP và phiên

Đã đọc routes/controller/validation/types Backend hiện có, không đổi Backend:

| API                     | Hợp đồng                                                                        |
| ----------------------- | ------------------------------------------------------------------------------- |
| POST /api/auth/login    | `{email,password}` → `data:{user,accessToken,refreshToken,tokenType,expiresIn}` |
| POST /api/auth/register | `{username,email,password}` → `data:user`; không tự đăng nhập                   |
| POST /api/auth/refresh  | `{refreshToken}` → token pair mới, rotation                                     |
| POST /api/auth/logout   | `{refreshToken}` → success; thu hồi session                                     |
| GET /api/auth/me        | `Authorization: Bearer <access>` → `data:user`                                  |

Transport auth và shared API client dùng chung HTTP factory/base URL. Transport refresh
không đi qua interceptor refresh để tránh đệ quy. Timeout 12 giây, `withCredentials:false`,
không giả định HttpOnly cookie. Error trả `ApiError` an toàn cho network, timeout và HTTP
400/401/403/404/409/429/5xx; không giữ Axios config, raw server message, stack hoặc request body.
Request khác origin hoặc ngoài `/api/` bị chặn trước khi gửi Authorization.

Zustand chỉ giữ status/user/notice được whitelist; token nằm trong closure, không persist
Zustand, không AsyncStorage/localStorage, không log hoặc đưa vào query key. Access Token ở
memory; Refresh Token nằm trong Expo SecureStore với key riêng `webnovel.reader.refresh.v1`.
Native SecureStore không sẵn sàng sẽ fail closed, không fallback lưu plaintext. Web preview
chỉ dùng memory vault, reload mất phiên, không giả vờ SecureStore có trên web.

Restore chỉ refresh khi tìm thấy token đúng cấu trúc. Login/refresh xác minh lại `/auth/me`,
chỉ chấp nhận ACTIVE USER/ADMIN và không giữ passwordHash. Rotation lưu token mới vào
SecureStore trước khi công bố phiên. Access gần hết hạn hoặc foreground dùng refresh;
các refresh đồng thời dùng chung promise, không replay refresh token nếu kết quả chưa rõ.
Storage queue và session generation ngăn login/refresh cũ ghi đè phiên mới hoặc sống lại
sau logout. Logout xóa memory ngay, xóa vault và best-effort revoke trên Backend; khi lỗi
kho lưu/kết nối sẽ thông báo chưa xác nhận thu hồi thay vì khẳng định đã xóa hoàn toàn.

401 có token: GET/HEAD được refresh và replay tối đa một lần; 401 tiếp theo đóng phiên.
Mutation không tự replay. 403 giữ phiên nhưng báo không đủ quyền. Guest vẫn đọc được API
public mà không cần token. Đổi phiên xóa cache để không đưa dữ liệu người trước cho người sau.
Protected route là UX; quyền ghi cuối cùng vẫn do Backend kiểm soát.

Trong bước này không kết nối tài khoản thật và không gửi các API auth ghi dữ liệu. Toàn bộ
test dùng transport/Axios/SecureStore mock. Bản cài mới không có refresh token nên startup
không phát sinh request auth; Home tải nội dung qua API GET công khai.

## Kiểm tra và giới hạn

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npx expo install --check
npx expo-doctor@latest
npm run export:android
npm run export:web
```

Test bao gồm navigation Router thực, bốn tab, Guest/protected links, USER/ADMIN/BANNED,
loading/empty/error, StoryCard, URL config, auth contract, 401/403/network/timeout, rotation,
expiry, refresh đồng thời, restore, SecureStore native/web mock, logout và race ghi storage.
Không có dữ liệu thật trong test; export Android tạo JavaScript/Hermes bundle, **không tạo APK**.

Kết quả nền tảng Bước 15.1 (lịch sử; kết quả Bước 15.2 tại STORIES.md):

| Kiểm tra                            | Kết quả                                                           |
| ----------------------------------- | ----------------------------------------------------------------- |
| TypeScript strict                   | Đạt                                                               |
| ESLint toàn project                 | Đạt, không lỗi/cảnh báo                                           |
| Prettier                            | Đạt                                                               |
| Jest / React Native Testing Library | **48/48 test**, 5 suite                                           |
| Expo dependency compatibility       | Dependencies are up to date                                       |
| Expo Doctor                         | **21/21 checks passed**                                           |
| Android Hermes bundle               | Export thành công                                                 |
| Web static export                   | Export thành công                                                 |
| Expo/Metro startup                  | `/status` trả packager-status:running; process kiểm tra đã đóng   |
| Chromium web preview 393×852        | Bốn tab, Guest redirect, không tràn ngang; 0 request API/external |
| Backend/Admin Web                   | 217 file nguồn/cấu hình giữ nguyên theo SHA-256 trước/sau         |

Web preview dùng Chromium có sẵn để kiểm tra bản export; không thay thế kiểm thử Android
thật. Hai ảnh chụp nằm tại `test-results/mobile-home.png` và `mobile-profile.png`, đã ignore.
Test cũng chặn response của phiên cũ sau khi đổi tài khoản để không đưa dữ liệu cũ vào phiên mới.

`npm audit` còn **65 cảnh báo phụ thuộc bắc cầu (49 high, 16 moderate)** trong SDK/toolchain
đã chọn, tập trung ở braces, decode-uri-component, node-forge, sprintf-js và uuid cùng các
package phụ thuộc chúng. Đã chạy cập nhật tương thích không force, vẫn còn cảnh báo.
Không dùng `audit fix --force`, không hạ/nâng Expo/RN hoặc override major tùy tiện để làm
đẹp báo cáo. Cần đánh giá/update toolchain tương thích trong bước riêng trước production;
Expo Doctor kiểm tra tương thích, không thay thế kiểm tra lỗ hổng.

Library/Favorites/Continue Reading/History, Auth forms, Ratings/Comments/Replies và sửa Profile đã hoàn thành. Không có CRUD quản trị trên Mobile. Chưa kiểm tra trên điện thoại/emulator vì không có thiết bị kết nối.
Không sửa Backend/Admin Web, schema/migration; không reset DB, không upload Cloudinary và
không tạo dữ liệu trên Database chính. Integration chỉ ghi fixture trong Database test
đã xác minh và dọn sau test. Dừng tại Bước 16.1.
