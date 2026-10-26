# Bước 15.3 — NOVEL và COMIC Reader

**Cập nhật Bước 15.4:** Auth forms, Library và History đã hoàn thành; xem
[AUTH-LIBRARY.md](AUTH-LIBRARY.md). Các giới hạn chưa có những màn hình này bên dưới là
trạng thái lịch sử của bước được ghi nhận.

Reader thay placeholder tại `/reader/[id]?storyId=<UUID>`. `id` là chapterId, cả hai UUID
bắt buộc hợp lệ. Chỉ dùng API công khai để đọc chương; không thêm API ADMIN, schema,
migration, Axios instance hoặc hệ thống Authentication khác. Không cài thêm package.

## Hợp đồng đã đối chiếu

| API                                     | Hợp đồng thực tế                                                                                                                      |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/chapters/:id`                 | `data`: id/storyId/chapterNumber/title/type/createdAt/updatedAt và `content` cho NOVEL hoặc `pages:[{pageNumber,imageUrl}]` cho COMIC |
| `GET /api/stories/:storyId/chapters`    | Metadata chương PUBLISHED, page/limit, pagination, chapterNumber tăng dần                                                             |
| `GET /api/me/reading-progress/:storyId` | `data`, `version`, `resume`; không có tiến độ trả HTTP 200, data/version null                                                         |
| `PUT /api/me/reading-progress/:storyId` | chapterId, progressPercent, textOffset/pageNumber/scrollOffset, **expectedUpdatedAt bắt buộc** (null khi đã xác minh chưa có bản ghi) |
| `POST /api/me/reading-history`          | `{storyId,chapterId}`; HTTP 201/200 và recorded true/false; gộp trong 30 giây                                                         |

Backend tự kiểm tra Story và Chapter PUBLISHED, chương thuộc đúng truyện và dữ liệu xuất
bản hợp lệ. Reader kiểm tra lại storyId/id, discriminated type, pages/URL/offset và từ chối
response có DRAFT rõ ràng. Public chapter response không chứa publishStatus hoặc
storagePublicId. Không giả định có kích thước ảnh, chapter liên tiếp hay nextChapterId.

ProgressPercent từ Prisma Decimal có thể là chuỗi JSON; parser chuyển sang number an toàn.
Nếu chương đã ẩn, GET progress có thể trả `data:null` nhưng **version vẫn khác null**.
Version này được giữ nguyên để không tạo ghi đè sai. Reading conflict thực tế là
**PROGRESS_VERSION_CONFLICT / HTTP 409**; CHAPTER_STALE thuộc API chỉnh sửa ADMIN, không
phải API lưu vị trí. Reader không sửa chương.

## Nội dung và điều hướng

- **NOVEL** dùng native Text/ScrollView, giữ tiếng Việt và xuống dòng, không render HTML.
  Cỡ chữ 14–30, khoảng cách dòng 1.5/1.8/2.1. Memo hóa nội dung, lưu tọa độ bằng ref,
  không cập nhật React state ở mỗi scroll. Acknowledgement của tiến độ không render lại
  toàn bộ văn bản hoặc tự di chuyển người đang đọc.
- **COMIC** dùng FlatList, chỉ render/tải một cửa sổ nhỏ, đo ảnh bằng Image.getSize rồi
  hiển thị đúng tỷ lệ với contain, có loading/lỗi/retry. Sau khi biết kích thước, giữ
  chiều cao khung khi ảnh báo lỗi. Không gán tỷ lệ ảnh giả từ API không có metadata.
- Ba nền sáng/sepia/tối, ẩn/hiện thanh công cụ, Safe Area, vùng bấm tối thiểu 48px,
  Modal danh sách/tùy chỉnh và Android Back qua Expo Router/onRequestClose.
- Chương trước/sau dùng danh sách PUBLISHED thật theo chapterNumber, không cộng/trừ 1.
  Danh sách phân trang 20 chương. Nếu chương đang đọc nằm sâu hoặc cuối trang, tải tiếp
  metadata tuần tự cho tới khi tìm được chương hiện tại và chương kế tiếp, hoặc hết trang.
  Modal dùng FlatList, đánh dấu đang đọc và cho phép tải các trang còn lại/chọn chương.
- Khi API chương lỗi/404, hiển thị lỗi an toàn và retry, không hiển thị nội dung ADMIN.

## Mốc vị trí và khôi phục

### NOVEL

`textOffset` là chỉ số **UTF-16** giống `content.length` trong Backend. Văn bản được chia
thành các khối tối đa khoảng 800 code units, ưu tiên xuống dòng/khoảng trắng và không cắt
đôi surrogate pair của emoji. Tổng các khối giữ nguyên nội dung gốc.

Native onLayout đo tọa độ đầu mỗi khối. Khi cuộn, Reader chuyển tọa độ sang **chỉ số ký
tự đầu khối**, không lưu scrollY vào textOffset. Phần trăm là offset/content.length,
làm tròn hai chữ số; tại cuối chương là 100. Khôi phục chọn khối chứa offset, chờ đo
layout rồi cuộn tới đầu khối. Đổi cỡ chữ/khoảng cách dòng/chiều rộng giữ mốc văn bản và
đo lại tọa độ. Không tự lưu do thao tác khôi phục hoặc thay đổi bố cục.

**Giới hạn có chủ đích:** khôi phục theo mốc khối, không chính xác từng ký tự đang nằm
ở mép viewport hoặc từng pixel; có thể lùi lại trong khối tối đa khoảng 800 code units.
Đây là fallback ổn định theo văn bản, không tuyên bố đo được vị trí từng ký tự. Không
đổi API/schema để giả tạo độ chính xác mà native layout chưa cung cấp.

### COMIC

Lưu pageNumber thật từ viewability của FlatList, textOffset=null và scrollOffset=0.
Phần trăm dựa vào thứ tự trang trong mảng đã sắp xếp, không lấy pageNumber chia số trang
vì pageNumber có thể không liên tiếp. Chỉ đánh dấu 100 ở cuối trang cuối đã tải được ảnh.

Backend chưa định nghĩa viewport/đơn vị pixel chuẩn cho scrollOffset. Reader khôi phục
**đầu trang ảnh**, không cố áp dụng pixel của thiết bị khác. Cửa sổ danh sách bắt đầu ở
trang đã lưu, những trang trước có nút tải thêm theo nhóm 10, vẫn giữ toàn bộ trang có
thể truy cập. Không đoán chiều cao các trang chưa tải để scrollToIndex. Dùng
maintainVisibleContentPosition để giảm dịch chuyển khi bổ sung trang/đo ảnh.

Kích thước chưa biết ban đầu dùng ô loading trung tính, không coi chiều cao ô này là
tỷ lệ ảnh. Ảnh thật chỉ xuất hiện sau khi đo. Vẫn cần thử Android thật để đánh giá dịch
chuyển bố cục trên chương ảnh dài và mạng chậm.

### Lựa chọn chương

Chỉ khôi phục nếu saved.chapterId trùng chương được yêu cầu. Nếu người dùng chọn chương
khác thì giữ đúng lựa chọn, không tự chuyển sang chương đã lưu. Offset bị thu ngắn được
clamp; pageNumber không còn tồn tại về trang đầu. Khi chương mới chưa có vị trí cùng
chương, xếp lưu mốc đầu chương, kể cả khi chương ngắn không cần cuộn. Mở lại chương đã
lưu không tự ghi đè offset thành đầu khối.

Guest không gọi `/api/me`, không ghi tiến độ/history. Chưa thêm lưu vị trí Guest qua
storage. Form Login/Register vẫn ngoài phạm vi; đồng bộ hoạt động với phiên ACTIVE đã
được Auth Foundation xác thực, kiểm thử bằng session mock.

## Đồng bộ và xung đột

- Dùng AuthStore và session generation hiện có; giới hạn dữ liệu theo user/story.
  Không gửi tiếp dữ liệu của tài khoản cũ sau logout/đổi người dùng.
- GET tiến độ trước khi cho phép PUT. Nếu GET lỗi thì dừng ghi, vẫn cho đọc; không tự
  giả định expectedUpdatedAt=null.
- Debounce 1.5 giây, khoảng cách ghi khi cuộn tối thiểu 5 giây, bỏ vị trí trùng.
  Một hàng đợi giữ vị trí mới nhất, chỉ một PUT đang chạy. Lần sau dùng version đã được
  xác nhận. Flush best effort khi chuyển chương, rời màn hình hoặc AppState về nền;
  flush có thể sớm hơn khoảng cách 5 giây. Không bảo đảm lưu khi hệ điều hành kill app.
- Rời màn hình khi đang ghi: chờ lần ghi đó, sau đó mới lưu vị trí mới nhất còn chờ.
  Khi phiên không còn hợp lệ, bỏ các lần ghi tiếp theo.
- HTTP 409: bỏ vị trí chờ, tải lại tiến độ đúng một lần, hiện cảnh báo và ngừng tự lưu
  trong phiên Reader đó. Không tự nhảy trang, không ghi đè từ thiết bị khác, không retry
  mutation vô hạn. Kiểm tra tiến độ rồi rời/mở lại Reader để bắt đầu phiên đồng bộ mới.
- Kết quả PUT không rõ ràng/lỗi mạng: tạm dừng ghi, không tự gửi lại mutation.
- History chỉ ghi khi mở chương thành công, không theo scroll; chặn lặp tại client trong
  30 giây và tận dụng gộp 30 giây của Backend. Lỗi history không chặn đọc.

## File

Tạo mới:

- `src/features/reader/api.ts`, `positions.ts`, `sync.ts`, `use-reading-sync.ts`.
- `src/features/reader/ReaderScreen.tsx`, `NovelContent.tsx`, `ComicContent.tsx`, `theme.ts`.
- `tests/reader-fixtures.ts`, `reader-api.test.ts`, `reader-sync.test.ts`, `reader-ui.test.tsx`.
- `READER.md`.

Chỉnh sửa:

- `src/app/reader/[id].tsx`: trỏ sang Reader thực tế.
- `tests/navigation.test.tsx`, `tests/catalog-ui.test.tsx`: Guest Reader và route cũ.
- `README.md`, `STORIES.md`: cập nhật trạng thái và liên kết tài liệu.

Không thay đổi Backend/Admin Web, Auth Foundation, package/lockfile, schema/migration.
Đối chiếu 228 file được bảo vệ bằng SHA-256 trước/sau. Không chạy câu lệnh Database,
không tạo fixture thật hoặc gọi Cloudinary thật.

## Kiểm tra và chạy

```powershell
cd C:\Users\Admin\Desktop\QLDAPM\qldapm\mobile
npm run typecheck
npm run lint
npm run format:check
npm test
npx expo-doctor@1.21.5
npm run export:android
npm run export:web
```

Kết quả: TypeScript/lint/format đạt; **135/135 test, 10 suite**; Expo Doctor **21/21**;
Android Hermes và web export thành công. Chromium kiểm tra 8 nhóm luồng Guest bằng API
và ảnh PNG tự tạo được mock hoàn toàn; không có private request hoặc lỗi JavaScript.
Ảnh QA nằm tại `test-results/step153-*.png` (ignore).

Kiểm thử bao gồm newline/theme/font, kích thước/thứ tự ảnh, pagination/chuyển chương có
khoảng trống, Guest/private API, progress NOVEL/COMIC, debounce, phiên bản và 409, ghi nối
tiếp/đổi chương/rời màn hình/logout, khôi phục mốc văn bản khi đổi font, ảnh lỗi và 404.
Toàn bộ test dùng mock, không kết nối Database hay Cloudinary thật.

Dùng Node 24 LTS và cấu hình `.env` theo README. Emulator:
`EXPO_PUBLIC_API_BASE_URL=http://10.0.2.2:4000/api`; điện thoại thật dùng IPv4 LAN Windows.
Chạy `npx expo start --clear`, mở truyện PUBLISHED, chọn chương hoặc Bắt đầu đọc. Không
cần đăng nhập cho Guest. API URL QA tạm thời của bản export không ghi vào `.env`; cần tự
cấu hình API riêng khi chạy thật. Không đặt secret vào EXPO_PUBLIC variables.

Chưa có thiết bị/emulator kết nối nên chưa xác nhận hiệu năng, TalkBack, ảnh dài hoặc
AppState/Android Back trên native thực tế. Web preview và bundle không thay thế kiểm tra
thiết bị. Cảnh báo dependencies SDK 57 cũ vẫn được ghi ở README; không nâng SDK ở bước này.
Không có chức năng Library/Favorites/Ratings/Comments mới. Dừng sau Bước 15.3.
