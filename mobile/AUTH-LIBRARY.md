# Bước 15.4 — Authentication, Library và History

Mobile đã có Login/Register thật, Logout, Favorites, Continue Reading, Reading History và
Profile cơ bản. Tái sử dụng `authSession`, `authTransport`, shared `api`, AuthStore,
SecureStore và Query provider của Bước 15.1; không tạo client/store/token manager khác.

## Màn hình và hành vi

- **Login**: email/mật khẩu, hiện/ẩn mật khẩu, validation, tránh submit trùng, loading,
  lỗi an toàn và trở về đích hợp lệ. Đích mặc định là Library. Chỉ ACTIVE mới được tự
  chuyển khỏi Login; tài khoản BANNED không tạo vòng lặp Account ↔ Login.
- **Register**: username/email/password/confirmPassword. Chỉ gửi ba trường đầu cho
  Backend, không có role/userId. Backend tạo USER; response không có token. Thành công
  chuyển sang Login với thông báo, không tự đăng nhập hoặc đưa email/password vào URL.
- **Profile/Account**: avatar có fallback, displayName/username/email/role, liên kết
  Library/History và Logout có xác nhận. ADMIN cũng ở không gian độc giả, không có CRUD.
  Guest thấy Login/Register; Account yêu cầu phiên ACTIVE.
- **Library**: Yêu thích và Đang đọc, mỗi trang 12 bản ghi, tải thêm, refresh, loading,
  empty/error/retry. Guest chỉ có lời mời đăng nhập, không gọi API riêng tư.
- **Favorite trên Story Detail**: Guest về Login rồi trở lại đúng truyện. Phiên ACTIVE
  kiểm tra trạng thái bằng danh sách Favorites **có phân trang** (100 mục/trang). Dừng
  khi đã tìm được truyện; chỉ kết luận chưa Favorite sau khi quét hết các trang. Trong
  lúc chưa xác định/lỗi sẽ khóa nút, không suy luận từ trang đầu.
- Thêm/bỏ Favorite xếp một mutation, không tự retry; bỏ cần xác nhận. Invalidate cả
  danh sách và trạng thái Favorite trong cùng phiên. HTTP 409 tải lại trạng thái,
  không tự POST lại; Backend unique vẫn là bảo vệ cuối cùng trước cạnh tranh.
- **Continue Reading**: chỉ đọc danh sách tiến độ, không PUT khi mở Library. Khi chọn
  tiếp tục, GET tiến độ mới nhất trước khi điều hướng Reader bằng hai UUID. Nếu saved
  chapter không còn công khai, lấy chương PUBLISHED đầu tiên; không có chương thì báo
  rõ. Nếu truyện đã ẩn/404, báo lỗi và tải lại danh sách. Reader vẫn tự kiểm tra public
  content và khôi phục mốc theo Bước 15.3.
- **History**: truyện/chương/thời điểm theo locale thiết bị, tải thêm/refresh/đọc lại đúng
  chương lịch sử. Chỉ DELETE sau xác nhận, không xóa Favorites/Progress. Nút xóa vẫn có
  khi danh sách hiển thị rỗng, vì Backend có thể đang lọc những bản ghi có nội dung ẩn.

