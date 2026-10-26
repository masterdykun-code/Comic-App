# Kế hoạch bổ sung U05, U06, U08, U10, U09 — WebNovel

Ngày rà soát: 23/10/2026. Trạng thái: **chỉ đề xuất, chờ duyệt trước khi lập trình**.

## 1. Kết luận và phạm vi

Triển khai lần lượt **U05 → U06 → U08 → U10 → U09**, nghiệm thu từng chức năng trước khi chuyển bước. Tái sử dụng kiến trúc routes → controller → service → store, Prisma Client dùng chung, Zod, HttpError và cơ chế phiên hiện tại.

| Chức năng | Hiện đã có | Phần còn thiếu | Database tối thiểu đề xuất |
|---|---|---|---|
| U05 — NOVEL settings | Cỡ chữ 14–30, dòng 1.5/1.8/2.1, nền light/sepia/dark | Chọn font, lưu bền vững, hydrate và giữ vị trí khi đổi font | Không đổi PostgreSQL; lưu trên thiết bị |
| U06 — COMIC settings | Cuộn dọc, tải ảnh theo cửa sổ nhỏ, retry ảnh, tiếp tục từ trang đã lưu | Xem từng trang, zoom/pan, lưu chế độ | Không đổi PostgreSQL |
| U08 — Bookmark | Favorites, ReadingProgress, History và định dạng vị trí có thể tái sử dụng | Bookmark độc lập, API riêng, danh sách, mở vị trí được chọn | Thêm bảng `bookmarks` |
| U10 — Đổi mật khẩu | Đăng nhập, Argon2id, kiểm tra phiên/ACTIVE, thu hồi phiên | API đổi mật khẩu, UI, xác minh lại trong transaction, xử lý race | Không cần thêm bảng/cột |
| U09 — Quên mật khẩu | Email trên User, hash và session có thể tái sử dụng | Reset token, gửi email, UI, rate limit và kiểm soát replay | Thêm bảng `password_reset_tokens` |

Theo phương án tối thiểu: từ **13 lên 15 bảng ứng dụng**, chưa tính `_prisma_migrations`. Không cần bảng settings, không dùng Favorites hoặc ReadingProgress làm Bookmark. Đây là thiết kế dự kiến, chưa có migration hoặc thay đổi Database.

## 2. Bằng chứng từ mã nguồn hiện tại

Các đường dẫn dưới đây tương đối với thư mục gốc dự án.

### Reader và trạng thái Mobile

- `mobile/src/features/reader/ReaderScreen.tsx`: settings đang là `useState` khởi tạo light/20/1.8; có modal tùy chỉnh; chưa có fontFamily hoặc cơ chế lưu settings. Không thể coi việc giữ state trong cùng màn hình là lưu qua lần khởi động ứng dụng.
- `NovelContent.tsx`: ScrollView, chia text thành block, ghi vị trí UTF-16; giữ anchor khi fontSize/lineSpacing hoặc bề ngang thay đổi. `layoutKey` chỉ có fontSize và lineSpacing, cần bổ sung font khi thực hiện U05.
- `theme.ts`: ba bảng màu đã có; theme Reader không đồng nghĩa theme toàn ứng dụng. Root `_layout.tsx` đang dùng StatusBar dark cố định.
- `ComicContent.tsx`: FlatList cuộn dọc; Image.getSize và onLoad/onError; cửa sổ render nhỏ; lấy trang hiện tại qua viewability. Chưa có paging hay pinch/pan.
- `positions.ts`: NOVEL lưu UTF-16 block offset; COMIC hiện lưu pageNumber và **scrollOffset = 0**, chưa khôi phục vị trí bên trong ảnh dài. Không được quảng bá khả năng quay lại đúng pixel hiện tại.
- `ReaderScreen.tsx`: `ReaderBody` chỉ chọn saved position lúc mount; key gồm chapterId/updatedAt. Nhảy tới bookmark trong cùng chương sẽ cần một tín hiệu restore riêng, không chỉ đổi query params/saved prop.
- `use-reading-sync.ts`, `sync.ts`: debounce, flush khi rời chương/background, generation kiểm soát chủ sở hữu; lỗi 409 dừng ghi tự động, không replay mutation. Phải giữ hành vi này.
- `features/library/LibraryScreen.tsx`: hiện có Favorites/Đang đọc và link History, chưa có Bookmark.
- `services/secure-vault.ts`: Native dùng SecureStore cho refresh token, Web chỉ giữ refresh token trong RAM; không dùng kho token làm kho cấu hình Reader.
- `package.json`: Expo ~57.0.30, RN 0.86.3; đã có Zustand, expo-font, gesture-handler, reanimated/worklets. Chưa khai báo AsyncStorage; chưa thấy GestureHandlerRootView/GestureDetector trong source hiện tại. Chưa chọn phiên bản package mới ở bước này.

