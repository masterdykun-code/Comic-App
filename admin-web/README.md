# WebNovel Admin Studio — Bước 14.5

React + TypeScript + Vite Admin Web, độc lập với `backend`. Bước này chỉ có Login,
Admin Layout, Dashboard tài khoản thật, nền tảng phiên/routing, quản lý Stories
và Chapters NOVEL/COMIC, quản lý Genres và kiểm duyệt Comments.
Chi tiết Stories: [STORIES.md](./STORIES.md). Quản lý chương NOVEL/COMIC,
API và danh sách file Bước 14.3: [CHAPTERS.md](./CHAPTERS.md).
Quản lý thể loại và kiểm duyệt bình luận Bước 14.4: [CATALOG.md](./CATALOG.md).
Kiểm thử tích hợp UI → Backend → PostgreSQL test, cách chạy và báo cáo Bước 14.5:
[E2E-INTEGRATION.md](./E2E-INTEGRATION.md).
Không có dữ liệu demo, API thống kê giả hoặc tài nguyên lấy từ giao diện WebNovel khác.
Minh họa được dựng bằng CSS và icon Lucide.

## Chạy trên Windows / VS Code

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\admin-web
npm install
Copy-Item .env.example .env # Chỉ cần nếu .env chưa tồn tại; không ghi đè cấu hình riêng
npm run dev
```

Mở http://127.0.0.1:5173. Backend cần chạy riêng ở cổng 4000. Vite dùng strictPort,
không tự chuyển sang cổng khác. Build và preview:

```powershell
npm run typecheck
npm run build
npm run preview
```

Preview chạy tại http://127.0.0.1:4173. Máy hiện tại dùng Node.js 25.9.0, npm
11.12.1. Phiên bản thư viện cụ thể được cố định bằng package-lock.json; dùng
`npm ci` cho môi trường tái lập. Không cần Prisma hoặc PostgreSQL ở admin-web.

## Cấu hình

`.env.example` và `.env` cục bộ:

```dotenv
VITE_API_BASE_URL=http://localhost:4000/api
```

VITE_* là cấu hình công khai được đưa vào bundle. Không đặt JWT_SECRET,
DATABASE_URL, Cloudinary API Secret, mật khẩu hoặc token trong biến VITE_*.
Không hardcode URL trong components. Đổi .env thì khởi động lại Vite.
`.env`/`.env.*` bị ignore; chỉ `.env.example` được phép đưa vào Git.

Backend hiện dùng `app.use(cors())`, cho phép request từ origin của Admin Web.
Đã kiểm tra GET health 200 và OPTIONS 204 cùng Authorization/content-type.
Không thay đổi Backend hoặc bổ sung wildcard CORS. Cấu hình allowlist CORS cho
production vẫn cần được xem xét riêng trước khi triển khai; đây là chính sách
Backend hiện có, không phải thay đổi của bước Frontend này.

## Routes và giao diện

- `/login`: form email/mật khẩu, Zod validation, hiện/ẩn mật khẩu, loading, lỗi
  thân thiện và kiểm tra tài khoản ADMIN thực tế qua API.
- `/dashboard`: protected route, thông tin tài khoản từ Backend, sidebar/header,
  phiên đã xác thực, nút kiểm tra lại phiên và logout.
- `/`: chuyển tới Dashboard (rồi Login nếu chưa có phiên).
- `*`: trang 404/chưa có sẵn.

Stories đã mở các route `/stories`, `/stories/new`, `/stories/:id`, `/stories/:id/edit`.
Chapters đã mở trong chi tiết Story; mục sidebar dẫn về Stories để chọn truyện.
Genres, Comments, Users và Settings vẫn disabled, gắn trạng thái Sắp có. Khu vực
thống kê thông báo chưa có API, không hiển thị counters/biểu đồ dữ liệu giả.
Layout responsive; drawer mobile có focus trap, Escape và trả focus về nút mở.

## Authentication và lưu phiên

Đã đối chiếu hợp đồng Backend:

- POST `/auth/login`: `{ email, password }` → `{ success, data: { user,
accessToken, refreshToken, tokenType: 'Bearer', expiresIn } }`.
- POST `/auth/refresh`: `{ refreshToken }` → cùng cấu trúc token, có rotation.
- POST `/auth/logout`: `{ refreshToken }` → thu hồi session liên quan.
- GET `/auth/me`: Bearer Access Token → profile công khai hiện tại.

Cả Access Token và Refresh Token chỉ nằm trong memory của tab. Profile công khai
được đưa vào React/TanStack Query; snapshot cho UI không có token. Không dùng
localStorage, sessionStorage, IndexedDB, cookie hoặc file để lưu credentials.
Backend chưa có HttpOnly refresh cookie nên không tự sửa hoặc giả định hỗ trợ.
**Tải lại trang, đóng tab, crash hoặc HMR có thể mất phiên và cần đăng nhập lại.**
Nhiều tab đăng nhập riêng sẽ có session riêng, không chia sẻ refresh token.
Đóng hoặc tải lại tab không bảo đảm thu hồi session trên máy chủ; token trong
memory bị mất nhưng session server có thể còn đến khi hết hạn hoặc được thu hồi.

Login được xác minh thêm qua `/me`. Chỉ ADMIN ACTIVE được vào layout; USER/BANNED
bị chặn và token vừa cấp được gửi logout để thu hồi khi khả thi. Role từ JWT
không được dùng để suy ra quyền; thông tin đến từ Backend. Middleware Backend
vẫn phải xác thực/phân quyền mọi API quản trị, kể cả khi Frontend đã chặn.

Access Token được refresh khi còn dưới 30 giây. Rotation là single-flight trong
mỗi Session: các request đồng thời dùng chung promise và token mới thay token cũ.
Profile được kiểm tra lại theo chu kỳ 60 giây khi tab hoạt động, khi focus/reconnect
hoặc khi bấm kiểm tra phiên; từ đó nhận biết tài khoản bị cấm/hạ quyền.

GET/HEAD nhận 401 có thể refresh và retry đúng một lần. Request dùng token cũ sẽ
nhận token mới đã có thay vì refresh lần nữa. 401 tiếp theo kết thúc phiên;
403 trả lỗi quyền và không tạo vòng lặp refresh. POST/PATCH/PUT/DELETE không tự
replay khi 401. Các mutation Stories và upload không tự retry; người dùng cần
kiểm tra trạng thái trước khi gửi lại nếu kết quả chưa rõ. API client chặn URL khác
origin/path API để tránh gửi Bearer ra ngoài.

Nếu refresh lỗi mạng/timeout, server có thể đã tiêu thụ token. Frontend kết thúc
phiên cục bộ, không retry refresh token đó, và cố thu hồi phiên bằng logout.
Khi logout, memory và cache được xóa ngay. Nếu mất mạng, thông báo rõ chưa xác
nhận thu hồi phía server; server session vẫn có thể tồn tại đến khi hết hạn.
Refresh/login về muộn sau logout không được khôi phục phiên. Không có log token,
password, Axios config hay raw error từ máy chủ; lỗi được chuyển sang ApiError
an toàn, không giữ cause/request chứa credentials.

Memory-only giảm lưu trữ token lâu dài nhưng không chống hoàn toàn XSS đang chạy
trong tab. Phiên bền vững cần thiết kế Backend refresh-cookie HttpOnly/CSRF phù
hợp ở bước riêng; chưa triển khai trong phạm vi này.

## Cấu trúc và danh sách file

```text
admin-web/
  src/
    app/providers.tsx
    components/{Brand,Alert}.tsx
    features/auth/{session.ts,runtime.ts,auth-context.ts,AuthProvider.tsx}
    layouts/AdminLayout.tsx
    lib/api/{transport,client,errors}.ts
    pages/{LoginPage,DashboardPage,NotFoundPage}.tsx
    routes/AppRoutes.tsx
    types/auth.ts
    App.tsx
    main.tsx
    index.css
  tests/
    setup.ts
    fixtures.ts
    session.test.ts
    api.test.ts
    pages.test.tsx
    e2e/auth.spec.ts
  .env                   # local, ignored
  .env.example
  .gitignore
  .oxlintrc.json
  .prettierrc.json
  .prettierignore
  index.html
  package.json
  package-lock.json
  tsconfig.json
  tsconfig.app.json
  tsconfig.node.json
  vite.config.ts
  playwright.config.ts
  README.md
