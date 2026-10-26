# Bước 15.5 — Ratings, Comments/Replies và Profile

Màn hình **Góc bạn đọc** mở từ “Đánh giá và bình luận” trên Story Detail; route
`/feedback/:storyId`. Profile mở từ tab hiện có, hoặc `/account`. Không thêm tab quản trị.
Guest đọc được dữ liệu công khai; nút đăng nhập giữ đường quay lại đúng truyện/màn hình.

## File tạo và sửa

Tạo:

- `src/app/feedback/[id].tsx`: route công khai.
- `src/features/feedback/FeedbackScreen.tsx`: bố cục và kiểm tra UUID.
- `src/features/feedback/api.ts`: adapter dùng Axios chung; Zod kiểm tra/whitelist response,
  payload, VISIBLE nếu server trả status và quan hệ root/reply/story.
- `src/features/feedback/Ratings.tsx`: thống kê, phân bố sao, phân trang, tìm đánh giá
  của phiên hiện tại, form và xác nhận xóa.
- `src/features/feedback/Comments.tsx`: roots, inline replies, tải thêm phản hồi,
  tạo/sửa/xóa bình luận của chủ sở hữu và phản hồi một cấp.
- `src/features/feedback/shared.tsx`: trường nhập, avatar tác giả, chọn sao 44×48,
  khóa submit, bảo vệ phiên và invalidation.
- `src/features/auth/ProfileEditor.tsx`: tải hồ sơ, sửa displayName/avatarUrl, cập nhật
  AuthStore và cache chỉ khi danh tính/phiên còn khớp.
- `tests/feedback-fixtures.ts`, `tests/feedback-api.test.ts`, `tests/feedback-ui.test.tsx`:
  fixture tổng hợp và 60 test mới.
- `scripts/smoke-feedback.cjs`: Chromium smoke với tất cả API được mock, chặn các đích
  mạng khác; ảnh QA lưu trong `test-results` đã ignore.
- Tài liệu này.

Sửa:

- `src/features/stories/StoryDetailScreen.tsx`: link sang Góc bạn đọc.
- `src/app/_layout.tsx`: đăng ký route mới.
- `src/features/auth/navigation.ts`: whitelist đường quay lại feedback theo UUID.
- `src/features/auth/ProfileScreen.tsx`: trạng thái tài khoản, mở form sửa, hỗ trợ
  bàn phím và reset avatar fallback khi URL đổi.
- `tests/navigation.test.tsx`: đăng ký route mới trong regression Router.
- `package.json`: thêm `test:smoke:feedback`; không thêm thư viện hoặc đổi phiên bản.
- `README.md`, `AUTH-LIBRARY.md`: cập nhật chỉ dẫn; kết quả các bước cũ giữ là lịch sử.

## Hợp đồng API đã đọc và sử dụng

| API                                  | Hành vi Mobile                                                                          |
| ------------------------------------ | --------------------------------------------------------------------------------------- |
| `GET /stories/:storyId/ratings`      | page/limit/sort=newest; summary.averageScore (nullable), totalRatings, distribution 1–5 |
| `PUT /stories/:storyId/my-rating`    | score nguyên 1–5; reviewText nullable/tùy chọn, tối đa 2.000 ký tự                      |
| `DELETE /stories/:storyId/my-rating` | xác nhận trước; response data.removed                                                   |
| `GET /stories/:storyId/comments`     | roots VISIBLE; replies ban đầu tối đa 20 và repliesPagination                           |
| `GET /comments/:id/replies`          | page/limit/sort=oldest, chỉ root; không thêm cấp thứ hai                                |
| `POST /stories/:storyId/comments`    | content 1–3.000 ký tự; parentId chỉ khi trả lời root                                    |
| `PATCH /comments/:id`                | chỉ content; chỉ hiển thị cho chủ sở hữu                                                |
| `DELETE /comments/:id`               | xác nhận; 409 khi còn replies, kể cả replies ẩn                                         |
| `GET /auth/me`                       | form sửa tải lại hồ sơ hiện tại bằng request thuộc phiên                                |
| `PATCH /auth/me`                     | displayName trim 1–100; avatarUrl HTTP/HTTPS tối đa 2.048 hoặc null                     |