### Backend, Auth và migrations

- `backend/prisma/schema.prisma`: 13 model hiện tại, User.passwordHash nullable; chưa có Bookmark, settings, reset token hoặc passwordVersion. Chapter có unique `(id, storyId)`, phù hợp FK kết hợp của Bookmark mới.
- Hai migration: `20261017154658_init` và `20261017160606_auth_sessions`; có CHECK cho điểm đánh giá, tiến độ và các offset. Không sửa hai migration này.
- `src/routes/auth.routes.ts`: register/login/refresh/logout/me/updateMe; chưa có forgot/reset/change-password.
- `src/middlewares/auth.validation.ts`: mật khẩu đăng ký/đăng nhập hiện dài 8–128 ký tự; body strict. Dùng cùng chính sách cho mật khẩu mới, không tự trim/normalize mật khẩu.
- `src/utils/password.ts`: Argon2id, memoryCost=19456 KiB, timeCost=2, parallelism=1. Tái sử dụng helper, không tạo thuật toán hash thứ hai.
- `src/config/auth.ts`: access token 15 phút, session 30 ngày; JWT HS256 có issuer/audience, claim sid. Không cần đổi JWT_SECRET để thu hồi phiên.
- `src/services/auth.service.ts`: JWT hợp lệ vẫn phải qua `getActiveSession`; user phải ACTIVE. Do vậy đánh dấu session revoked sẽ chặn cả access token còn hạn trong các request sau đó.
- `src/services/auth.store.ts`: refresh/logout khóa hàng session; replay refresh thu hồi session. Login xác minh hash trước createSession nhưng createSession chưa nhận/hash-check snapshot mật khẩu; đây là điểm cần xử lý khi thêm đổi/reset mật khẩu.
- `src/middlewares/auth.rate-limit.ts`: limiter hiện tại theo IP, bộ nhớ trong process. Không đủ để chống spam email theo tài khoản hoặc chia sẻ giới hạn giữa nhiều instance.
- Không tìm thấy adapter gửi email/reset mail trong source/dependencies hiện tại.
- `mobile/src/services/api.ts`: chỉ GET/HEAD được retry sau refresh; mutation 401 không tự replay. Giữ nguyên nguyên tắc này cho Bookmark và password APIs.
- `mobile/src/stores/auth.ts`, `lib/providers.tsx`: refresh single flight, generation chống response cũ hồi sinh phiên, cache được xóa khi guest/signing-in. Tận dụng cho logout sau đổi/reset mật khẩu.

## 3. U05 — Cài đặt đọc NOVEL

### Giao diện và hành vi

Mở rộng modal “Tùy chỉnh đọc” hiện có, không tạo Reader mới:

- Giữ mức cỡ chữ 14–30, bước 2, và ba mức khoảng cách dòng hiện tại.
- Font: mặc định hệ thống, serif, monospace; map font theo Android/iOS/Web và kiểm tra đủ dấu tiếng Việt. Chưa tải font từ Internet. Nếu cần font đóng gói riêng, duyệt asset/giấy phép trước.
- Màu nền: dùng light/sepia/dark đã có, với chữ tương phản tương ứng; không thêm color picker tùy ý trong bản đầu. Nút sáng/tối chính là lựa chọn theme, không tạo hai state mâu thuẫn.
- Có “Khôi phục mặc định”; theme áp dụng đồng bộ nền, panel, chữ và StatusBar khi Reader được focus; ra khỏi Reader trả StatusBar về hành vi cũ.

