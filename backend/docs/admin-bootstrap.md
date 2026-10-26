# Bootstrap ADMIN đầu tiên

## Chạy thủ công

Trong Terminal PowerShell cục bộ của VS Code:

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\backend
npm run admin
```

Đảm bảo Prisma Client đã được generate (`npm run prisma:generate`) và `.env`
đang trỏ đúng database dự định. CLI dùng lại cấu hình Prisma hiện có. Không có
username, email hoặc mật khẩu mặc định. CLI không được gọi qua HTTP, seed,
postinstall hoặc script start/dev.

CLI kiểm tra ADMIN trước khi hỏi lần lượt username, email, displayName, password
và xác nhận password. Password nhập ẩn hoàn toàn, không hiện ký tự hoặc dấu *;
Backspace vẫn hoạt động. Ctrl+C/Ctrl+D trong prompt password hủy thao tác và khôi
phục terminal. Không dùng pipe/redirect, không truyền credentials qua argv và
không chạy trong CI. Môi trường phải có stdin/stdout TTY. TTY không chứng minh
được vị trí vật lý (ví dụ SSH cũng có thể có TTY); chỉ vận hành trong console
tin cậy do người quản trị kiểm soát.

Input dùng lại validation đăng ký: username 3–30 ký tự ASCII chữ/số/underscore,
email hợp lệ tối đa 254 ký tự, chuẩn hóa username/email lowercase; displayName
1–100 ký tự sau trim. Password 8–128 ký tự, không trim, phải trùng xác nhận.
Không lưu lịch sử password hay nhận role/status từ input.

Khi thành công, tạo **tài khoản mới** với role=ADMIN, status=ACTIVE và in thông
báo cố định. Không in password/hash/token. Đăng nhập sau đó qua API hiện có
POST /api/auth/login bằng tài khoản vừa tạo, giữ token tại máy.

## An toàn và transaction

Nếu đã có bất kỳ ADMIN nào, kể cả BANNED, bootstrap từ chối; không phải công cụ
khôi phục tài khoản hoặc tạo thêm ADMIN. USER hiện có không bị sửa hay nâng quyền.
Username/email đã tồn tại bị từ chối, gồm kiểm tra không phân biệt hoa thường;
unique constraint PostgreSQL vẫn là lớp bảo vệ race với đăng ký USER thông thường.

Argon2id dùng cùng helper với Authentication: memoryCost=19456 KiB, timeCost=2,
parallelism=1, salt ngẫu nhiên do thư viện sinh. Việc refactor chỉ chuyển hàm hash
sang helper, không thay đổi hành vi đăng ký USER hay đăng nhập/JWT.

Prompt và hash diễn ra ngoài transaction để không giữ khóa khi chờ người nhập.
Transaction ReadCommitted lấy exclusive pg_advisory_xact_lock với cặp khóa cố
định (1464746308,1), rồi kiểm tra lại ADMIN, identity và insert. ReadCommitted
đảm bảo lần kiểm tra sau khi chờ lock thấy ADMIN vừa commit từ CLI khác. Khóa
tự nhả khi commit/rollback; timeout lock 5 giây, transaction 10 giây. Hai process
CLI tuân cùng protocol không thể cùng tạo hai ADMIN đầu tiên. Privileged SQL
hoặc công cụ ngoài bỏ qua protocol không bị advisory lock cưỡng chế; bảo vệ
quyền truy cập database riêng biệt.

Lỗi trong transaction rollback insert. Unique race trả thông báo trùng chung;
lock/transaction timeout trả thông báo thử lại. Không in lỗi Prisma/URL/kết nối
thô. Nếu mất mạng đúng thời điểm commit, kết quả có thể không xác định; chạy lại
để kiểm tra ADMIN đã tồn tại, không tự nâng quyền hoặc cố tạo cưỡng bức.

Exit code: 0 thành công, 1 từ chối/lỗi, 130 hủy từ prompt. CLI luôn đóng terminal
và disconnect Prisma khi kết thúc bình thường/hủy có xử lý. Process bị kill sẽ
được PostgreSQL giải phóng connection/transaction theo cơ chế server.

## File tạo/sửa

Tạo mới (đường dẫn tương đối backend):
- `src/scripts/create-admin.ts`
- `src/services/admin-bootstrap.service.ts`, `src/services/admin-bootstrap.store.ts`
- `src/types/admin-bootstrap.types.ts`
- `src/utils/admin-terminal.ts`, `src/utils/admin-bootstrap-error.ts`, `src/utils/password.ts`
- `tests/admin-bootstrap.test.ts`, `tests/helpers/memory-admin-bootstrap.store.ts`
- `docs/admin-bootstrap.md`

Sửa `src/services/auth.service.ts` để tái sử dụng password helper và `package.json`
để thêm admin/test:admin, đưa suite bootstrap vào npm test. Không thêm dependency,
endpoint, schema hoặc migration. `.env` không thay đổi.

## Kiểm thử

`npm run test:admin` chạy service/CLI với fake terminal và memory store; không chạy
entrypoint npm run admin, không kết nối database thật hoặc tạo ADMIN thật. Có test
hash Argon2id thực, concurrent bootstrap, BANNED ADMIN, trùng identity, rollback,
input sai, CLI cancellation, TTY/CI/argv guard và input password không echo.
`npm test` chạy thêm toàn bộ suite hiện có. Chưa kiểm thử ghi/concurrency qua hai
connection PostgreSQL test riêng và chưa kiểm thử prompt trên TTY Windows thật;
không chạy bootstrap thật trong bước xây dựng này.

Tham khảo:
[PostgreSQL advisory locks](https://www.postgresql.org/docs/current/explicit-locking.html#ADVISORY-LOCKS),
[Node.js readline](https://nodejs.org/api/readline.html).
