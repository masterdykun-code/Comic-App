import { isAxiosError } from 'axios';
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function safeError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  const status = isAxiosError(error) ? (error.response?.status ?? 0) : 500;
  if (isAxiosError(error) && ['ECONNABORTED', 'ETIMEDOUT'].includes(error.code ?? ''))
    return new ApiError(0, 'Kết nối quá thời gian chờ. Vui lòng thử lại.', 'TIMEOUT');
  const coinMessages: Record<string, string> = {
    CHAPTER_LOCKED: 'Chương VIP cần mở khóa bằng Coin.',
    INSUFFICIENT_COINS: 'Bạn chưa đủ Coin để mở khóa chương.',
    MISSION_NOT_READY: 'Bạn chưa hoàn thành nhiệm vụ này.',
    COIN_BUSY: 'Ví đang được xử lý. Hãy kiểm tra lại số dư.',
    VIP_PRICE_CHANGED: 'Giá chương đã thay đổi. Hãy kiểm tra giá mới trước khi xác nhận.',
  };
  const code: unknown = isAxiosError(error) ? error.response?.data?.error?.code : undefined;
  if (typeof code === 'string' && Object.hasOwn(coinMessages, code))
    return new ApiError(status, coinMessages[code]!, code);
  const messages: Record<number, string> = {
    0: 'Không thể kết nối máy chủ. Hãy kiểm tra mạng và địa chỉ API.',
    400: 'Thông tin chưa hợp lệ.',
    401: 'Phiên đã hết hạn hoặc thông tin đăng nhập chưa đúng.',
    403: 'Bạn không có quyền thực hiện thao tác này.',
    404: 'Không tìm thấy nội dung.',
    409: 'Dữ liệu đã tồn tại hoặc có xung đột.',
    429: 'Bạn thao tác quá nhanh. Vui lòng đợi một lúc.',
  };
  // Never retain Axios config, request bodies, raw server messages or causes.
  return new ApiError(
    status,
    messages[status] ?? 'Máy chủ chưa xử lý được yêu cầu. Vui lòng thử lại.',
  );
}