### Lưu và khôi phục

- Đề xuất một Zustand settings store dùng adapter AsyncStorage cho dữ liệu không bí mật. Khi lập trình dùng `npx expo install` để chọn bản tương thích SDK hiện tại, không nâng Expo SDK.
- Khóa có version, ví dụ `webnovel.reader.preferences.v1`; lưu chung cấu trúc `{schemaVersion, novel:{fontSize,fontFamily,lineSpacing,theme}, comic:{mode}}`.
- Settings theo thiết bị, dùng cho cả Guest, không đồng bộ đa thiết bị và không chứa user/token. Đăng xuất không xóa sở thích đọc. Nếu muốn settings theo tài khoản, cần duyệt phạm vi riêng.
- Hydrate xong mới mount nội dung Reader; validate/clamp giá trị, dữ liệu hỏng dùng mặc định, lỗi ghi không chặn đọc. Serialize/debounce các lần lưu để tránh lần ghi cũ thắng lần mới.
- Thêm fontFamily vào layoutKey; khi đổi font/cỡ chữ/dòng giữ anchor UTF-16, bỏ sự kiện cuộn do relayout để không tự ghi tiến độ sai.

API Backend: **không cần**.

File dự kiến: ReaderScreen/NovelContent/theme; mới `mobile/src/stores/reader-settings.ts`, adapter trong `src/services/reader-settings.ts`; chỉnh StatusBar focus integration và package/lock nếu thêm storage.

## 4. U06 — Cài đặt đọc COMIC

- Giữ cuộn dọc là mặc định; thêm chế độ từng trang với số trang, Trước/Sau và swipe khi ảnh đang ở scale 1. Dùng pageNumber thực tế, không giả định số trang liên tục.
- Thêm viewer zoom/pan dùng gesture-handler + Reanimated đã có. Giới hạn zoom dự kiến 1×–3×, double tap và nút +/- có nhãn trợ năng; giới hạn pan trong ảnh, reset transform khi đổi trang/chương.
- Ưu tiên zoom trong viewer riêng để không phá chiều cao FlatList cuộn dọc. Khi zoom >1, pan thuộc ảnh; không swipe nhảy trang hoặc chuyển chương do cùng gesture.
- Lưu `mode = vertical | paged`; không lưu độ zoom tạm thời hoặc coi zoom là tiến độ đọc.
- Đổi mode giữ cùng trang đang đọc; không reset về trang đầu, không mark 100% do layout hoặc ảnh chưa tải. Không tải trước toàn bộ ảnh độ phân giải lớn.
- Theo dõi trang đang nhìn để phục vụ Bookmark. Với ảnh dài, bổ sung phép đo offset tương đối 0..1 trong ảnh cho Bookmark; nếu chưa đo chính xác chỉ đánh dấu đầu trang, UI phải nói rõ. Không thay ý nghĩa `ReadingProgress.scrollOffset` trong bước này.
- Android Back đóng viewer trước rồi mới rời Reader; khi rời Reader vẫn flush queue như hiện tại. Gesture/memory/ảnh dài phải kiểm tra Android thật, không coi Jest/Web là bằng chứng Native.

API/Prisma: **không cần**. File dự kiến: ComicContent/ReaderScreen; mới `ComicPageViewer.tsx` và shared settings store U05; tích hợp GestureHandlerRootView ở cấp root sau khi kiểm tra tương thích.

## 5. U08 — Bookmark độc lập

### Giao diện

- Nút Bookmark trong Reader, chọn “Đánh dấu đầu chương” hoặc “Đánh dấu vị trí hiện tại”, tên ghi chú tùy chọn tối đa 100 ký tự.
- Giá sách có mục Bookmark, lọc theo truyện, phân trang, mở vị trí và xóa có xác nhận. Guest được mời đăng nhập; không tự tạo bookmark local giả đồng bộ.
- NOVEL bản đầu quay về đúng block/đoạn được đánh dấu, không hứa chính xác ký tự trong một block chưa được đo. COMIC quay về đúng trang, thêm tỷ lệ trong ảnh khi phép đo có sẵn; ảnh hoặc chương thay đổi phải báo vị trí đã điều chỉnh/không còn khả dụng.