Mọi đường dẫn trên được gắn sau base URL `/api`. API không có `isOwner`, endpoint
my-rating GET hoặc endpoint liệt kê riêng mọi bình luận của mình. Response công khai
Ratings/Comments **không có userId**; mỗi tác giả có username/displayName/avatarUrl.
Comments công khai cũng không có status; sự hiện diện được lọc VISIBLE ở Backend.
Nếu mock/server gửi rõ status=HIDDEN, parser từ chối response thay vì hiển thị.
Không chèn mutation response vào danh sách; luôn đọc lại API công khai sau thay đổi.

### Quyền sở hữu và đánh giá hiện tại

User.username là unique trong Prisma; register chuẩn hóa lowercase và API Profile không
cho đổi username. UI so sánh chính xác username của tác giả với phiên ACTIVE. Chỉ chủ
sở hữu có nút sửa/xóa, kể cả khi phiên là ADMIN; không có quyền moderation trên Mobile.
Backend vẫn xác thực userId từ JWT và kiểm tra quyền trong transaction.

Rating editor dùng query **private** theo userId + session generation + storyId; tìm
username qua các trang công khai limit=100 đến khi thấy đánh giá hoặc hết danh sách.
Chưa xác định, lookup lỗi hoặc đang xác minh lại thì không cho gửi. Tìm thấy thì điền
đúng score/reviewText; vắng mặt chắc chắn trong lần đọc mới hiển thị form tạo. Không suy
ra chưa đánh giá chỉ từ trang đầu. Không tự POST/PUT lại khi lỗi mạng hoặc hết phiên.

Giới hạn: phân trang offset không phải snapshot xuyên nhiều request. Thay đổi đồng thời
từ thiết bị khác vẫn có thể thay đổi trạng thái sau lần đọc; Backend hiện PUT upsert,
không có expectedUpdatedAt cho feedback. Không khẳng định có optimistic concurrency hoặc
chống ghi đè giữa nhiều thiết bị. API GET my-rating tối thiểu có thể giảm số lượt đọc và
cải thiện xác định trạng thái ở bước sau, chỉ bổ sung Backend khi được phép. Bình luận
HIDDEN của chính mình không thể được liệt kê/quản lý qua API công khai hiện có.

## Validation, lỗi và cache

- Feedback text trim, không rỗng hoặc chỉ whitespace/Cf, không HTML (`<`/`>`), không
  controls; giữ nguyên xuống dòng ở giữa, đúng validation Backend hiện tại. Review
  trống trong form gửi null, không gửi chuỗi rỗng không hợp lệ.
- Payload rating/comment không gửi userId, role hoặc status. Profile strict chỉ có
  displayName/avatarUrl; không sửa username/email/id/role/status/passwordHash.
- Guest không đọc `/auth/me`, không quét đánh giá theo danh tính và không gửi mutation.
- Tái sử dụng AuthSession, store, refresh/vault, client Axios, PrivateScope và AbortSignal
  đã có. Không thêm Authentication hoặc lưu token mới. Mọi action ghi có khóa đồng bộ
  chặn double press và không tự retry.
- Đổi tài khoản reset form/key, hủy request thuộc phiên cũ; response cũ không cập nhật
  cache hoặc AuthStore của phiên mới. Cache công khai chỉ giữ các trường public.
- Sau mutation, invalidate `public/feedback/storyId` (ratings, comments, replies) và
  query rating private của đúng phiên. Giữ page query/ScrollView, không điều hướng hoặc
  cuộn về đầu; khi đánh giá đổi phiên bản chỉ reset form liên quan. Không optimistic
  thêm nội dung có thể bị moderation ẩn.
- Profile lưu thành công cập nhật store, query profile private và invalidate feedback
  public để tên/avatar được đọc lại. Không sửa token/role bằng input client.
