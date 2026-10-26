# Bước 15.2 — Khám phá nội dung công khai

**Cập nhật Bước 15.4:** Auth forms, Library và History đã hoàn thành; xem
[AUTH-LIBRARY.md](AUTH-LIBRARY.md). Các giới hạn chưa có những màn hình này bên dưới là
trạng thái lịch sử của bước được ghi nhận.

Tài liệu này ghi nhận Bước 15.2. Reader placeholder đã được thay bằng Reader NOVEL/COMIC
ở Bước 15.3; xem [READER.md](READER.md). Các giới hạn Reader bên dưới là trạng thái lịch sử.

Home, Explore, Search và Story Detail sử dụng API client Axios và Query provider hiện có.
Không thêm dependencies, không nâng Expo SDK. Nền tảng Authentication giữ nguyên.
Login/Register và nội dung Reader vẫn là placeholder của bước trước.

## Màn hình

- **Home**: giới thiệu tĩnh, tìm kiếm, truyện mới nhất, NOVEL, COMIC; mỗi mục lấy tối đa
  4 truyện thật theo `sort=newest`. Không giả lập featured, ranking hoặc số lượt xem.
- **Explore**: thể loại, loại truyện, trạng thái, sắp xếp; tải thêm 12 truyện/trang.
  Đổi bộ lọc hủy query cũ, bỏ các trang cache của danh sách đó và trở về trang đầu,
  kể cả khi quay lại bộ lọc trước. Type/genre trong liên kết được phản ánh đúng vào bộ lọc.
- **Search**: tìm tên truyện, debounce 400 ms, trim hai đầu nhưng giữ tiếng Việt và
  khoảng trắng bên trong; tối đa 200 ký tự. Chuỗi rỗng không gọi API. Kết quả cũ không
  ghi đè tìm kiếm mới; hỗ trợ xóa từ khóa, tải thêm và điều hướng truyện.
- **Story Detail**: bìa 2:3, tác giả, thể loại, loại/trạng thái, mô tả giữ xuống dòng,
  tổng số chương PUBLISHED, danh sách chương có tải thêm và nút cuộn tới danh sách.
  Nút đọc bị vô hiệu khi chưa có chương, đang tải hoặc tải chương lỗi.
- **Reader**: `/reader/[id]?storyId=<UUID>`; `id` là chapterId. Bắt đầu đọc lấy phần tử
  đầu của trang chương đầu tiên, Backend sắp `chapterNumber ASC`, không giả định chương 1.
  Guest mở được Reader; chưa tải nội dung hoặc ghi tiến độ.

Các màn hình có loading, empty, lỗi an toàn/retry và pull-to-refresh. Bìa thiếu, URL sai
protocol hoặc tải lỗi dùng biểu tượng sách trung tính, không thay bằng ảnh truyện ngẫu nhiên.
Thành phần lọc/nút có nhãn accessibility và vùng bấm tối thiểu 44–48px. Nhãn Bottom Tabs
không bị flex shrink cắt chữ. Không có nút quản trị hoặc API ADMIN trong module này.

## Hợp đồng Backend đã đối chiếu

| API GET                          | Sử dụng                                                                             |
| -------------------------------- | ----------------------------------------------------------------------------------- |
| `/api/stories`                   | Home/Explore/Search: `page`, `limit`, `search`, `type`, `genreId`, `status`, `sort` |
| `/api/stories/:id`               | Chi tiết truyện bằng UUID, không dùng slug                                          |
| `/api/genres`                    | Danh sách thể loại theo tên                                                         |
| `/api/genres/:id/stories`        | Adapter và test cho hợp đồng riêng; chỉ nhận page/limit/type                        |
| `/api/stories/:storyId/chapters` | Metadata chương PUBLISHED, page/limit, thứ tự chapterNumber tăng dần                |

Envelope danh sách là `{success,message,data:[],pagination:{page,limit,total,totalPages}}`.
Chi tiết/thể loại dùng `{success,message,data}`. Sort chỉ có `newest`, `updated`, `title`;
type là `NOVEL/COMIC`, status là `ONGOING/COMPLETED`.

Explore dùng `/stories?genreId=...` để kết hợp đầy đủ status/sort/type, vì endpoint
`/genres/:id/stories` không hỗ trợ status/sort/search. Không âm thầm gửi query không hợp lệ.

API công khai tự lọc PUBLISHED và **không trả publishStatus hoặc chapterCount** của Story.
Parser chấp nhận đúng payload này, whitelist trường công khai, kiểm tra cấu trúc, UUID,
enum, pagination, chương thuộc đúng truyện/thứ tự. Nếu response bất thường có DRAFT rõ ràng,
module từ chối toàn bộ response, không hiển thị nội dung đó. Bảo vệ nội dung cuối cùng vẫn
do Backend thực hiện. Số chương lấy chính xác từ `pagination.total` của API chương,
không dùng count ADMIN, không giả lập 0 khi đang tải/lỗi.

Tất cả request dùng `api` tại `src/services/runtime.ts`, timeout/error/refresh có sẵn,
AbortSignal và query key theo bộ lọc. Không tạo Axios instance thứ hai trong ứng dụng.

## File tạo mới