### Model dự kiến: Bookmark → `bookmarks`

| Trường | Kiểu / ý nghĩa |
|---|---|
| id | UUID PK |
| userId, storyId, chapterId | UUID, snake_case trong PostgreSQL |
| label | String nullable, giới hạn ở validation |
| textOffset | Int nullable, UTF-16 giống Reader hiện tại |
| pageNumber | Int nullable, định danh trang COMIC |
| pageOffsetRatio | Decimal(6,5) nullable, 0..1 trong ảnh, không phải pixel màn hình |
| positionKey | String canonical do server tạo, không nhận tự do từ client |
| chapterUpdatedAt | Timestamptz(3), snapshot phiên bản chương để cảnh báo nội dung đã đổi |
| createdAt | Timestamptz(3), now |

- Quan hệ tới User, Story; FK kết hợp `(chapterId, storyId)` → Chapter `(id, storyId)`. Giữ onDelete Restrict/onUpdate NoAction theo dự án; xóa Bookmark không xóa truyện/chương.
- Unique `(userId, chapterId, positionKey)`; index `(userId, createdAt DESC, id)` và `(chapterId, storyId)`, `(storyId)`. Chương đầu và vị trí offset 0 chuẩn hóa cùng key.
- Key chuẩn hóa từ NOVEL offset hoặc COMIC page+ratio đã lượng tử hóa; nullable không dùng trực tiếp làm unique vì PostgreSQL cho nhiều NULL. Server phải kiểm tra lại trong transaction, dùng unique để chống race.
- CHECK mới: textOffset >=0; pageNumber >0; ratio 0..1; đúng một loại vị trí: text hoặc page. Rule theo Story.type, giới hạn text theo content, page tồn tại, PUBLISHED/ACTIVE do service kiểm tra có khóa tương thích quy trình sửa chương.
- Chương bị ẩn: list có thể trả metadata tối thiểu cùng `available:false`, không trả nội dung draft. Resolve trả lỗi an toàn; không tự xóa bookmark hoặc tự trỏ sang chương khác.

### API dự kiến

| API | Request / kết quả |
|---|---|
| POST `/api/me/bookmarks` | `{storyId,chapterId,textOffset?,pageNumber?,pageOffsetRatio?,label?}` → 201; cùng vị trí trả bản cũ 200 |
| GET `/api/me/bookmarks?page=1&limit=20&storyId=...` | Chỉ bookmark của chủ sở hữu, limit tối đa 100 |
| GET `/api/me/bookmarks/:id` | Resolve vị trí, kiểm tra quyền/publication/phiên bản; `positionAdjusted` nếu cần |
| DELETE `/api/me/bookmarks/:id` | Xóa đúng bookmark của mình; 204 khi thành công |

401 Guest/BANNED/phiên hết hạn; 404 không tồn tại hoặc không thuộc mình; 400 body/UUID/vị trí sai. Không nhận userId từ client, không trả passwordHash/token.

### Bảo vệ Continue Reading

- Create/list/delete/resolve Bookmark **không gọi saveProgress và không ghi History**.
- Khi người dùng mở Bookmark: flush queue cũ trước navigation, dùng token điều hướng không bí mật để truyền override qua state/store; không nhét payload vị trí tùy ý chưa kiểm tra vào URL.
- Cùng chương phải có restoreRequestId riêng hoặc remount có kiểm soát, vì ReaderBody hiện giữ saved một lần lúc mount. Tách nguồn restore khỏi snapshot/version của ReadingSync; không giả tạo expectedUpdatedAt.
- Sau khi nhảy, không tự save do programmatic scroll; người dùng bắt đầu đọc thì cơ chế tiến độ hiện có tiếp tục từ vị trí mới. History của lượt mở Reader vẫn theo quy tắc debounce hiện có.

