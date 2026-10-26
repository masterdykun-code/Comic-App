# Bước 16.1 — Mobile Web, Express và PostgreSQL thật

Runner dùng Expo Web export, Chromium của Playwright hiện có trong Admin Web, Backend
Express thật và `webnovel_test_db`. Không mock API nội bộ. Không có Android native/APK.

## An toàn và môi trường

- Tái sử dụng `backend/.env.integration`, chỉ chấp nhận `INTEGRATION_DATABASE_URL` trỏ
  chính xác PostgreSQL local `/webnovel_test_db?schema=public`. Không fallback sang `.env`.
- Dùng nguyên các hàm kiểm tra schema/migration/checksum/constraint của Bước 14.5 và
  advisory lock `1464746330,13` chung với các runner Backend để tránh chạy đồng thời.
- Chỉ chạy khi cả 13 bảng ứng dụng test trống. Kiểm tra lại ngay trước tạo fixture.
  Nếu dữ liệu không rõ nguồn gốc tồn tại, dừng; không tự xóa, reset hoặc nhận là fixture.
- Xác minh tên Database/schema thực tế qua PostgreSQL và Prisma trước fixture writes,
  trước dispatch mỗi HTTP mutation, và trong transaction tạo nội dung/cleanup.
- Backend riêng `127.0.0.1:4186`; Expo Web static server riêng `127.0.0.1:5196`.
  Port bận thì dừng, không tái sử dụng hoặc dừng process 4000/5173.
- CORS sử dụng nguyên cấu hình Backend hiện có, không sửa sang wildcard. UI browser
  thực hiện request chéo origin đến API test, gồm Authentication và mutation thật.
- JWT secret/password fixture ngẫu nhiên theo lượt chạy, chỉ truyền trong process env
  và bộ nhớ; không ghi token/password ra log, file storageState, trace, ảnh hoặc Git.
  Safe reporter chỉ in tên scenario, số lượng/kết quả và dòng lỗi, không raw assertions.
- Ảnh PNG đơn giản tạo bằng Sharp, phục vụ tại `/__fixtures__` của server test. Một URL
  cố ý 404 để kiểm tra lỗi ảnh. Không ảnh truyện có bản quyền hoặc Cloudinary upload.
- Browser chỉ cho network tới hai origin test; request nội bộ được **continue đến
  Backend thật**, không fulfill/mock. Backend vô hiệu hóa credentials Cloudinary và
  chặn upload_stream/external HTTPS. Bất kỳ lời gọi bị chặn nào làm test thất bại.
- Database chính chỉ được đọc qua transaction `REPEATABLE READ READ ONLY`; kết nối cũng
  bật default read-only. So sánh row counts và full-row digests của 13 bảng + migrations
  trước/sau. Không trả hàng dữ liệu, passwordHash, URL kết nối hoặc digest ra báo cáo.

## Fixture và cleanup

Mỗi lượt có runId ngẫu nhiên và namespace `e2e_<runId>_`:

- ADMIN/USER riêng dùng helper hash Argon2id của Backend; thêm USER mới qua UI Register.
- Hai Genre, NOVEL, COMIC, một Story DRAFT và các truyện phụ để kiểm tra phân trang.
- Chương số 1/3 PUBLISHED và 9 DRAFT cho mỗi loại; nội dung NOVEL nhiều dòng, dài đủ để
  cuộn và đo textOffset; COMIC có trang 1/3/7 để kiểm tra thứ tự thực thay vì số liên tiếp.
- Một bình luận HIDDEN được quản lý, không xuất hiện qua API/UI công khai.

Cleanup chạy cả khi scenario thất bại, sau khi đã đóng server/browser. Chỉ xóa các ID
story/chapter/page/genre đã ghi nhận trong manifest cùng các tương tác thuộc đúng
USER/ADMIN của lượt chạy. USER đăng ký chỉ chấp nhận chính xác username/email fixture
`<prefix>new`. Kiểm tra foreign data trước delete; mọi delete có điều kiện ID/ownership,
không TRUNCATE/global delete. Xóa replies trước roots, các bảng con trước bảng cha.
Nếu có tài nguyên lạ hoặc dữ liệu còn sót, transaction cleanup rollback và runner dừng.
Cuối lượt xác nhận cả 13 bảng test trống, giữ nguyên lịch sử migration.

## UI E2E thực tế (6 scenario)

1. Guest Home có NOVEL/COMIC; Explore phân trang/lọc Genre; Search theo tên; Story Detail
   chỉ đếm/hiện chương PUBLISHED. Kiểm tra API đọc trả 404 cho Story/Chapter DRAFT.
2. Register USER → Login → me → Favorite từ UI → Library → Logout → đăng nhập tài khoản
   thứ hai. Lịch sử được bảo vệ khi Guest; cache Favorite của tài khoản trước không hiện.
