import { useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { useQueryClient } from '@tanstack/react-query';
import { Alert } from '../../components/Alert';
import { safeError } from '../../lib/api/errors';
import { useAuth } from '../auth/auth-context';
import { useGenres, storyKeys } from './queries';
import { epubApi, type EpubInput, type EpubPreview, type EpubResult } from './epub-api';
import './stories.css';
import './epub.css';

export function EpubImportPage() {
  const [file, setFile] = useState<File>();
  const [preview, setPreview] = useState<EpubPreview>();
  const [input, setInput] = useState<EpubInput>({
    title: '',
    authorName: '',
    description: '',
    genreIds: [],
    useCover: true,
  });
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [uncertain, setUncertain] = useState(false);
  const [result, setResult] = useState<EpubResult>();
  const flight = useRef(false);
  const genres = useGenres(),
    cache = useQueryClient();
  const { session } = useAuth();
  async function work(action: () => Promise<void>) {
    if (flight.current) return;
    flight.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (e) {
      setError(safeError(e).message);
    } finally {
      flight.current = false;
      setBusy(false);
    }
  }
  function completed(value: EpubResult) {
    setResult(value);
    void cache.invalidateQueries({ queryKey: storyKeys.lists });
  }
  async function read(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    await work(async () => {
      if (!/\.epub$/i.test(file.name) || file.size > 25 * 1024 * 1024) {
        setError('Chọn một file .epub không quá 25 MB.');
        return;
      }
      const epoch = session.generation();
      const value = await epubApi.preview(file);
      if (session.generation() !== epoch) return;
      setPreview(value);
      setInput({
        title: value.title,
        authorName: value.authorName,
        description: '',
        genreIds: [],
        useCover: Boolean(value.coverDataUrl),
      });
    });
  }
  async function confirm(event: FormEvent) {
    event.preventDefault();
    if (!preview) return;
    await work(async () => {
      const epoch = session.generation();
      try {
        const value = await epubApi.confirm(preview.previewId, input);
        if (session.generation() === epoch) completed(value);
      } catch (e) {
        setUncertain(true);
        throw e;
      }
    });
  }
  async function status() {
    if (!preview) return;
    await work(async () => {
      const value = await epubApi.status(preview.previewId);
      if (value.result) completed(value.result);
      else if (value.status === 'ready') {
        setUncertain(false);
        setError('Chưa nhập sách. Kiểm tra thông tin trước khi thử lại.');
      } else
        setError(
          value.status === 'pending'
            ? 'Máy chủ đang nhập. Hãy kiểm tra lại sau.'
            : 'Chưa rõ kết quả. Hãy kiểm tra danh sách truyện trước khi chọn lại file.',
        );
    });
  }
  async function cancel() {
    if (!preview) return;
    await work(async () => {
      await epubApi.cancel(preview.previewId);
      setPreview(undefined);
      setUncertain(false);
    });
  }
  return (
    <div className="stories-page epub-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">THÊM SÁCH TỪ FILE</span>
          <h1>Nhập tiểu thuyết EPUB</h1>
          <p>Chọn file → xem trước → xác nhận nhập bản nháp.</p>
        </div>
        <Link to="/stories" className="stories-button secondary">
          Quay lại thư viện
        </Link>
      </div>
      {error && <Alert>{error}</Alert>}
      {result ? (
        <section className="panel epub-panel">
          <Alert kind="info">
            Đã tạo sách nháp và {result.chapterCount} chương nháp. Chưa xuất bản.
          </Alert>
          <Link className="stories-button" to={`/stories/${result.id}`}>
            Mở sách vừa nhập
          </Link>
        </section>
      ) : (
        <>
          <form className="panel epub-panel" onSubmit={read}>
            <label>
              File EPUB
              <input
                aria-label="File EPUB"
                type="file"
                accept=".epub,application/epub+zip"
                disabled={busy || Boolean(preview)}
                onChange={(e) => {
                  setFile(e.target.files?.[0]);
                  setError('');
                }}
              />
            </label>
            <p>
              Chỉ EPUB truyện chữ, tối đa 25 MB và 2.000 chương. Không giải mã DRM. File không được
              gửi tới Cloudinary.
            </p>
            <button className="stories-button" disabled={!file || busy || Boolean(preview)}>
              Đọc và xem trước EPUB
            </button>
          </form>
          {busy && <p role="status">Đang xử lý… Không đóng trang hoặc gửi lại yêu cầu.</p>}
          {preview && (
            <form className="panel epub-panel" onSubmit={confirm}>
              <h2>Xem trước · {preview.chapterCount} chương</h2>
              {preview.duplicate && (
                <Alert>
                  Truyện hoặc nội dung EPUB này đã tồn tại. Không thể nhập trùng; dữ liệu cũ được
                  giữ nguyên.
                </Alert>
              )}
              <div className="epub-metadata">
                {preview.coverDataUrl && (
                  <img
                    className="epub-preview-cover"
                    src={preview.coverDataUrl}
                    alt="Bìa trong EPUB"
                  />
                )}
                <div className="epub-fields">
                  <label>
                    Tên truyện
                    <input
                      required
                      maxLength={200}
                      disabled={busy || uncertain}
                      value={input.title}
                      onChange={(e) => setInput({ ...input, title: e.target.value })}
                    />
                  </label>
                  <label>
                    Tác giả
                    <input
                      required
                      maxLength={100}
                      disabled={busy || uncertain}
                      value={input.authorName}
                      onChange={(e) => setInput({ ...input, authorName: e.target.value })}
                    />
                  </label>
                  <label>
                    Mô tả
                    <textarea
                      maxLength={10000}
                      disabled={busy || uncertain}
                      value={input.description}
                      onChange={(e) => setInput({ ...input, description: e.target.value })}
                    />
                  </label>
                </div>
              </div>
              <fieldset disabled={busy || uncertain}>
                <legend>Thể loại (có thể bổ sung sau)</legend>
                {genres.isError ? (
                  <p>Chưa tải được thể loại. Bạn vẫn có thể nhập bản nháp.</p>
                ) : (
                  genres.data?.map((g) => (
                    <label className="epub-check" key={g.id}>
                      <input
                        type="checkbox"
                        checked={input.genreIds.includes(g.id)}
                        onChange={(e) =>
                          setInput({
                            ...input,
                            genreIds: e.target.checked
                              ? [...input.genreIds, g.id]
                              : input.genreIds.filter((id) => id !== g.id),
                          })
                        }
                      />
                      {g.name}
                    </label>
                  ))
                )}
              </fieldset>
              {preview.coverDataUrl && (
                <label className="epub-check">
                  <input
                    type="checkbox"
                    disabled={busy || uncertain}
                    checked={input.useCover}
                    onChange={(e) => setInput({ ...input, useCover: e.target.checked })}
                  />
                  Lưu bìa EPUB tại Backend (không Cloudinary)
                </label>
              )}
              <details>
                <summary>Danh sách {preview.chapterCount} chương theo thứ tự EPUB</summary>
                <div className="epub-chapters">
                  <ol>
                    {preview.chapters.map((c) => (
                      <li key={c.chapterNumber}>
                        {c.title} <small>· {c.characters.toLocaleString('vi-VN')} ký tự</small>
                      </li>
                    ))}
                  </ol>
                </div>
              </details>
              <details>
                <summary>Nội dung mẫu chương đầu</summary>
                <pre className="epub-sample">{preview.sample}</pre>
              </details>
              <ul>
                {preview.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
              <p>
                Giữ nguyên nội dung truyện. Sách và chương luôn là <strong>Nháp</strong>; cần kiểm
                tra quyền sử dụng trước khi xuất bản. Bản xem trước hết hạn sau 15 phút hoặc khi
                Backend khởi động lại.
              </p>
              <div className="epub-actions">
                <button
                  className="stories-button"
                  disabled={
                    busy ||
                    uncertain ||
                    preview.duplicate ||
                    !input.title.trim() ||
                    !input.authorName.trim()
                  }
                >
                  Nhập sách nháp và {preview.chapterCount} chương
                </button>
                {uncertain && (
                  <button
                    type="button"
                    className="stories-button secondary"
                    disabled={busy}
                    onClick={() => void status()}
                  >
                    Kiểm tra kết quả
                  </button>
                )}
                <button
                  type="button"
                  className="stories-button secondary"
                  disabled={busy || uncertain}
                  onClick={() => void cancel()}
                >
                  Hủy bản xem trước
                </button>
              </div>
            </form>
          )}
        </>
      )}
    </div>
  );
}