File dự kiến: Backend mới bookmark routes/controller/service/store/validation/types, mount trong app; Prisma thêm model/relations và migration mới **sau duyệt**. Mobile mới `features/bookmarks/{api,queries,BookmarkScreen}.tsx/ts`, route `/bookmarks`, nút Reader/Library, tích hợp restore vào NovelContent/ComicContent và cache theo userId+generation.

## 6. U10 — Đổi mật khẩu

### Hợp đồng và giao diện

- `POST /api/auth/change-password`, authenticate USER/ADMIN ACTIVE, body strict `{currentPassword,newPassword}`; trả 200 `{success:true,message:"Mật khẩu đã đổi. Vui lòng đăng nhập lại."}`. Không trả token mới.
- UI Hồ sơ → Đổi mật khẩu: mật khẩu hiện tại, mới, xác nhận mới; xác nhận mới kiểm tra ở client, Backend vẫn độc lập validate. Không log/persist form; clear khi rời màn hình.
- Giữ chính sách 8–128 ký tự cho bước tương thích đầu; không trim mật khẩu; từ chối mật khẩu mới trùng hiện tại. User.passwordHash null không được dùng route này để tự đặt mật khẩu; cần cơ chế recovery được kiểm chứng.
- Sai mật khẩu hiện tại trả 400 `CURRENT_PASSWORD_INVALID` để không bị interceptor hiểu thành access token 401 và đăng xuất không cần thiết. 401 chỉ cho lỗi xác thực phiên; 429 cho giới hạn thử.
- Rate limit đề xuất 5 lần/15 phút theo userId và 10 lần/15 phút theo IP, tính cả lần thất bại; không khóa tài khoản vĩnh viễn.

### Transaction và phiên

1. Đọc snapshot hash, kiểm tra Argon2 và tính hash mới ngoài transaction để không giữ khóa trong lúc hash tốn CPU.
2. Trong transaction: khóa User, kiểm tra ACTIVE, hash vẫn bằng snapshot và session yêu cầu còn hoạt động; sai snapshot trả 409 `PASSWORD_CHANGE_CONFLICT`, không tự replay.
3. Cập nhật hash bằng helper hiện có; thu hồi **tất cả phiên, kể cả phiên hiện tại** trong cùng transaction. Khi U09 có bảng token, vô hiệu hóa mọi reset token chưa dùng trong cùng thao tác.
4. Commit rồi Mobile xóa token/SecureStore và private cache qua session API hiện có; không tự login. Nếu response bị mất, không tự gửi lại; cho người dùng đăng nhập bằng mật khẩu mới hoặc dùng recovery khi có.

### Race condition cần xử lý cùng U10, không bỏ qua

- Login hiện xác minh mật khẩu trước createSession. Nếu mật khẩu thay đổi giữa hai bước, login bằng hash cũ có thể tạo phiên sau lần thu hồi. Bổ sung expectedPasswordHash/snapshot và kiểm tra lại dưới khóa User khi createSession.
- Đưa các đường ghi Auth liên quan về thứ tự khóa nhất quán **User → Session → Token**; hiện refresh/logout/profile khóa Session trước. Phải rà soát rotateRefresh/createSession/revokeRefresh/updateProfile để không tạo vòng deadlock với đổi/reset mật khẩu.
- Refresh phải re-read trạng thái sau khóa, không phát hành token trên phiên đã thu hồi. Với request đã được xác thực trước commit, việc thu hồi không thể hủy tác vụ đang chạy; các write service phải recheck ACTIVE/session phù hợp.
- Test nhiều kết nối thật cho login/change/refresh và hai lần đổi đồng thời. Không chỉ dùng mock để tuyên bố không có race.

File dự kiến: mở rộng auth routes/controller/validation/service/store/types + memory store tests; password helper được tái sử dụng. Mobile thêm ChangePasswordScreen, route `/change-password`, ProfileScreen, auth transport/types/error map/session boundary khi cần. Không cần schema migration cho riêng U10.

