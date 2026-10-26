import { useRef, useState } from 'react';
import { EyeOff, Trash2 } from 'lucide-react';
import { useAuth } from '../auth/auth-context';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Alert } from '../../components/Alert';
import { useToast } from '../../components/toast-context';
import { safeError } from '../../lib/api/errors';
import { useStoryLifecycle } from './queries';
import type { Story } from './model';

export function StoryLifecycleActions({
  story,
  compact = false,
  onDeleted,
}: {
  story: Story;
  compact?: boolean;
  onDeleted?: () => void;
}) {
  const [action, setAction] = useState<{ kind: 'hide' | 'delete'; story: Story } | null>(null);
  const [error, setError] = useState('');
  const flight = useRef(false),
    mutation = useStoryLifecycle(),
    toast = useToast();
  const { session } = useAuth();
  async function confirm() {
    if (!action || flight.current) return;
    flight.current = true;
    setError('');
    const epoch = session.generation();
    try {
      await mutation.mutateAsync(action);
      if (session.generation() !== epoch) return;
      setAction(null);
      toast(
        action.kind === 'hide'
          ? 'Đã ẩn truyện. Có thể xuất bản lại từ trang chi tiết.'
          : 'Đã xóa truyện và dữ liệu liên quan. Ảnh lưu trữ được giữ nguyên.',
      );
      if (action.kind === 'delete') onDeleted?.();
    } catch (failure) {
      if (session.generation() !== epoch) return;
      const safe = safeError(failure);
      setError(
        action.kind === 'delete' && (safe.status === 0 || safe.status >= 500)
          ? 'Chưa xác nhận kết quả xóa. Hãy tải lại danh sách trước khi thao tác tiếp; không gửi lại ngay.'
          : safe.message,
      );
      setAction(null);
    } finally {
      flight.current = false;
    }
  }
  return (
    <div className="story-lifecycle">
      {story.publishStatus === 'PUBLISHED' && (
        <button
          type="button"
          className="stories-button secondary"
          aria-label={`Ẩn truyện ${story.title}`}
          disabled={mutation.isPending}
          onClick={() => {
            setError('');
            setAction({ kind: 'hide', story });
          }}
        >
          <EyeOff size={16} /> {compact ? 'Ẩn' : 'Ẩn truyện'}
        </button>
      )}
      <button
        type="button"
        className="stories-button danger"
        aria-label={`Xóa truyện ${story.title}`}
        disabled={mutation.isPending}
        onClick={() => {
          setError('');
          setAction({ kind: 'delete', story });
        }}
      >
        <Trash2 size={16} /> {compact ? 'Xóa' : 'Xóa truyện'}
      </button>
      {error && <Alert>{error}</Alert>}
      {action && (
        <ConfirmDialog
          title={action.kind === 'delete' ? 'Xóa vĩnh viễn truyện?' : 'Ẩn / ngừng xuất bản truyện?'}
          confirmLabel={action.kind === 'delete' ? 'Xác nhận xóa vĩnh viễn' : 'Xác nhận ẩn truyện'}
          danger={action.kind === 'delete'}
          busy={mutation.isPending}
          onCancel={() => {
            if (!flight.current) setAction(null);
          }}
          onConfirm={() => {
            void confirm();
          }}
        >
          <p>
            Truyện: <strong>{action.story.title}</strong> · {action.story.chapterCount} chương.
          </p>
          {action.kind === 'delete' ? (
            <>
              <Alert>
                Thao tác không thể hoàn tác. Xóa truyện, toàn bộ chương/trang ảnh trong Database,
                liên kết thể loại, bình luận/phản hồi, đánh giá, yêu thích, bookmark và lịch sử/tiến
                độ đọc của truyện này.
              </Alert>
              <p>Không xóa thể loại, tài khoản, truyện khác hoặc ảnh trên Cloudinary.</p>
            </>
          ) : (
            <p>
              Truyện và các chương sẽ không còn được đọc công khai. Nội dung và dữ liệu đọc được giữ
              nguyên. Có thể xuất bản lại từ trang chi tiết.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