- `src/features/stories/api.ts`, `queries.ts`, `ui.tsx`.
- `src/features/stories/HomeScreen.tsx`, `ExploreScreen.tsx`, `SearchScreen.tsx`,
  `StoryDetailScreen.tsx`.
- `src/components/StoryCover.tsx` và `src/app/search.tsx`.
- `tests/catalog-fixtures.ts`, `catalog-api.test.ts`, `catalog-ui.test.tsx`.
- `STORIES.md`.

## File chỉnh sửa

- `src/app/_layout.tsx`, `(tabs)/_layout.tsx`, `(tabs)/index.tsx`, `(tabs)/explore.tsx`,
  `story/[id].tsx`: đăng ký Search, trỏ route sang màn hình thật và sửa nhãn tab.
- `src/components/ScreenContainer.tsx`: thêm refresh/ref tùy chọn, tương thích màn hình cũ.
- `src/components/StoryCard.tsx`: dùng bìa 2:3, hỗ trợ coverUrl null.
- `src/features/foundation/screens.tsx`: bỏ Home/Explore placeholder cũ, kiểm tra storyId
  nếu có trên Reader; giữ nguyên hành vi Library/Profile/Auth/Account.
- `tests/navigation.test.tsx`, `components.test.tsx`, `jest-env.d.ts`: cập nhật navigation,
  fallback bìa và kiểu matcher Router.
- `README.md`: trạng thái hiện tại và hướng dẫn cấu hình/chạy.

Không sửa `src/services`, `src/stores`, `src/types/auth.ts`, `src/lib/providers.tsx`,
package.json/lockfile, app.json, Backend hoặc Admin Web. Có đối chiếu SHA-256 trước/sau.

## Kiểm thử

| Kiểm tra              | Kết quả                                                    |
| --------------------- | ---------------------------------------------------------- |
| TypeScript strict     | Đạt                                                        |
| ESLint                | Không lỗi/cảnh báo                                         |
| Prettier              | Đạt                                                        |
| Jest/RNTL             | **89/89**, 7 suite                                         |
| Expo dependency check | Dependencies are up to date                                |
| Expo Doctor           | **21/21**                                                  |
| Android Hermes export | Thành công; không phải APK                                 |
| Web export            | Thành công                                                 |
| Chromium web preview  | 8 nhóm kiểm tra đạt, 0 page error, 0 request ngoài dự kiến |

Jest bao gồm các test Authentication cũ và các luồng Home, loại truyện, loading/empty/lỗi,
retry/refresh, genre/type/status/sort, tải thêm/reset trang, tìm kiếm tiếng Việt/debounce,
response chậm, detail/chapter count/first chapter, Guest Reader, UUID sai, 404, DRAFT,
response sai cấu trúc, mạng/timeout, signal hủy và fallback ảnh lỗi.

Chromium dùng bản web export ở 393×852, kiểm tra thêm độ rộng 320/600px không tràn ngang:
Home, tìm kiếm tiếng Việt, chi tiết, Guest Reader với hai UUID, bộ lọc kết hợp, tìm kiếm
rỗng, responsive và chỉ request GET mock. Ảnh QA trong `test-results/step152-*.png` đã
ignore; nội dung ảnh là fixture của test, không phải truyện trong Database.

Lần export QA dùng biến API URL tạm thời trỏ `http://127.0.0.1:4199/api` để Chromium
chặn toàn bộ bằng mock. Không ghi URL này vào `.env` hoặc code ứng dụng. Đổi API URL cần
khởi động lại Metro với `--clear`; cache cũ có thể giữ cấu hình trước đó.

Không gọi Backend thật trong test tự động, không sửa dữ liệu/schema/migration và không
gọi Cloudinary. Không dùng tài khoản hoặc token thật.

## Chạy lại

Dùng Node 24 LTS, tại thư mục `mobile`:

```powershell
npm run typecheck
npm run lint
npm run format:check
npm test
npx expo-doctor@1.21.5
npm run export:android
npm run export:web
```

Trên Android Emulator có sẵn, tự tạo `.env` từ `.env.example` nếu chưa có, đặt
`EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4000/api`, rồi `npx expo start --clear`.
Điện thoại thật dùng IPv4 LAN Windows thay 10.0.2.2 và cùng Wi-Fi. Backend cổng 4000
phải truy cập được từ thiết bị. Xem README để xử lý mạng và phiên bản Expo Go.
Không đặt credentials hoặc DATABASE_URL vào EXPO_PUBLIC variables.

## Giới hạn

- Chưa có thiết bị/emulator kết nối để kiểm tra native Android thực tế; export và web
  preview không thay thế thử trên thiết bị.
- Danh sách tải thêm theo thao tác, render trong ScrollView dùng chung. Với thư viện rất
  lớn nên chuyển sang danh sách ảo hóa ở bước tối ưu, vẫn giữ query và API hiện tại.
- Chưa có nội dung Reader, form Auth, favorites/history/progress UI hoặc tìm kiếm mô tả.
- Các cảnh báo dependencies SDK 57 đã ghi ở README từ Bước 15.1 còn cần xử lý riêng;
  bước này không cài thêm package hoặc nâng SDK tùy tiện.

Dừng sau Bước 15.2.