## 7. U09 — Quên mật khẩu qua email

Đây là bước cuối vì tái sử dụng transaction đổi hash/thu hồi phiên từ U10 và cần quyết định dịch vụ email.

### API và UI dự kiến

- `POST /api/auth/forgot-password` public, `{email}`. Email hợp lệ luôn trả 202 cùng envelope/message: “Nếu tài khoản đủ điều kiện tồn tại, hướng dẫn sẽ được gửi qua email.” Không trả userId, token hoặc thông tin tài khoản. Body sai định dạng vẫn 400, rate IP vẫn 429.
- `POST /api/auth/reset-password` public, `{token,newPassword}`; token sai/hết hạn/đã dùng đều 400 `RESET_TOKEN_INVALID` cùng thông báo; thành công 200 và yêu cầu login lại, không phát JWT tự động.
- Login có “Quên mật khẩu?”, thêm ForgotPasswordScreen/ResetPasswordScreen. Demo Expo Go có thể nhập/dán mã token dài từ email; production nên link HTTPS/app link đã xác minh và màn hình fallback. Không coi deep link custom scheme là kênh bí mật hoặc đưa token vào analytics/route logging.
- Không dùng GET để tiêu thụ token: mail scanner có thể tự mở link. Trang reset HTTPS phải không có tracker/third-party asset, dùng no-referrer; chỉ POST xác nhận mới thay đổi mật khẩu. URL gửi email lấy từ cấu hình allowlist, không tin Host header.

### Model dự kiến: PasswordResetToken → `password_reset_tokens`

- id UUID; userId UUID; tokenHash CHAR(64) unique; createdAt Timestamptz(3) NOT NULL mặc định now; expiresAt Timestamptz(3) NOT NULL; consumedAt Timestamptz(3) nullable. FK User Restrict/NoAction; index `(userId, consumedAt)` và `(expiresAt)`.
- Token tạo từ crypto.randomBytes(32), base64url, SHA-256 trước khi lưu; không dùng JWT access/refresh làm reset token. Thời hạn đề xuất 15 phút, một lần dùng. Không lưu plaintext token trong DB, log, file Git, test snapshot hoặc queue log.
- Khi phát token mới cho cùng user, vô hiệu hóa token chưa dùng trước đó dưới khóa User. Khi reset thành công, khóa User rồi token, kiểm tra lại hạn và ACTIVE, consume token/update hash/revoke sessions/invalidate token khác trong **một transaction**. Hai request cùng token chỉ một lần thành công.
- User BANNED không reset để vượt trạng thái; trả phản hồi yêu cầu chung. User chưa có passwordHash không tự mở tính năng OAuth recovery khi chưa có quy tắc định danh rõ ràng.
- Token hết hạn phải bị từ chối theo expiresAt dù chưa cleanup. Cleanup token chỉ là job được phê duyệt riêng, không được xóa tài khoản hoặc refresh token lịch sử đang cần cho replay detection.

### Gửi email và chống abuse

- Hiện chưa có mail provider. Đề xuất interface Mailer inject vào service; test dùng fake mailbox trong RAM, không console token. Chọn SMTP/Nodemailer hoặc provider SDK **sau duyệt**, credentials chỉ Backend env.
- Giới hạn gợi ý: forgot 5 request/15 phút/IP; cooldown 60 giây và tối đa 3 mail/giờ trên email chuẩn hóa. Theo-email suppression vẫn trả 202 để không lộ tài khoản. Reset 10 lần/15 phút/IP; không áp dụng rate limit chỉ theo token để tránh đổi token vượt giới hạn.
- Key giới hạn email dùng HMAC với secret server, không lưu email plaintext trong cache/log. Một process demo có thể limiter RAM; production nhiều instance cần shared store và cấu hình trusted proxy cụ thể, không trust proxy tùy ý.
- Tách gửi mail khỏi thời điểm response bằng dispatcher có giới hạn, không đợi SMTP riêng cho email tồn tại; đo chênh lệch timing, không hứa “constant time” chỉ bằng sleep. Error/mail failure chỉ ghi mã lỗi đã lọc, không ghi payload/SMTP config.
- Dispatcher RAM chỉ phù hợp demo, mất job khi restart và chưa đảm bảo delivery. Production cần queue bảo vệ dữ liệu hoặc outbox mã hóa token với key riêng; đó là phạm vi bổ sung cần duyệt, không âm thầm thêm bảng thứ ba/lưu plaintext. Không gửi email thực trong test tự động.
- Nếu thiếu cấu hình email, báo tính năng chưa sẵn sàng chung cho mọi tài khoản; không giả thông báo “đã gửi thành công”, không thay bằng endpoint trả token.
- Chưa chọn retry SMTP/provider: timeout có thể đã gửi mail. Thiết kế bounded retry/idempotency theo provider, không tự tạo token mới cho mỗi retry gửi thư.