3. NOVEL giữ xuống dòng, chuyển chương 1↔3, lưu tiến độ từ thao tác chạm/cuộn thực, Library
   Continue Reading và khôi phục scroll theo textOffset. API control mô phỏng thiết bị
   khác lưu offset 6400; UI gửi phiên bản cũ nhận 409 và dừng tự lưu. Đọc lại server xác
   nhận offset mới không bị ghi đè. History có hủy/xác nhận xóa; Favorite/Progress còn
   nguyên. Xóa Favorite từ UI và kiểm tra trạng thái server.
4. COMIC tải PNG cục bộ đúng thứ tự; chạm/cuộn ghi pageNumber=3; mở lại tại trang 3 với
   nút tải trang trước, không đoán pixel. Chương trước/sau bỏ qua DRAFT; trang 7 lỗi hiển
   thị retry. API đọc xác nhận pageNumber 1,3,7 theo thứ tự.
5. Guest xem Rating/Comments nhưng không ghi; HIDDEN không xuất hiện. USER gửi/sửa/xóa
   Rating, thống kê đọc từ PostgreSQL; tạo/sửa root, phản hồi một cấp, delete root có
   replies trả 409. Profile sửa tên/avatar URL, UI AuthStore và GET me phản ánh thay đổi;
   mở lại form lấy đúng dữ liệu, payload không có role/status/id.
6. Login qua UI, kiểm tra USER/Guest bị chặn API ADMIN. Chỉ tăng thời gian trình duyệt
   để client chạm ngưỡng refresh; gọi refresh thật và nhận token xoay vòng thật. Replay
   refresh cũ qua API bị từ chối, phiên thực bị thu hồi; UI đọc tiếp nhận 401, refresh
   thất bại và chuyển về Guest, không giữ form riêng tư.

Các thao tác chính đi qua giao diện. API control/read assertions trong các scenario
được phân biệt rõ, không thay việc bấm form/scroll bằng API rồi gọi đó là UI E2E.

## API integration riêng (1 scenario)

- Login ADMIN fixture và GET admin stories thành công; không dùng ADMIN thật.
- Login USER, GET me không có passwordHash.
- Ký JWT đã hết hạn bằng secret ngẫu nhiên **chỉ của môi trường test**, gửi tới Express
  thật để kiểm tra 401. Không thay middleware Authentication hoặc giờ Backend.
- Hai request refresh đồng thời qua Backend/PostgreSQL thật: đúng một 200, một 401;
  phát hiện reuse thu hồi family, Access Token của lần thắng không còn dùng được.
- Logout ADMIN fixture rồi GET me trả 401.

Runner kiểm tra trực tiếp PostgreSQL cuối lượt: USER vẫn ACTIVE/USER, Profile đã cập
nhật và tiến độ NOVEL vẫn textOffset=6400. Không chỉ dựa vào mock hoặc dữ liệu UI.

## Lỗi phát hiện và sửa

Reader từng gọi flush không chờ trước replace/back. Reader mới có thể GET version cũ
trong khi queue của Reader trước chưa commit, rồi PUT nhận 409 dù chỉ có một người đọc.
Sửa tối thiểu Mobile: khóa điều hướng, dừng nhận vị trí mới, chờ `ReadingSync.close()`
drain cả in-flight/latest-pending rồi mới chuyển route. Kiểm tra generation trước khi
điều hướng; hook kích hoạt lại controller nếu Router tái sử dụng cho chương tiếp theo.
Regression UI với deferred save chứng minh route/chapter mới không mở trước commit và
double press không tạo hai chuyển trang. Không sửa Backend, API hoặc schema.

Các lỗi trong harness đã sửa: chờ phản hồi logout/delete trước khi đọc DB; dùng nhãn
nút History thực tế; sự kiện chạm thật thay touch event rỗng; chạm trước cuộn để phân
biệt gesture người dùng với cuộn restore 300ms, và chờ debounce/throttle có giới hạn.
Không đổi quy tắc sản phẩm để làm test qua hoặc tự retry mutation.

## File tạo/sửa

Tạo:

- `scripts/integration/safety.cjs`: cấu hình dùng chung và snapshot primary chỉ đọc.
- `scripts/integration/inspect.cjs`: preflight chỉ đọc.
- `scripts/integration/fixtures.cjs`: fixture/manifest và cleanup theo ownership.
- `scripts/integration/run.cjs`: server, export, Playwright, verify PostgreSQL và cleanup.
- `scripts/integration/backend-checks.cjs`: kiểm tra Backend bằng môi trường test riêng.
- `playwright.integration.config.cjs`: Chromium tuần tự, retries=0, không artifacts bí mật.
- `e2e/integration/mobile.spec.cjs`, `e2e/safe-reporter.cjs`: UI/API tests và safe reporter.
- `tests/integration-safety.test.ts`: 6 regression chặn xóa dữ liệu ngoài fixture/main DB.
- Tài liệu này.