```

Dùng React Router, TanStack Query, Axios, Tailwind qua Vite plugin,
React Hook Form + Zod, Lucide React. Strict TypeScript ở app/test/config; không
có any trong code. Source được định dạng bằng Prettier, lint bằng Oxlint.
Các file Vite demo không sử dụng đã được bỏ. Bước 14.2 bổ sung duy nhất API đọc
chi tiết ADMIN theo xác nhận của người dùng; xem STORIES.md và backend/docs/stories.md.

Tài liệu cấu hình đã đối chiếu:
[Vite](https://vite.dev/guide/),
[Tailwind Vite plugin](https://tailwindcss.com/docs/installation/using-vite),
[React Router declarative routing](https://reactrouter.com/start/declarative/installation).

## Kiểm thử

```powershell
npm test
npx playwright install chromium # Một lần nếu máy chưa có browser kiểm thử
npm run test:e2e
npm run lint
npm run format:check
```

Vitest + Testing Library kiểm tra render/validation, ADMIN/USER/BANNED,
protected routes, network error, logout, rotation single-flight, expiry,
không hồi sinh phiên, retry giới hạn, response validation và không leak secrets.
Test storage dùng mock in-memory để Node 25 Web Storage không ghi ra disk.

Playwright chạy browser thật với **tất cả request API được mock**, tài khoản giả,
không có đăng nhập ADMIN thật. Kiểm tra desktop, mobile, drawer/bàn phím, logout,
reload mất phiên, USER bị chặn và browser storage trống. Screenshot trong
`test-results` bị Git ignore; thông tin QA Admin chỉ có trong test, không trong
ứng dụng thực tế. Không bật trace chứa request password/token.

Không gọi Authentication thật, ghi PostgreSQL, chạy migration hay upload
Cloudinary trong test Frontend. Kiểm tra Backend thật chỉ có health/CORS đọc.

## Kết quả bàn giao Bước 14.1 — 18/10/2026

- Đã cài dependency; package-lock và npm dependency tree hợp lệ.
- Typecheck, production build, Oxlint và Prettier check đều đạt.
- Vitest/Testing Library: 26/26 test đạt.
- Chromium/Playwright: 3/3 test đạt, có kiểm tra desktop/mobile, menu focus,
  token không lưu trong browser storage và reload về Login.
- Đã xem screenshot Login, Dashboard desktop và mobile bằng dữ liệu mock.
- Backend health 200, CORS preflight 204. Chưa đăng nhập ADMIN thật trong kiểm thử.
- Chỉ tạo/chỉnh sửa trong admin-web; không sửa Backend/schema/migration hoặc dữ
  liệu PostgreSQL. Các chức năng CRUD và phiên bền vững để bước sau.
