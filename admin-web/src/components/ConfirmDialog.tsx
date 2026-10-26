import { useEffect, useId, useRef, type ReactNode } from 'react';

export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  busy = false,
  confirmDisabled = false,
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  busy?: boolean;
  confirmDisabled?: boolean;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="stories-dialog"
      aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== 'Tab') return;
        const items = ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])');
        const first = items?.[0];
        const last = items?.[items.length - 1];
        if (!first || !last) {
          event.preventDefault();
          return;
        }
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      <div className="stories-dialog-body">{children}</div>
      <div className="stories-actions">
        <button
          type="button"
          className="stories-button secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Quay lại
        </button>
        <button
          type="button"
          className={`stories-button${danger ? ' danger' : ''}`}
          disabled={busy || confirmDisabled}
          onClick={onConfirm}
        >
          {busy ? 'Đang xử lý…' : confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
