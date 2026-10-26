import { useEffect, useRef, useState } from 'react';
import { ImagePlus, Upload } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Alert } from '../../components/Alert';
import { safeError } from '../../lib/api/errors';
import { useAuth } from '../auth/auth-context';
import { storiesApi } from './api';
import { Cover } from './components';
import { coverFileError, type CoverUpload } from './model';
export function CoverField({
  value,
  disabled,
  onUploaded,
  onPending,
}: {
  value: string;
  disabled: boolean;
  onUploaded: (result: CoverUpload) => void;
  onPending: (pending: boolean) => void;
}) {
  const { session } = useAuth();
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const inFlight = useRef(false);
  useEffect(() => {
    if (preview) return () => URL.revokeObjectURL(preview);
  }, [preview]);
  async function upload() {
    if (!file || inFlight.current) return;
    const epoch = session.generation();
    inFlight.current = true;
    setBusy(true);
    setError('');
    try {
      const result = await storiesApi.upload(file);
      if (session.generation() !== epoch) return;
      if (!result.secureUrl.startsWith('https://') || !result.publicId)
        throw new Error('Invalid upload response');
      onUploaded(result);
      setFile(null);
      setPreview('');
      onPending(false);
      if (input.current) input.current.value = '';
    } catch (err) {
      const failure = safeError(err);
      setError(
        `${failure.message}${[0, 500, 502, 504].includes(failure.status) ? ' Kết quả tải có thể chưa rõ ràng; hãy kiểm tra Cloudinary trước khi chủ động tải lại. Hệ thống không tự gửi lại.' : ''}`,
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
      setConfirm(false);
    }
  }
  return (
    <div className="stories-cover-field">
      <div className="stories-cover-preview">
        {preview ? (
          <img src={preview} alt="Xem trước ảnh bìa đã chọn, chưa tải lên" />
        ) : (
          <Cover url={value} title="truyện" large />
        )}
      </div>
      <div>
        <h3>Ảnh bìa truyện</h3>
        <p>JPEG, PNG hoặc WebP · tối đa 5 MiB. Máy chủ kiểm tra nội dung ảnh thực tế.</p>
        <label
          className={`stories-button secondary stories-file-label ${disabled || busy ? 'disabled' : ''}`}
        >
          <ImagePlus size={17} /> Chọn ảnh từ máy
          <input
            ref={input}
            type="file"
            aria-label="Chọn ảnh bìa"
            accept="image/jpeg,image/png,image/webp"
            disabled={disabled || busy}
            onChange={(event) => {
              const files = event.currentTarget.files;
              const selected = files?.[0];
              setError('');
              if (!selected) return;
              const message =
                (files?.length ?? 0) > 1 ? 'Chỉ chọn một ảnh bìa.' : coverFileError(selected);
              if (message) {
                setError(message);
                event.currentTarget.value = '';
                return;
              }
              setFile(selected);
              setPreview(URL.createObjectURL(selected));
              onPending(true);
            }}
          />
        </label>
        {file && (
          <div className="stories-file-selection">
            <p>
              <strong>{file.name}</strong> · {(file.size / 1024).toFixed(1)} KiB · Chưa tải lên
            </p>
            <div className="stories-actions">
              <button
                type="button"
                className="stories-button"
                disabled={disabled || busy}
                onClick={() => setConfirm(true)}
              >
                <Upload size={16} /> {busy ? 'Đang tải ảnh…' : 'Xác nhận tải ảnh lên'}
              </button>
              <button
                type="button"
                className="stories-button secondary"
                disabled={busy}
                onClick={() => {
                  setFile(null);
                  setPreview('');
                  onPending(false);
                  setError('');
                  if (input.current) input.current.value = '';
                }}
              >
                Bỏ ảnh đã chọn
              </button>
            </div>
          </div>
        )}
        {error && <Alert>{error}</Alert>}
        {busy && <p role="status">Đang tải lên Cloudinary. Vui lòng giữ trang mở.</p>}
      </div>
      {confirm && (
        <ConfirmDialog
          title="Tải ảnh lên Cloudinary?"
          confirmLabel="Tải lên Cloudinary"
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void upload()}
        >
          <p>
            Ảnh sẽ được tải thật lên dịch vụ lưu trữ. Thao tác này chưa lưu hoặc đổi ảnh bìa trong
            Database.
          </p>
          <p>
            Nếu hủy form sau khi tải, ảnh có thể vẫn còn trên Cloudinary; hệ thống không tự xóa.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
