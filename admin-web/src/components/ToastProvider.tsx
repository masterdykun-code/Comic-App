import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { CheckCircle, X } from 'lucide-react';
import { ToastContext } from './toast-context';
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string } | null>(null);
  const notify = useCallback((message: string) => setToast({ message }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext value={notify}>
      {children}
      <div className="stories-toast-region" aria-live="polite">
        {toast && (
          <div className="stories-toast" role="status">
            <CheckCircle size={20} />
            <span>{toast.message}</span>
            <button aria-label="Đóng thông báo" onClick={() => setToast(null)}>
              <X size={17} />
            </button>
          </div>
        )}
      </div>
    </ToastContext>
  );
}