Sửa `src/features/reader/ReaderScreen.tsx`, `src/features/reader/use-reading-sync.ts`,
`tests/reader-ui.test.tsx` cho race điều hướng; `package.json`, `.gitignore`,
`eslint.config.js`, `README.md` cho runner/checks/output và hướng dẫn. Không thêm hoặc
nâng thư viện, không sửa package-lock/Backend/Admin Web/schema/migration/.env.

## Kết quả

| Kiểm tra                                     | Kết quả cuối                                                     |
| -------------------------------------------- | ---------------------------------------------------------------- |
| Mobile TypeScript strict / ESLint / Prettier | Đạt                                                              |
| Mobile unit/UI/regression                    | **248/248**, 17 suite; thêm 6 safety tests + 1 Reader regression |
| Expo Doctor 1.21.5                           | **21/21**                                                        |
| Android Hermes bundle / Expo Web export      | Thành công; không tạo APK                                        |
| Chromium UI E2E                              | **6/6**, Backend + PostgreSQL thật                               |
| API integration riêng                        | **1/1**, gồm JWT hết hạn/concurrent refresh/ADMIN/logout         |
| Backend typecheck / build                    | Đạt                                                              |
| Backend regression, file-level concurrency=1 | **263/263**, 0 skipped                                           |
| PostgreSQL integration hiện có               | **19/19** tính parent, **18/18** kịch bản con                    |
| Prisma migration status trên Database test   | Đồng bộ; không sửa schema/migration                              |
| Fixture cleanup                              | Tất cả 13 bảng ứng dụng test trống                               |
| Primary read-only fingerprints               | webnovel_db không đổi trước/sau E2E và Backend checks            |

Lượt regression Backend đầu chạy song song các file trong lúc xuất Android có **2/263**
test lỗi tại `fetch` trong harness Chapters/Upload. Không đổi mã Backend hoặc bỏ test.
Runner mới chạy toàn bộ danh sách test lấy từ package.json với `--test-concurrency=1`;
các test concurrency bên trong mỗi file vẫn chạy nguyên bản. Lượt cuối đạt 263/263.
Chưa đủ bằng chứng xác định tận gốc hai lỗi transport ban đầu; không khẳng định đã sửa
hoặc kiểm chứng tính ổn định của chế độ chạy song song đó. Nên điều tra riêng nếu CI
cần bật lại file-level parallelism. Đây không phải cơ chế tự retry mutation hoặc lặp
vô hạn đến khi test qua.

## Chạy lại

Dùng Node 24 LTS. Cần dependencies hiện có của cả ba project và Chromium Playwright
đã cài. PostgreSQL local hoạt động, `.env.integration` riêng đã cấu hình đúng. Không
cần tài khoản ADMIN thật. Không gửi mật khẩu hoặc token qua chat.

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\mobile
npm run integration:inspect
npm run test:e2e:integration
npm run verify:backend
npm run typecheck
npm run lint
npm run format:check
npm test
npx expo-doctor@1.21.5
npm run export:android
```

`test:e2e:integration` tự xuất Expo Web vào `dist-integration`, dựng/đóng hai server,
tạo/dọn fixture. Không chạy trực tiếp Playwright config vì runner phải kiểm tra Database
và cấp fixture trước. Không chạy đồng thời với Backend `test:postgres`/Admin E2E.
`verify:backend` dùng runner PostgreSQL hiện có, chạy typecheck/build, toàn bộ regression
tuần tự theo file, 18 PostgreSQL subscenario và migration status; tự kiểm tra target test
và cleanup. Không đổi script/cấu hình Backend chính để thực hiện điều này.

Bản export E2E chứa URL loopback của Backend test, không phải cấu hình dùng trên điện
thoại. Muốn chạy Expo trên Android, dùng `.env` Mobile và chỉ dẫn LAN/emulator ở README;
không ghi credentials Backend vào EXPO_PUBLIC. Không ghi đè `.env` để chạy test.

## Giới hạn Web

- Chromium không kiểm chứng SecureStore/Keychain/Keystore, lifecycle nền/kill app, gesture,
  bàn phím hoặc hiệu năng Android native. Không tạo APK và không tuyên bố Android đã qua.
- Web dùng refresh vault trong bộ nhớ, không chứng minh phiên còn sau reload/đóng app.
- Restore NOVEL theo UTF-16 block anchor và COMIC theo đầu trang hiện có, không hứa đúng
  pixel trên mọi font/thiết bị. Test clock chỉ thúc client refresh; thu hồi phiên và JWT
  hết hạn là kiểm tra Backend thật riêng biệt như mô tả trên.
- Không chạy Cloudinary thật. Không tối ưu UI hay nâng Expo trong bước này.
