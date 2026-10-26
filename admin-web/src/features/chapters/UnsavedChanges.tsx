import { useRef } from 'react';
import { useBeforeUnload, useBlocker } from 'react-router';
import { useAuth } from '../auth/auth-context';
import { ConfirmDialog } from '../../components/ConfirmDialog';

export function useUnsavedChanges(dirty: boolean, busy = false, uploaded = false) {
  const allow = useRef(false);
  const { view } = useAuth();
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      !allow.current &&
      view.status === 'authenticated' &&
      (dirty || busy) &&
      (currentLocation.pathname !== nextLocation.pathname ||
        currentLocation.search !== nextLocation.search),
  );
  useBeforeUnload((event) => {
    if (!allow.current && (dirty || busy)) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  return {
    permit: () => {
      allow.current = true;
    },
    dialog:
      blocker.state === 'blocked' ? (
        <ConfirmDialog
          title="Rời trang chương?"
          confirmLabel="Bỏ thay đổi và rời trang"
          busy={busy}
          onCancel={() => blocker.reset()}
          onConfirm={() => blocker.proceed()}
        >
          <p>Những thay đổi chưa lưu sẽ bị bỏ.</p>
          {uploaded && (
            <p>
              Ảnh đã tải nhưng chưa lưu có thể vẫn còn trên Cloudinary. Hệ thống không tự xóa ảnh.
            </p>
          )}
          {busy && <p>Đang xử lý yêu cầu; hãy chờ kết quả trước khi rời trang.</p>}
        </ConfirmDialog>
      ) : null,
  };
}
