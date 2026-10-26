import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ImagePlus, Upload, X, GripVertical } from 'lucide-react';
import { useAuth } from '../auth/auth-context';
import { Alert } from '../../components/Alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ApiError, safeError } from '../../lib/api/errors';
import { chaptersApi } from './api';
import { makeBatches, type PageDraft } from './model';
import { reorder, sortComicFiles } from './comic-files';

interface LocalImage {
  key: string;
  file: File;
  preview: string;
}
export function ComicPagesEditor({
  pages,
  disabled,
  onChange,
  onBusy,
  onQueue,
  onUpload,
}: {
  pages: PageDraft[];
  disabled: boolean;
  onChange: (pages: PageDraft[]) => void;
  onBusy: (busy: boolean) => void;
  onQueue: (pending: boolean) => void;
  onUpload: () => void;
}) {
  const { session } = useAuth();
  const [queue, setQueue] = useState<LocalImage[]>([]);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);

  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const flight = useRef(false);
  const urls = useRef(new Set<string>());
  const input = useRef<HTMLInputElement>(null);
  const dragged = useRef<{ area: 'queue' | 'pages'; key: string } | null>(null);
  useEffect(() => {
    const current = urls.current;
    return () => current.forEach((url) => URL.revokeObjectURL(url));
  }, []);
  const batches = makeBatches(queue.map((item) => item.file));
  const batch = batches[0] ?? [];
  function replaceQueue(next: LocalImage[]) {
    setQueue(next);
    onQueue(next.length > 0);
  }
  function release(items: LocalImage[]) {
    items.forEach((item) => {
      URL.revokeObjectURL(item.preview);
      urls.current.delete(item.preview);
    });
  }
  function addFiles(files: File[]) {
    if (pages.length + queue.length + files.length > 200)
      throw new ApiError(400, 'Mỗi chương tối đa 200 trang, gồm ảnh đã lưu, đã tải và đang chờ.');
    makeBatches(files);
    const added = sortComicFiles(files).map((file) => {
      const preview = URL.createObjectURL(file);
      urls.current.add(preview);
      return { key: crypto.randomUUID(), file, preview };
    });
    replaceQueue([...queue, ...added]);
  }

  function drag(area: 'queue' | 'pages', key: string) {
    return {
      draggable: !disabled && !busy && !uncertain,
      onDragStart: (event: React.DragEvent) => {
        dragged.current = { area, key };
        event.dataTransfer.setData('text/plain', key);
        event.dataTransfer.effectAllowed = 'move';
      },
      onDragOver: (event: React.DragEvent) => {
        if (!disabled && !busy && !uncertain && dragged.current?.area === area)
          event.preventDefault();
      },
      onDrop: (event: React.DragEvent) => {
        event.preventDefault();
        const origin = dragged.current;
        dragged.current = null;
        if (disabled || busy || uncertain || origin?.area !== area) return;
        if (area === 'queue')
          replaceQueue(
            reorder(
              queue,
              queue.findIndex((p) => p.key === origin.key),
              queue.findIndex((p) => p.key === key),
            ),
          );
        else
          onChange(
            reorder(
              pages,
              pages.findIndex((p) => p.key === origin.key),
              pages.findIndex((p) => p.key === key),
            ),
          );
      },
      onDragEnd: () => {
        dragged.current = null;
      },
    };
  }
  async function upload() {
    if (!batch.length || flight.current || uncertain || disabled) return;
    const epoch = session.generation();
    flight.current = true;
    setBusy(true);
    onBusy(true);
    setProgress(0);
    setError('');
    try {
      const result = await chaptersApi.upload(batch, setProgress);
      if (session.generation() !== epoch) return;
      onChange([
        ...pages,
        ...result.map((p) => ({
          key: crypto.randomUUID(),
          imageUrl: p.secureUrl,
          storagePublicId: p.publicId,
        })),
      ]);
      onUpload();
      const consumed = queue.slice(0, batch.length);
      release(consumed);
      replaceQueue(queue.slice(batch.length));
    } catch (err) {
      const failure = safeError(err);
      setError(
        `${failure.message} Batch đã dừng; không tự thử lại. Một số ảnh có thể đã lên Cloudinary. Kiểm tra dịch vụ trước khi chọn tải lại.`,
      );
      setUncertain(true);
    } finally {
      flight.current = false;
      setBusy(false);
      onBusy(false);
      setConfirm(false);
    }
  }
  function move(index: number, offset: number) {
    const next = [...pages];
    const other = index + offset;
    [next[index], next[other]] = [next[other]!, next[index]!];
    onChange(next);
  }
  return (
    <div className="chapters-comic-editor">
      <div className="stories-section-heading">
        <div>
          <h2>Trang ảnh COMIC</h2>
          <p>{pages.length} ảnh trong danh sách · tối đa 200 trang/chương</p>
        </div>
        <span className="stories-step">02</span>
      </div>
      <div className="chapters-pages-body">
        <Alert kind="info">
          Lưu trang sẽ thay thế toàn bộ danh sách hiện có. Các trang cũ được giữ trong danh sách bên
          dưới khi bạn thêm ảnh; thao tác loại ảnh không xóa tài nguyên Cloudinary.
        </Alert>
        <label
          className={`stories-button secondary stories-file-label ${disabled || busy ? 'disabled' : ''}`}
        >
          <ImagePlus size={16} /> Chọn các trang ảnh
          <input
            ref={input}
            type="file"
            multiple
            accept="image/jpeg,image/png,image/webp"
            aria-label="Chọn ảnh trang truyện"
            disabled={disabled || busy || uncertain}
            onChange={(event) => {
              const files = Array.from(event.currentTarget.files ?? []);
              event.currentTarget.value = '';
              setError('');
              try {
                addFiles(files);
              } catch (err) {
                setError(err instanceof Error ? err.message : 'File ảnh không hợp lệ.');
                return;
              }
            }}
          />
        </label>

        <p className="stories-muted">
          Ảnh mới tự sắp theo tên (1, 2, 10); kéo thả hoặc dùng nút mũi tên để chỉnh lại. Ảnh hiện
          có giữ nguyên thứ tự.
        </p>
        <p className="stories-muted">
          JPEG/PNG/WebP · mỗi ảnh tối đa 10 MiB · mỗi batch tối đa 20 ảnh và dưới 50 MiB gồm
          multipart. Mỗi lần chỉ gửi một batch; batch tiếp theo cần xác nhận mới.
        </p>
        {error && <Alert>{error}</Alert>}
        {queue.length > 0 && (
          <section className="chapters-queue">
            <h3>Ảnh chờ tải ({queue.length})</h3>
            <p>
              Chỉ là preview cục bộ, chưa gửi lên Cloudinary. Còn {batches.length} batch; batch tiếp
              theo có {batch.length} ảnh.
            </p>
            <div className="chapters-local-grid">
              {queue.map((item, index) => (
                <div key={item.key} className="chapters-local-image" {...drag('queue', item.key)}>
                  <span className="chapters-drag-hint">
                    <GripVertical size={16} /> Kéo để đổi thứ tự
                  </span>
                  <img
                    src={item.preview}
                    alt={`Ảnh chờ ${index + 1}`}
                    loading="lazy"
                    draggable={false}
                  />
                  <span>
                    {index + 1}. {item.file.name}
                  </span>
                  <div className="chapters-page-actions">
                    <button
                      type="button"
                      aria-label={`Đưa ảnh chờ ${index + 1} lên`}
                      disabled={busy || disabled || uncertain || index === 0}
                      onClick={() => replaceQueue(reorder(queue, index, index - 1))}
                    >
                      <ArrowUp size={17} />
                    </button>
                    <button
                      type="button"
                      aria-label={`Đưa ảnh chờ ${index + 1} xuống`}
                      disabled={busy || disabled || uncertain || index === queue.length - 1}
                      onClick={() => replaceQueue(reorder(queue, index, index + 1))}
                    >
                      <ArrowDown size={17} />
                    </button>
                  </div>
                  <button
                    className="stories-button secondary"
                    type="button"
                    disabled={busy || disabled || uncertain}
                    onClick={() => {
                      release([item]);
                      replaceQueue(queue.filter((p) => p.key !== item.key));
                    }}
                  >
                    Bỏ ảnh chờ {index + 1}
                  </button>
                </div>
              ))}
            </div>
            <div className="stories-actions">
              <button
                className="stories-button"
                type="button"
                disabled={busy || disabled || uncertain}
                onClick={() => setConfirm(true)}
              >
                <Upload size={16} /> Xác nhận tải batch tiếp theo ({batch.length} ảnh)
              </button>
              {uncertain && (
                <button
                  type="button"
                  className="stories-button secondary"
                  disabled={busy || disabled}
                  onClick={() => {
                    release(queue.slice(0, batch.length));
                    replaceQueue(queue.slice(batch.length));
                    setUncertain(false);
                    setError(
                      'Đã bỏ batch lỗi khỏi hàng chờ. Ảnh có thể vẫn còn trên Cloudinary; không tự xóa hoặc tự tải lại.',
                    );
                  }}
                >
                  Đã kiểm tra; bỏ batch lỗi
                </button>
              )}
            </div>
          </section>
        )}

        {busy && (
          <div className="chapters-progress" role="status">
            <label htmlFor="chapter-upload-progress">
              Đang gửi batch: {progress}%{progress === 99 ? ' · Chờ máy chủ lưu ảnh…' : ''}
            </label>
            <progress id="chapter-upload-progress" max={100} value={progress} />
          </div>
        )}
        <h3>Thứ tự trang sẽ lưu</h3>
        {pages.length === 0 ? (
          <p className="stories-muted">Chưa có ảnh. Hãy chọn ảnh và xác nhận upload.</p>
        ) : (
          <ol className="chapters-page-grid">
            {pages.map((page, index) => (
              <li key={page.key} {...drag('pages', page.key)}>
                <span className="chapters-drag-hint">
                  <GripVertical size={16} /> Kéo để đổi thứ tự
                </span>
                <div className="chapters-page-preview">
                  <img
                    src={page.imageUrl}
                    alt={`Trang ${index + 1}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    draggable={false}
                  />
                  <span>Trang {index + 1}</span>
                </div>
                <div className="chapters-page-actions">
                  <button
                    type="button"
                    aria-label={`Đưa trang ${index + 1} lên`}
                    disabled={disabled || busy || index === 0}
                    onClick={() => move(index, -1)}
                  >
                    <ArrowUp size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Đưa trang ${index + 1} xuống`}
                    disabled={disabled || busy || index === pages.length - 1}
                    onClick={() => move(index, 1)}
                  >
                    <ArrowDown size={17} />
                  </button>
                  <button
                    type="button"
                    aria-label={`Loại trang ${index + 1}`}
                    disabled={disabled || busy}
                    onClick={() => onChange(pages.filter((p) => p.key !== page.key))}
                  >
                    <X size={17} />
                  </button>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      {confirm && (
        <ConfirmDialog
          title="Tải batch ảnh lên Cloudinary?"
          confirmLabel={`Tải ${batch.length} ảnh trong batch này`}
          busy={busy}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void upload()}
        >
          <p>
            Tải đúng {batch.length} ảnh, theo thứ tự đang xem trước. Upload chỉ tạo tài nguyên ảnh;
            chưa lưu ChapterPage.{' '}
            {batches.length > 1 && `${batches.length - 1} batch còn lại sẽ chờ xác nhận riêng.`}
          </p>
          <p>
            Ảnh có thể vẫn còn trên Cloudinary khi hủy form hoặc batch lỗi; không tự tải lại và
            không tự xóa.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