- HTTP 400/401/403/404/409/429/network được xử lý bằng lỗi an toàn của client chung,
  không log raw Axios config/payload. Client chung loại error code gốc, nên 409 khi xóa
  comment giải thích **có thể có replies (kể cả ẩn), hoặc xung đột**, không giả vờ đã
  xác định COMMENT_HAS_REPLIES. Lỗi hết phiên đưa UI về quyền Guest; đăng nhập qua link.
- Avatar chỉ nhập URL, không upload. Không thêm đổi mật khẩu, moderation hoặc Admin UI.

## Kết quả kiểm tra

| Kiểm tra                                 | Kết quả                                             |
| ---------------------------------------- | --------------------------------------------------- |
| TypeScript strict                        | Đạt                                                 |
| ESLint src/tests/config                  | Đạt, không lỗi/cảnh báo                             |
| Format source/tests/docs và script smoke | Đạt                                                 |
| Jest/RNTL toàn bộ                        | **241/241**, 16 suite; 60 mới + 181 regression      |
| Expo Doctor 1.21.5                       | **21/21**                                           |
| Android Hermes export                    | Thành công, không phải APK                          |
| Web static export                        | Thành công, 18 routes                               |
| Chromium smoke                           | **9 nhóm đạt**, 0 page errors, 0 request ngoài mock |

Test mới bao gồm thống kê/phân bố, phân trang rating/comments/replies, own-rating nằm
trang sau và lookup lỗi, gửi/cập nhật/xóa rating có xác nhận, root/reply một cấp,
quyền chủ sở hữu, 409/429, nội dung HIDDEN/topology sai bị từ chối, validation/network,
Guest/return route, sửa Profile và session switch/response trễ. Test nền tảng đã có vẫn
kiểm tra refresh/401/403, abort trước dispatch và cache thuộc phiên.

Chromium đi qua Story Detail → Góc bạn đọc Guest → Login/return → update/delete/create
Rating → comment 429 rồi submit thủ công → edit → delete 409 → reply một cấp → Profile
update → logout; kiểm tra responsive 320/393/600. Dùng mock cả Authentication, không
phải tài khoản thật. Playwright dùng dependency đã có trong `admin-web`, không sửa dự án đó.

Không gửi request đến Backend thật, PostgreSQL hoặc Cloudinary. Không chạy migration,
seed hoặc tạo dữ liệu thật. 217 file Backend/Admin Web được đối chiếu SHA-256 trước/sau.

## Chạy lại

Dùng Node 24 LTS, cấu hình API URL cho thiết bị theo README. Không đặt DATABASE_URL,
JWT_SECRET hoặc Cloudinary secret trong biến EXPO_PUBLIC. Không ghi đè `.env` đang có.

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

Chromium smoke cần dependencies của Admin Web và Chromium đã cài sẵn. Dùng bản export
riêng với URL mock; script sẽ chặn đích khác nên không tự chuyển sang Backend thật:

```powershell
$previousApiUrl = $env:EXPO_PUBLIC_API_BASE_URL
try {
  $env:EXPO_PUBLIC_API_BASE_URL = 'http://127.0.0.1:4199/api'
  npx expo export --platform web --output-dir dist-web --clear
  if ($LASTEXITCODE -ne 0) { throw 'Web export failed' }
  npm run test:smoke:feedback
} finally {
  $env:EXPO_PUBLIC_API_BASE_URL = $previousApiUrl
}
```

Port server static tự cấp phát và đóng sau test; không khởi động Backend, không đụng
4000/5173. Bản export QA dùng URL mock; trước khi dùng export với Backend thật, export lại
với cấu hình API đúng. Script không ghi hoặc đọc credentials thật.

Chưa có thiết bị/emulator kết nối để xác nhận bàn phím/lifecycle/SecureStore native.
Lists dùng tải thêm trong ScrollView hiện có; cần virtualization nếu dữ liệu rất lớn.
Cảnh báo npm audit toolchain từ bước trước chưa được xử lý bằng nâng SDK hoặc force.
Dừng tại Bước 15.5.
