# Bước 14.5 — Admin Web → Backend thật → PostgreSQL test

## Chạy lại trên Windows

Đã cài dependencies của hai project và Chromium. Nếu máy mới chưa có Chromium,
chạy `npx playwright install chromium` trong admin-web.

Từ Backend:

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\backend
npm run test:admin-e2e
```

Hoặc từ Admin Web: `npm run test:e2e:integration`.

Không chạy trực tiếp config Playwright integration. Runner phải xác minh DB, chuẩn bị
fixture, cấu hình API riêng và khởi động các process trước. Không cần đăng nhập tài khoản
ADMIN thật hoặc nhập token vào chat. Không chạy đồng thời với `npm run test:postgres`.

Backend cần `.env.integration` đã được cấu hình với duy nhất `INTEGRATION_DATABASE_URL`
trỏ đến local **webnovel_test_db/public**. Không có fallback sang `.env`/DATABASE_URL đang
kế thừa. `.env.integration` tiếp tục bị Git ignore và không bị sửa bởi bước này.
Schema test phải đã được migrate đúng dự án và toàn bộ 13 bảng ứng dụng phải trống.
Nếu chuẩn bị máy mới, đọc [hướng dẫn DB test](../backend/docs/postgres-integration.md)
và xin quyền tạo DB nếu chưa có. Runner E2E không tự tạo database hoặc chạy migration.

## Môi trường và an toàn

- Backend test `http://127.0.0.1:4185`; Vite test `http://127.0.0.1:5195`.
- `VITE_API_BASE_URL=http://127.0.0.1:4185/api` được cấp riêng qua môi trường process.
  Không đổi `.env` của Frontend đang chạy ở 5173 hoặc Backend ở 4000.
- Hai cổng phải trống; Vite dùng strictPort, không tái sử dụng dev server.
- URL DB được kiểm tra, sau đó xác minh `current_database()`/`current_schema()` qua pg và
  chính Prisma Client dùng để ghi. Kiểm tra migration checksum, bảng, enum, khóa/index/
  constraint trước khi ghi. Không sửa schema hoặc migration.
- Advisory lock dùng chung với integration runner ngăn hai bộ test cùng thao tác DB test.
- Tạo đúng một ADMIN ACTIVE và một USER ACTIVE fixture, namespace ngẫu nhiên theo lần chạy,
  mật khẩu ngẫu nhiên băm bằng cấu hình Argon2id thật. Không dùng tài khoản thật.
- JWT secret ngẫu nhiên riêng cho process test; các biến Cloudinary thật bị bỏ/trống.
- Không mock Authentication, Stories, Chapters, Genres hoặc Comments. Browser route chỉ
  cho request đến hai origin test; ảnh fixture HTTPS được render bằng PNG cục bộ.
- Boundary storage của Backend được thay trong runner test; multipart, xác thực, giải mã
  và validation ảnh vẫn chạy thật. Cloudinary upload_stream và HTTPS từ process Backend
  bị chặn, không có fallback gọi dịch vụ thật. Không thêm test hook vào API production.
- Không lưu credentials/token vào file. Playwright trace/video/screenshot tự động bị tắt;
  reporter chỉ xuất tên test, trạng thái, vị trí lỗi và số lượng. Ảnh chụp chủ động sau đăng
  nhập nằm dưới `test-results/integration` (Git ignore), chỉ chứa dữ liệu fixture.
- Trước/sau E2E, kết nối riêng đến webnovel_db được đặt READ ONLY để so sánh count và digest
  đầy đủ từng hàng của 13 bảng cùng `_prisma_migrations`. Không đưa giá trị hàng hoặc digest
  ra log. Nếu có người khác sửa dữ liệu chính đồng thời, kiểm tra này sẽ báo khác biệt.

## Năm kịch bản Chromium tích hợp

1. **NOVEL:** đăng nhập qua UI; tạo Genre và Story DRAFT; upload bìa PNG fixture qua multipart;
   tạo chương chữ nhiều dòng; DRAFT không public; kiểm tra Backend từ chối xuất bản chương
   trước truyện. Xuất bản truyện rồi chương qua UI; API public trả đúng Story, chương và
   chính xác văn bản/xuống dòng. Backend hiện yêu cầu xuất bản truyện trước chương.
2. **COMIC:** tạo Story/chương qua UI; chọn hai PNG, xác nhận upload thật vào Backend với
   storage mock; response order 1..n; upload không tự tạo ChapterPage; đảo thứ tự, xác nhận
   lưu, xuất bản và xác minh thứ tự URL/pageNumber qua API public. Không lộ storagePublicId.
3. **Quản lý:** thêm/sửa/xóa Genre chưa dùng; Genre đã gắn truyện trả HTTP 409; danh sách
   Stories lọc thật. Tạo root/reply bằng tài khoản USER fixture qua API thật; Hide/Show từ
   UI và kiểm tra root HIDDEN che toàn bộ phản hồi qua API public.