File dự kiến: Backend password-reset controller/service/store/validation, mailer interface + adapter/config sau duyệt, auth route mount, mở rộng Prisma User relations và migration mới. Mobile routes `/forgot-password`, `/reset-password`, auth transport/validation, link ở AuthScreen; giữ nguyên chức năng đăng ký.

## 8. Kiểm thử và tiêu chí nghiệm thu

| Bước | Test phải bổ sung |
|---|---|
| U05 | Clamp/validate settings; hydrate/lưu/restart; storage hỏng/lỗi/race; Guest/login/logout; font tiếng Việt; đổi font/cỡ/dòng giữ anchor, không phát progress save do relayout; theme và StatusBar reset đúng |
| U06 | Hai mode cùng trang, trang không liên tiếp; ảnh 1 trang/nhiều trang/dài/lỗi; pan/zoom boundaries, reset transform; không swipe khi zoom; không mark 100% giả; Android Back/background/rotation; Native gesture smoke |
| U08 | Guest401, owner-only404, PUBLISHED gate; chapter-story composite FK; CHECK/unique và concurrent create; CRUD không ghi progress/history; resume cùng chương, UTF-16/emoji, COMIC ratio; nội dung bị đổi/ẩn; 409 progress vẫn dừng, response của user cũ không lộ |
| U10 | Mật khẩu đúng/sai/new policy; hash Argon2id; không đổi role/status; BANNED/session hết hạn; revoke cả access/refresh phiên hiện tại và thiết bị khác; rollback; login/refresh/change đồng thời; không replay POST hoặc log secret |
| U09 | Request tồn tại/không tồn tại cùng status/body; đo timing; mail mock; token chỉ hash trong DB; expired/replay/concurrent consume; resend/cooldown/rate429; SMTP fail/timeout; reset rollback; mọi phiên cũ vô hiệu; reset/change race; scanner GET không reset; token không xuất hiện trong logs/URL history ngoài kênh thiết kế |

- Tái sử dụng `mobile/tests/reader-ui.test.tsx`, `reader-api.test.ts`, `reader-sync.test.ts`, `auth.test.ts`, `auth-ui.test.tsx`, `library-*`; thêm settings/bookmark/password test riêng.
- Backend thêm mock unit/HTTP test vào runner hiện có; mở rộng AuthStore memory helper. Test PostgreSQL FK/CHECK/transaction và concurrency bằng nhiều connection thật, fixture có marker.
- Chỉ test ghi trên `webnovel_test_db` sau xác minh `current_database()`/schema và ownership. Không fallback từ `.env.integration` sang `.env` chính; không chạy test runner đòi Database trống trên demo đang có dữ liệu hoặc xóa dữ liệu để test đạt.
- `tests/integration/environment.ts` có APP_TABLES cố định 13 và `database.ts` có kiểm tra schema: cập nhật cùng migrations mới, cả safety guards/fixture ownership/cleanup order nếu runner liệt kê bảng cứng. Cleanup bookmarks/reset tokens của fixture trước User/Chapter vì Restrict; tuyệt đối không TRUNCATE toàn bộ.
- Kiểm tra sau từng bước: Mobile typecheck/lint/format/unit/UI; Backend typecheck/build/mock regression khi có sửa Backend. Bước có migration: validate/generate, review SQL và thử trên DB test an toàn trước khi xin duyệt áp dụng DB chính.
- Không chạy `npm test` Backend mù quáng trên DB chính: một số smoke test cũ kỳ vọng bảng nội dung trống. Báo riêng điều kiện môi trường, không reset để đạt test.
- Android thật phải kiểm tra font/zoom/Back/SecureStore/background. Chưa được coi Web E2E hoặc bundle là Native smoke. Không build APK trong phạm vi hiện tại.