Form dùng KeyboardAvoidingView và ScreenContainer hiện có, nút tối thiểu 48px. Thêm
**Zod 4.6.7** để validation khớp phiên bản Backend; form nhỏ dùng state tại component,
không cần thêm React Hook Form. Không đưa thông tin đăng nhập vào mutation cache.
Tham khảo [Zod API](https://zod.dev/api) cho email/schema strict; quy tắc cụ thể được
đối chiếu trực tiếp với `backend/src/middlewares/auth.validation.ts`.

Username 3–30 ký tự ASCII chữ/số/underscore, trim/lowercase; email theo z.email, tối đa
254, lowercase; mật khẩu 8–128 ký tự, không trim; xác nhận phải khớp. Không ghi log Zod
issues/input và không hiển thị raw message của Backend. Lỗi đăng ký 409 chỉ cho biết
email **hoặc** username trùng, vì Backend không phân biệt trường trong response.

## Hợp đồng API

| API                                     | Request/response dùng                                            |
| --------------------------------------- | ---------------------------------------------------------------- |
| POST `/api/auth/register`               | `{username,email,password}` → HTTP 201, `data:user`, role USER   |
| POST `/api/auth/login`                  | `{email,password}` → token pair; AuthSession xác minh `/auth/me` |
| POST `/api/auth/refresh`                | `{refreshToken}` → rotation, giữ cơ chế single flight hiện có    |
| POST `/api/auth/logout`                 | `{refreshToken}` → success; chỉ thu hồi phiên                    |
| GET `/api/auth/me`                      | Auth Foundation lấy user ACTIVE, whitelist thông tin công khai   |
| GET `/api/me/favorites`                 | page/limit, data gồm id/storyId/createdAt/story mini             |
| POST `/api/me/favorites`                | `{storyId}` → HTTP 201, data Favorite; 409 FAVORITE_EXISTS       |
| DELETE `/api/me/favorites/:storyId`     | `data:{removed:boolean}`                                         |
| GET `/api/me/reading-progress`          | page/limit, data gồm story/chapter/progressPercent/updatedAt     |
| GET `/api/me/reading-progress/:storyId` | data/version/resume, có thể data null nhưng version khác null    |
| GET `/api/me/reading-history`           | page/limit, data gồm story/chapter/readAt                        |
| DELETE `/api/me/reading-history`        | `data:{deletedCount:number}`                                     |

Các danh sách có `{success,message,data,pagination:{page,limit,total,totalPages}}`.
Story mini chỉ có id/title/slug/coverUrl/type/authorName; không giả định genres hoặc số
liệu khác. Parser whitelist, kiểm tra relation IDs, Decimal và pagination; không lưu
passwordHash/raw envelope. Backend tự lọc nội dung PUBLISHED trong danh sách riêng tư.

Reader vẫn dùng GET chương công khai và POST History/PUT Progress đã có. Request riêng tư
được gắn với phiên bằng AbortSignal tùy chọn, giữ tương thích các lời gọi cũ. Reader
đánh dấu cache Progress/History stale sau đồng bộ, không refetch danh sách ẩn ở mỗi scroll.
Library/History refresh khi được focus; nhãn Back đổi thành
“Quay lại” để phù hợp cả luồng mở từ chi tiết, Library hoặc History.

## Phiên, cache và bảo mật

- Access Token chỉ trong memory, Refresh Token trong SecureStore native qua adapter có
  sẵn. Web preview dùng memory vault, reload mất phiên; không localStorage/AsyncStorage.
- Mật khẩu chỉ tồn tại trong form/request đang xử lý; xóa khỏi form khi blur hoặc khi
  request kết thúc, không persist, không URL/query key/log. Không dùng credentials thật
  trong kiểm thử.
- Redirect dùng danh sách đường dẫn nội bộ được cho phép; Story/Reader phải đúng UUID,
  Reader phải có storyId. Không chấp nhận URL ngoài, `/admin`, vòng Login hoặc chuỗi mã
  hóa/fragment/backslash; đích không hợp lệ về Library.
- Query/mutation keys riêng tư theo `['private', userId, sessionGeneration, ...]`.
  userId này chỉ là phạm vi cache, không gửi như tham số tự chọn cho Backend.
- Kiểm tra owner trước **và sau** request; gắn AbortSignal với phiên và hủy khi owner
  đổi, kể cả lúc Axios chưa dispatch. Response tài khoản cũ không được đưa vào UI/cache
  của phiên mới. Component riêng tư được remount khi đổi owner/epoch.
- Trước Login/Logout, hủy và xóa query/mutation riêng tư. Provider hiện có cũng clear
  cache khi Guest/signing-in; giữ nguyên hành vi bảo mật đó, kể cả cache public bị clear.
- Logout chỉ gọi AuthSession hiện có; không DELETE favorites/progress/history. Phiên
  cục bộ được đóng ngay. Nếu mạng/kho lưu lỗi, hiển thị notice giới hạn thu hồi do
  Foundation cung cấp; không khẳng định máy chủ đã thu hồi thành công.
- 401/refresh/403/session expiry dùng interceptor có sẵn. Không replay mutation hoặc
  refresh vô hạn. Hộp xác nhận bị khóa khi đóng/đang xử lý để tránh thao tác lặp.

## File

Tạo:

- `src/features/auth/AuthScreen.tsx`, `ProfileScreen.tsx`, `validation.ts`, `navigation.ts`.
- `src/features/library/api.ts`, `session.ts`, `queries.ts`, `FavoriteButton.tsx`,
  `LibraryScreen.tsx`, `HistoryScreen.tsx`.
- `src/components/ConfirmDialog.tsx`, `src/app/history.tsx`.
- `tests/auth-ui.test.tsx`, `library-api.test.ts`, `library-ui.test.tsx`, `library-fixtures.ts`, `session-scope.test.ts`.
- `AUTH-LIBRARY.md`.

Sửa:

- `src/app/login.tsx`, `register.tsx`, `account.tsx`, `_layout.tsx`,
  `(tabs)/library.tsx`, `(tabs)/profile.tsx`.
- `src/features/stories/StoryDetailScreen.tsx`: nút Favorite.
- `src/features/reader/api.ts`, `use-reading-sync.ts`, `ReaderScreen.tsx`: AbortSignal tùy chọn tương thích ngược, gắn request với phiên, invalidate cache và nhãn Back.
- `tests/navigation.test.tsx`, `tests/reader-ui.test.tsx`: Auth forms, History route, regression BANNED và request Reader có signal.
- `package.json`, `package-lock.json`: Zod pinned, không nâng SDK.
- `README.md`, `STORIES.md`, `READER.md`: cập nhật trạng thái hiện tại.

Không sửa `src/services`, `src/stores`, `src/types`, `src/lib/providers.tsx`, app.json,
Backend hoặc Admin Web. Có đối chiếu SHA-256 các file được bảo vệ trước/sau. Không sửa
schema/migration, không thao tác Database hoặc Cloudinary thật.

## Kết quả kiểm tra

| Kiểm tra              | Kết quả                                        |
| --------------------- | ---------------------------------------------- |
| TypeScript strict     | Đạt                                            |
| ESLint                | Không lỗi/cảnh báo                             |
| Prettier              | Đạt                                            |
| Unit/UI/regression    | **181/181**, 14 suite                          |
| Expo compatibility    | Dependencies are up to date                    |
| Expo Doctor           | **21/21**                                      |
| Android Hermes bundle | Export thành công, không phải APK              |
| Web static export     | Thành công                                     |
| Chromium              | 9 nhóm đạt, 0 page error, 0 request ngoài mock |

Unit/UI dùng mock: login đúng/sai/duplicate, validation/register trùng/không role ADMIN,
password visibility, redirect an toàn, logout và cache riêng tư/offline warning, Favorite
add/remove/status ở trang sau/409/pagination, Continue Reading/fallback, History/xác nhận
xóa, Guest, 403, session expiry, response muộn khi đổi tài khoản và mutation bị hủy trước
Axios dispatch khi đổi owner. Request đã đến máy chủ vẫn có thể hoàn tất cho tài khoản
đã gửi; không replay mutation. Giữ toàn bộ test cũ về Refresh Token Rotation, SecureStore
và Reader.

Chromium dùng bản export ở 393×852, kiểm tra thêm 320/600px: Guest Favorite → Login và
trở lại truyện, login/me, add/remove Favorite, Library/Continue Reading, History
cancel/confirm/clear, Profile/Logout, Guest không gọi /me sau logout, Register không tự
login và responsive. API/auth/token đều là fixture mock, không phải tài khoản thật;
không log token/password, không kết nối Backend/Database thật. Ảnh QA trong
`test-results/step154-*.png` đã ignore.

## Chạy và kiểm tra trên Android

Dùng Node 24 LTS, cấu hình `.env` như README. Emulator dùng
`EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4000/api`; điện thoại thật dùng IPv4 LAN Windows
và cùng Wi-Fi. API URL không phải secret, không đặt DATABASE_URL/JWT_SECRET/Cloudinary
secret vào EXPO_PUBLIC variables. Chưa có `.env` thì tự sao chép `.env.example`, không
ghi đè cấu hình đang có.

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\mobile
npm run typecheck
npm run lint
npm run format:check
npm test
npx expo-doctor@1.21.5
npm run export:android
npm run export:web
npx expo start --clear
```

Sau khi tự mở Backend hiện có, dùng tài khoản được phép của bạn để đăng nhập trên thiết
bị (không gửi mật khẩu/token qua chat). Kiểm tra Favorite → Library, đọc một chương →
Đang đọc/History, hủy/xác nhận các hộp thoại. Đăng ký hoặc xác nhận thao tác trong ứng
dụng thật sẽ thay đổi dữ liệu tài khoản tương ứng; các kiểm tra tự động nêu trên không
thực hiện những thao tác đó trên Database thật.

## Giới hạn

- Không thiếu API bắt buộc và không bổ sung Backend. Việc xác định Favorite âm tính cần
  quét hết danh sách; giá sách lớn sẽ chờ lâu. Có thể đề xuất API trạng thái riêng ở bước
  sau, cần người dùng phê duyệt. Cạnh tranh giữa các lần đọc phân trang vẫn dựa vào unique
  và 409 của Backend, không hứa trạng thái realtime giữa nhiều thiết bị.
- List UI tải thêm từng 12 mục trong ScrollView hiện có; tối ưu danh sách rất dài bằng
  virtualization là công việc tiếp theo.
- Chưa có thiết bị/emulator kết nối để kiểm tra bàn phím, SecureStore và lifecycle native
  thật. Web preview không thay thế thử trên Android. Bản QA dùng URL mock tạm trong môi
  trường export, không ghi vào `.env`; chạy thật phải đặt URL của Backend phù hợp.
- `npm audit` vẫn có 65 cảnh báo bắc cầu (49 high/16 moderate) trong SDK/toolchain cũ;
  không dùng force hoặc nâng Expo tùy tiện. Cần đánh giá riêng trước production.
- Phạm vi lịch sử Bước 15.4 chưa gồm sửa Profile hoặc Ratings/Comments. Các phần này
  đã được bổ sung tại [FEEDBACK-PROFILE.md](FEEDBACK-PROFILE.md) trong Bước 15.5.
  Chưa có đổi mật khẩu, upload avatar hoặc quản trị trên Mobile.