4. **Phiên bản chương:** lưu UI có expectedUpdatedAt; sửa đồng thời qua API thật làm editor
   cũ bị chặn. Backend trả 409 CHAPTER_STALE với phiên bản cũ; hai kết nối ghi cùng phiên bản
   có đúng một 200 và một 409; văn bản giữ nguyên.
5. **Bảo mật:** Guest redirect/401; USER bị từ chối ở UI/API; validation UI và Backend 400;
   CLI test riêng làm hết hạn phiên ADMIN fixture trong DB test, /auth/me trả 401, UI xác
   thực lại rồi về login. Đây là session expiry thật trong DB, không chờ 15 phút hoặc mock
   response Authentication. Không thêm endpoint điều khiển test công khai.

## Dọn fixture và chạy lặp lại

Runner đóng browser/Vite/Backend do chính nó tạo rồi dọn trong transaction. Xác minh lại
DB đích và quyền sở hữu namespace; chỉ xóa user/session/Story/Genre và các quan hệ thuộc
fixture của lần chạy. Không TRUNCATE, delete toàn bảng, reset, DROP hoặc xóa ảnh Cloudinary.
Nếu gặp user/Story/Genre lạ hoặc còn hàng ngoài phạm vi fixture, rollback việc dọn và dừng.
Sau cleanup, kiểm tra cả 13 bảng ứng dụng trống, giữ nguyên `_prisma_migrations`.

Nếu process bị tắt cưỡng bức/mất điện, fixture có thể còn. Lần chạy sau sẽ dừng thay vì tự
xóa. Cần kiểm tra thủ công nguồn dữ liệu trước khi quyết định dọn; không chạy migrate reset.

## Lỗi thực tế đã sửa

Backend có hợp đồng upload `order` từ **1** (đã có trong tài liệu Backend và test upload).
Frontend trước đó chỉ nhận `0..n-1`; test mock cũ cũng giả định 0 nên không phát hiện lỗi.
Sửa tối thiểu ở `src/features/chapters/api.ts` để nhận đủ `1..n` duy nhất, giữ nguyên sắp
xếp theo order và API Backend. Sửa fixture/unit/Chromium mocks, tài liệu CHAPTERS, bổ sung
bốn regression test từ chối order bắt đầu 0, trùng, thiếu khoảng hoặc không nguyên.

## Kết quả cuối

| Kiểm tra                                | Kết quả                             |
| --------------------------------------- | ----------------------------------- |
| Backend typecheck/build                 | Đạt                                 |
| Backend unit/regression trên DB test    | 263/263                             |
| PostgreSQL integration                  | 19/19 (18 kịch bản con và test cha) |
| Frontend typecheck/build/lint/format    | Đạt                                 |
| Frontend unit/UI                        | 137/137                             |
| Chromium smoke với API mock có sẵn      | 10/10                               |
| Chromium tích hợp API + PostgreSQL thật | 5/5                                 |
| Migrate status DB test                  | Up to date                          |
| Cleanup                                 | 13 bảng ứng dụng test trống         |
| Cloudinary thật                         | 0 lần gọi; 3 mock storage uploads   |
| Database chính                          | Count/digest trước và sau E2E khớp  |

Một lần chạy regression đầu có test cũ `invalid comment rejected: blank` thất bại thoáng
qua; chạy riêng và toàn bộ 263 test lại đều đạt, chưa tái hiện được để kết luận nguyên nhân.
Reporter regression đã được bổ sung chẩn đoán an toàn (code/số dòng/giá trị nguyên thủy).
Còn cảnh báo pg về truy vấn đồng thời bên trong Prisma adapter/runtime; luồng ghi đồng
thời và ràng buộc dữ liệu đều đạt. Không nâng version thư viện hoặc sửa adapter trong bước
này. Frontend build vẫn có cảnh báo chunk >500 kB, không chặn build.

## File tạo/sửa

Tạo:

- `backend/tests/browser/{run.ts,fixtures.ts,control.ts}`
- `backend/tests/browser-safety.test.ts`
- `admin-web/playwright.integration.config.ts`
- `admin-web/tests/integration/{admin.spec.ts,safe-reporter.cjs}`
- `admin-web/E2E-INTEGRATION.md`

Sửa:

- `backend/package.json` — lệnh test:admin-e2e và test guard mới trong npm test.
- `backend/tests/integration/run.ts` — chạy đủ các regression hiện tại trên DB test,
  reporter an toàn; `backend/tests/integration/safe-reporter.cjs` — nhận vị trí mọi test.
- `admin-web/package.json`, `tsconfig.node.json` — lệnh chạy lại và typecheck config mới.
- `admin-web/src/features/chapters/api.ts` — sửa kiểm tra order đúng hợp đồng Backend.
- `admin-web/tests/{chapters-api.test.ts,chapters.test.tsx}`, `tests/e2e/chapters.spec.ts`
  — regression và fixture upload đúng hợp đồng.
- `admin-web/CHAPTERS.md`, `README.md` — hợp đồng order và hướng dẫn E2E.

Không thay Authentication, Prisma Schema/migration hoặc Backend API production.