## 9. Thứ tự triển khai và điểm duyệt

1. **U05**: duyệt settings theo thiết bị và bộ font/nền preset; triển khai storage/hydration + relayout tests; nghiệm thu mở lại Reader.
2. **U06**: dựng page viewer/zoom từ thư viện đã có; nghiệm thu Native gesture và tiến độ trước khi mở Bookmark.
3. **U08**: duyệt model/API, tạo migration additive riêng khi được phép, review SQL, áp dụng test DB an toàn trước; nghiệm thu CRUD/restore/Continue Reading, rồi mới xin duyệt migration chính.
4. **U10**: thống nhất revoke tất cả session; triển khai locking/snapshot recheck và regression concurrent Auth; không cần DB migration.
5. **U09**: duyệt mail provider, domain/đường dẫn reset, policy cho User.passwordHash null và mức delivery demo/production; tạo migration token riêng, kiểm thử mail mock/atomic reset rồi mới duyệt cấu hình gửi thật.

Không áp dụng migration lên DB nào chỉ dựa trên bản kế hoạch này. Không sửa migrations cũ, tự publish nội dung, thay JWT_SECRET, xóa SecureStore của phiên người dùng đang chạy, gửi email thật hoặc ghi dữ liệu mẫu trong bước rà soát.

## 10. Những quyết định đề xuất để duyệt

- Settings theo thiết bị, không đồng bộ tài khoản; nền preset light/sepia/dark, font hệ thống/serif/monospace.
- COMIC vertical mặc định, paged + viewer zoom 1×–3×; chỉ lưu mode, không lưu zoom.
- Bookmark dùng tài khoản và đồng bộ Backend; độ chính xác NOVEL theo đoạn, COMIC theo trang/ratio đo được. Không ngầm thay đổi progress khi quản lý Bookmark.
- Đổi/reset mật khẩu đều đăng xuất mọi thiết bị; không auto login; không cần passwordVersion nếu transaction/lock/snapshot được triển khai đúng và test cạnh tranh đạt.
- Hai bảng mới, hai migration additive riêng; không sửa schema truyện hiện có. Dịch vụ email và production queue chưa được chọn; đây là dependency cần quyết định trước U09.

## 11. Nguồn đối chiếu và giới hạn rà soát

- [Expo — Store data](https://docs.expo.dev/develop/user-interface/store-data/): AsyncStorage cho preferences không bí mật; SecureStore cho giá trị nhỏ nhạy cảm. Chưa khẳng định version AsyncStorage phù hợp SDK57 trước khi kiểm tra khi triển khai.
- [Gesture Handler — Pinch gesture](https://docs.swmansion.com/react-native-gesture-handler/docs/gestures/pinch-gesture/): tham chiếu thiết kế zoom; phải đối chiếu API với phiên bản 2.32 đang cài và kiểm tra thiết bị.
- [OWASP — Forgot Password](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html): cơ sở cho phản hồi chung, token ngẫu nhiên một lần có hạn, rate limiting và reset không tự đăng nhập. Các timeout, quota và lựa chọn khóa cụ thể trong báo cáo là đề xuất riêng cho WebNovel, không phải thông số bắt buộc từ tài liệu này.

Đã đọc source Backend/Mobile, package manifests, Prisma schema và hai SQL migration. Không đọc giá trị `.env`, mật khẩu, hash/token của người dùng; không kết nối/ghi Database, chạy test, migration, cài package hoặc build trong bước này. Không xác nhận các chức năng mới đã hoạt động: chúng mới là kế hoạch. File duy nhất được tạo là báo cáo này.
