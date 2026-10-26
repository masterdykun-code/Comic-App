import axios from 'axios';

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(status: number, message: string, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}
export function safeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const status = axios.isAxiosError(error) ? (error.response?.status ?? 0) : 500;
  const rawCode: unknown = axios.isAxiosError(error)
    ? error.response?.data?.error?.code
    : undefined;
  const known: Record<string, string> = {
    USER_NOT_FOUND: 'Không tìm thấy tài khoản USER.',
    USER_STALE: 'Tài khoản đã thay đổi. Hãy làm mới và kiểm tra trước khi xác nhận.',
    USER_WRITE_CONFLICT: 'Có cập nhật đồng thời. Hãy làm mới tài khoản trước khi thử tiếp.',
    SELF_BAN_FORBIDDEN: 'Không thể tự khóa tài khoản của mình.',
    ADMIN_ACCOUNT_PROTECTED: 'Chỉ quản lý tài khoản USER; không được khóa ADMIN.',
    STORY_STALE: 'Truyện đã thay đổi. Hãy tải lại dữ liệu và kiểm tra trước khi xác nhận xóa.',
    STORY_DELETE_CONFLICT:
      'Dữ liệu liên quan vừa thay đổi. Không xóa một phần; hãy tải lại truyện trước khi thử tiếp.',
    EPUB_COVER_CONFLICT:
      'Đã có bìa cục bộ khác. Bỏ chọn bìa rồi kiểm tra kết quả trước khi nhập lại; không ghi đè ảnh.',
    EPUB_INVALID:
      'EPUB lỗi hoặc không hỗ trợ. Kiểm tra file UTF-8, mục lục và nội dung chương; không nhận file có DRM.',
    EPUB_DUPLICATE: 'Truyện hoặc nội dung EPUB đã tồn tại. Không ghi đè truyện và chương cũ.',
    EPUB_PREVIEW_EXPIRED:
      'Bản xem trước đã hết hạn hoặc Backend vừa khởi động lại. Hãy kiểm tra danh sách rồi chọn lại EPUB.',
    EPUB_PREVIEW_LIMIT: 'Đã có nhiều bản xem trước. Hãy hủy bản cũ hoặc đợi hết hạn.',
    EPUB_IMPORT_BUSY: 'Có lượt nhập đang xử lý. Không gửi lại yêu cầu; kiểm tra kết quả sau.',
    EPUB_OUTCOME_UNKNOWN:
      'Chưa rõ kết quả nhập. Hãy kiểm tra danh sách truyện trước khi chọn lại file.',
    GENRE_NOT_FOUND: 'Không tìm thấy thể loại. Hãy tải lại danh sách.',
    GENRE_CONFLICT: 'Tên hoặc slug thể loại đã tồn tại. Hãy chọn giá trị khác.',
    GENRE_IN_USE:
      'Thể loại đang được truyện sử dụng nên không thể xóa. Các liên kết và truyện được giữ nguyên.',
    GENRE_WRITE_CONFLICT:
      'Có thay đổi thể loại đồng thời. Hãy tải lại danh sách trước khi thử tiếp.',
    COMMENT_NOT_FOUND: 'Bình luận không còn tồn tại. Hãy làm mới danh sách.',
    FEEDBACK_CONFLICT: 'Bình luận đã thay đổi đồng thời. Hãy làm mới danh sách trước khi thử tiếp.',
    CHAPTER_STALE: 'Chương đã được thay đổi. Hãy tải lại dữ liệu trước khi lưu hoặc xuất bản.',
    CHAPTER_NOT_FOUND: 'Không tìm thấy chương.',
    CHAPTER_NOT_PUBLISHABLE:
      'NOVEL cần nội dung chữ không trống; COMIC cần ít nhất một trang ảnh đã lưu và không có nội dung chữ.',
    CHAPTER_NUMBER_CONFLICT:
      'Số chương đã tồn tại trong truyện. Hãy tải lại dữ liệu trước khi chọn số khác.',
    CHAPTER_WRITE_CONFLICT: 'Có cập nhật chương đồng thời. Hãy tải lại dữ liệu trước khi lưu tiếp.',
    STORY_NOT_PUBLISHED: 'Hãy xuất bản truyện trước khi xuất bản chương.',
    COMIC_TEXT_FORBIDDEN: 'Chương COMIC không nhận nội dung chữ.',
    NOVEL_PAGES_FORBIDDEN: 'Chỉ chương COMIC mới có danh sách trang ảnh.',
    STORY_NOT_FOUND: 'Không tìm thấy truyện. Truyện có thể không còn tồn tại.',
    STORY_NOT_PUBLISHABLE:
      'Xuất bản cần tên truyện, tác giả, mô tả, URL ảnh bìa hợp lệ và ít nhất một thể loại. Hãy kiểm tra lại thông tin.',
    STORY_TYPE_LOCKED: 'Truyện đã có chương nên không thể đổi loại NOVEL/COMIC.',
    STORY_WRITE_CONFLICT: 'Có thay đổi đồng thời. Hãy tải lại truyện trước khi lưu lại.',
    INVALID_GENRES: 'Một hoặc nhiều thể loại không còn tồn tại. Hãy tải lại danh sách thể loại.',
    INVALID_IMAGE: 'Ảnh không hợp lệ. Chỉ chấp nhận ảnh JPEG, PNG hoặc WebP tĩnh.',
    UPLOAD_TOO_LARGE: 'Ảnh vượt giới hạn 5 MiB.',
    UPLOAD_FAILED:
      'Dịch vụ ảnh chưa xử lý được yêu cầu. Hãy kiểm tra Cloudinary trước khi tải lại.',
    UPLOAD_NOT_CONFIGURED: 'Máy chủ chưa cấu hình dịch vụ ảnh.',
    UPLOAD_BUSY: 'Dịch vụ ảnh đang bận. Vui lòng đợi một lúc.',
  };
  if (typeof rawCode === 'string' && Object.hasOwn(known, rawCode))
    return new ApiError(status, known[rawCode]!, rawCode);
  const messages: Record<number, string> = {
    0: 'Không thể kết nối máy chủ. Kiểm tra kết nối mạng và thử lại.',
    400: 'Thông tin chưa hợp lệ. Vui lòng kiểm tra lại.',
    401: 'Email hoặc mật khẩu không đúng, hoặc phiên đăng nhập đã hết hạn.',
    403: 'Tài khoản không có quyền truy cập trang quản trị.',
    404: 'Không tìm thấy tài nguyên được yêu cầu.',
    409: 'Dữ liệu có xung đột. Hãy tải lại trước khi lưu.',
    413: 'Dữ liệu tải lên vượt giới hạn cho phép.',
    429: 'Bạn thao tác quá nhanh. Vui lòng đợi một lúc rồi thử lại.',
  };
  // Never carry Axios config, request bodies, server messages or causes to UI/logs.
  return new ApiError(
    status,
    messages[status] ?? 'Máy chủ chưa thể xử lý yêu cầu. Vui lòng thử lại sau.',
  );
}
