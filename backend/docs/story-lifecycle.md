# Admin — Ẩn và xóa truyện

## Sử dụng

Admin Web → **Stories**. Truyện PUBLISHED có nút **Ẩn**; cả DRAFT/PUBLISHED đều có **Xóa** ở danh sách và trang chi tiết.

- Ẩn: xem tên truyện trong hộp thoại, nhấn **Xác nhận ẩn truyện**. Story chuyển DRAFT; chương và dữ liệu người đọc được giữ nguyên. API công khai không trả truyện/chương khi Story không PUBLISHED. DRAFT dùng chung cho bản nháp mới và truyện đã ẩn, không thêm trạng thái/schema.
- Xuất bản lại: mở chi tiết → **Xuất bản → Xác nhận xuất bản**. Backend vẫn kiểm tra metadata/thể loại/bìa như trước. Trạng thái chương không bị thay đổi, nên các chương đã PUBLISHED hiển thị lại khi truyện công khai.
- Xóa: xem cảnh báo không thể hoàn tác, tên/số chương và phạm vi dữ liệu → **Xác nhận xóa vĩnh viễn**. Quay lại/Escape không gửi DELETE. Sau khi thành công danh sách được cập nhật; trang chi tiết quay về danh sách.

Nếu dữ liệu đã thay đổi từ lúc xem, phải tải lại rồi xác nhận mới. Nếu mất kết nối/chưa rõ kết quả xóa, kiểm tra danh sách trước; không gửi lại ngay. Client không tự retry thao tác ghi.

## API

Tất cả endpoint ghi dưới đây yêu cầu authenticate + ADMIN ACTIVE, được kiểm tra lại trong transaction; Guest 401, USER 403, BANNED 401.

| Method | API | Body |
| --- | --- | --- |
| PATCH | /api/admin/stories/:id/unpublish | `{}` |
| PATCH | /api/stories/:id/publish | `{}` (API hiện có) |
| DELETE | /api/admin/stories/:id | `{ "confirm": true, "expectedUpdatedAt": "<ISO timestamp đã đọc>" }` |

Unpublish trả Story DRAFT và lặp lại an toàn. DELETE trả `{ success: true, message: "Story permanently deleted; storage images retained", data: { deleted: true } }`. UUID/body/confirmation sai: 400; không tồn tại: 404; snapshot cũ: 409 STORY_STALE; FK thay đổi trong lúc xử lý: 409 STORY_DELETE_CONFLICT; serialization hết lượt retry: 409 STORY_WRITE_CONFLICT. Lỗi không lộ SQL/stack/credentials. Hai API mới giới hạn 30 request/IP/15 phút qua middleware Auth hiện có.

## Xóa dữ liệu liên quan

Giữ nguyên schema/FK Restrict. Service khóa Story FOR UPDATE trong transaction Serializable, kiểm tra expectedUpdatedAt rồi adapter thực hiện:

1. Gỡ parentId của phản hồi thuộc chính Story để xử lý self-FK an toàn; xóa mọi bình luận/phản hồi (gồm HIDDEN) của Story.
2. Xóa Rating, Favorite, Bookmark, ReadingHistory, ReadingProgress với đúng storyId.
3. Xóa ChapterPage qua chapter.storyId, sau đó Chapter với storyId đó.
4. Xóa liên kết StoryGenre, cuối cùng Story.

Không xóa Genre, User/AuthSession hoặc dữ liệu của Story khác. Không gọi Cloudinary delete/destroy, không xóa file bìa EPUB, nguồn import hoặc receipt. Toàn bộ thao tác Database cùng transaction; lỗi ở bất kỳ bước nào rollback, không xóa một phần. Không có công cụ tự chạy xóa hoặc cleanup truyện thật.

Khóa cha tương thích với các writer Chapters/Reading/Feedback hiện có; FK và Serializable bảo vệ ghi cạnh tranh. Retry chỉ áp dụng xung đột transaction đã rollback, không retry lỗi mạng/kết quả commit không rõ. Hệ thống không thu hồi nội dung mà thiết bị đã tải/cache hoặc ảnh có URL public trên dịch vụ ngoài.

## Thay đổi và kiểm thử

Backend: types/story.types.ts, story.store.ts (factory injectable + cleanup), story.service.ts, story.controller.ts, story.validation.ts, story.routes.ts và package scripts. Test: stories.test.ts, helpers/memory-story.store.ts, story-lifecycle.store.test.ts.

Admin Web: StoryLifecycleActions.tsx dùng chung danh sách/chi tiết; stories api/queries, StoriesPage, StoryDetailPage; ConfirmDialog hỗ trợ nút nguy hiểm; CSS dialog căn giữa/xuống dòng cảnh báo; thông báo lỗi tiếng Việt. Cache truyện/chương bị xóa được dọn theo storyId, danh sách/bình luận được làm mới; phản hồi phiên cũ không ghi cache mới.

- Backend Stories/lifecycle: **31/31**, gồm quyền truy cập, xác nhận, stale, hide/re-publish, xóa DRAFT/PUBLISHED, cleanup từng delegate đúng phạm vi, rollback và giữ dữ liệu dùng chung.
- Backend đầy đủ: **281/284**; 3 test cũ yêu cầu DB rỗng tiếp tục thất bại vì Database đã có truyện, không xóa dữ liệu để ép test đạt.
- Admin Web: **153/153**; typecheck/build/lint/format đạt. Build còn cảnh báo bundle >500 kB có sẵn.
- Chromium: **13/13** với frontend riêng 5185 và toàn bộ API mock, gồm hủy xác nhận, ẩn → xuất bản lại → xóa. Có kiểm tra cảnh báo không bị tràn/cắt và modal nằm giữa màn hình.
- Không chạy thao tác ẩn/xóa trên PostgreSQL thật, kể cả DB test, theo yêu cầu. Kiểm thử cleanup transaction là mock; chưa xác minh DELETE thật với PostgreSQL. Không sửa schema/migration/dữ liệu truyện hoặc Cloudinary.

Chạy lại Backend: `npm run test:story-lifecycle`, `npm run typecheck`, `npm run build`. Frontend: `npm test`, `npm run typecheck`, `npm run lint`, `npm run format:check`, `npm run build`, `npm run test:e2e:mock`. Cổng 5185 phải trống; Playwright tự khởi động/dừng Vite riêng, không dùng lại 5173 hoặc Backend thật. Các fixture chặn request API không được mock và mô phỏng CORS theo origin hiện tại.
