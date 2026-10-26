import { useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Eye, EyeOff, MessageSquare, RefreshCw } from 'lucide-react';
import { Alert } from '../../components/Alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast-context';
import { safeError } from '../../lib/api/errors';
import { dateLabel } from '../stories/model';
import { Loading, QueryError } from '../stories/components';
import { commentQuerySchema, statusLabel, type AdminComment, type CommentQuery } from './model';
import { useAdminComments, useModerateComment } from './queries';
import '../stories/stories.css';
import './comments.css';
export function CommentsPage() {
  const [params, setParams] = useSearchParams();
  const repeated = [...params.keys()].some((key) => params.getAll(key).length > 1);
  const parsed = commentQuerySchema.safeParse(repeated ? { page: [] } : Object.fromEntries(params));
  const query: CommentQuery = parsed.success ? parsed.data : { page: 1, limit: 20, sort: 'newest' };
  const result = useAdminComments(query, parsed.success);
  const mutation = useModerateComment();
  const toast = useToast();
  const [selected, setSelected] = useState<AdminComment | null>(null);
  const [error, setError] = useState('');
  const [filterError, setFilterError] = useState('');
  const [mustReload, setMustReload] = useState(false);
  const flight = useRef(false);
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const [key, value] of fields) {
      const text = String(value).trim();
      if (text) next.set(key, text);
    }
    if (query.parentId) next.set('parentId', query.parentId);
    next.set('page', '1');
    if (!commentQuerySchema.safeParse(Object.fromEntries(next)).success) {
      setFilterError(
        'Bộ lọc chưa hợp lệ. Story ID và Parent ID phải là UUID; mỗi trang tối đa 100 bình luận.',
      );
      return;
    }
    setFilterError('');
    setError('');
    setParams(next);
  }
  function update(key: string, value: string) {
    const next = new URLSearchParams(params);
    next.set(key, value);
    if (key !== 'page') next.set('page', '1');
    setParams(next);
  }
  async function moderate() {
    if (!selected || flight.current) return;
    flight.current = true;
    setError('');
    const target = selected.status === 'VISIBLE' ? 'HIDDEN' : 'VISIBLE';
    try {
      await mutation.mutateAsync({ id: selected.id, status: target });
      toast(
        target === 'HIDDEN'
          ? 'Đã ẩn bình luận.'
          : 'Đã đặt bình luận thành Hiện. Điều kiện hiển thị của truyện và bình luận gốc vẫn được áp dụng.',
      );
      setSelected(null);
    } catch (err) {
      const failure = safeError(err);
      setError(failure.message);
      setMustReload(failure.status === 409 || failure.status === 0 || failure.status >= 500);
      setSelected(null);
    } finally {
      flight.current = false;
    }
  }
  async function reload() {
    const response = await result.refetch();
    if (!response.error) {
      setMustReload(false);
      setError('');
    }
  }
  return (
    <div className="stories-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">CỘNG ĐỒNG ĐỘC GIẢ</span>
          <h1>Kiểm duyệt bình luận</h1>
          <p>Xem thảo luận, phản hồi và điều chỉnh trạng thái hiển thị.</p>
        </div>
        <button
          className="stories-button secondary"
          type="button"
          disabled={!parsed.success || result.isFetching || mutation.isPending}
          onClick={() => void reload()}
        >
          <RefreshCw size={16} /> Làm mới bình luận
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {mustReload && (
        <Alert kind="info">
          Hãy làm mới danh sách để kiểm tra trạng thái hiện tại trước khi thực hiện thao tác tiếp.
        </Alert>
      )}
      <section className="panel stories-library">
        <div className="stories-section-heading">
          <div className="stories-section-title">
            <span className="heading-icon">
              <MessageSquare size={21} />
            </span>
            <div>
              <h2>Tất cả bình luận</h2>
              <p>
                {result.data
                  ? `${result.data.pagination.total} bình luận khớp bộ lọc`
                  : 'Danh sách riêng dành cho ADMIN'}
              </p>
            </div>
          </div>
        </div>
        <form key={params.toString()} className="stories-filters comments-filters" onSubmit={apply}>
          <label>
            Trạng thái bình luận
            <select name="status" defaultValue={query.status ?? ''}>
              <option value="">Tất cả trạng thái</option>
              <option value="VISIBLE">Hiện</option>
              <option value="HIDDEN">Ẩn</option>
            </select>
          </label>
          <label>
            Story ID
            <input
              name="storyId"
              aria-label="Lọc Story ID"
              defaultValue={params.get('storyId') ?? ''}
              placeholder="UUID của truyện (không bắt buộc)"
            />
          </label>
          <label>
            Sắp xếp
            <select name="sort" defaultValue={query.sort}>
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
            </select>
          </label>
          <label>
            Mỗi trang
            <select name="limit" defaultValue={query.limit}>
              {[...new Set([10, 20, 50, 100, query.limit])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </label>
          <div className="stories-filter-actions">
            <button className="stories-button" type="submit">
              Áp dụng bộ lọc
            </button>
            <button
              className="stories-button secondary"
              type="button"
              onClick={() => {
                setParams({});
                setFilterError('');
              }}
            >
              Xóa bộ lọc
            </button>
          </div>
        </form>
        {query.parentId && (
          <div className="comments-thread-filter">
            <span>
              Phản hồi của bình luận gốc: <code>{query.parentId}</code>
            </span>
            <button
              className="text-button"
              onClick={() => {
                const next = new URLSearchParams(params);
                next.delete('parentId');
                next.set('page', '1');
                setParams(next);
              }}
            >
              Bỏ lọc phản hồi
            </button>
          </div>
        )}
        {(filterError || !parsed.success) && (
          <div className="comments-notice">
            <Alert>
              {filterError || 'URL bộ lọc không hợp lệ. Vui lòng xóa hoặc chọn lại bộ lọc.'}
            </Alert>
          </div>
        )}
        {!parsed.success ? null : result.isPending ? (
          <Loading label="Đang tải bình luận…" />
        ) : result.isError ? (
          <QueryError error={result.error} retry={() => void reload()} />
        ) : (
          <>
            {result.data.data.length === 0 ? (
              <div className="stories-empty">
                <MessageSquare size={36} />
                <h3>Không có bình luận phù hợp</h3>
                <p>Thử thay đổi bộ lọc hoặc quay lại danh sách đầy đủ.</p>
              </div>
            ) : (
              <div className="comments-list">
                {result.data.data.map((comment) => (
                  <article key={comment.id} className="comments-card">
                    <div className="comments-card-top">
                      <span className="comments-avatar" aria-hidden="true">
                        {(comment.user.displayName || comment.user.username)
                          .slice(0, 1)
                          .toUpperCase()}
                      </span>
                      <div className="comments-identity">
                        <strong>{comment.user.displayName}</strong>
                        <span>
                          @{comment.user.username} · {dateLabel(comment.createdAt)}
                        </span>
                      </div>
                      <span className={`stories-badge comment-${comment.status.toLowerCase()}`}>
                        {statusLabel[comment.status]}
                      </span>
                    </div>
                    <Link className="comments-story" to={`/stories/${comment.story.id}`}>
                      {comment.story.title}
                    </Link>
                    <p className="comments-content">{comment.content}</p>
                    <div className="comments-context">
                      {comment.parent ? (
                        <p>
                          Phản hồi @{comment.parent.user.username} · Bình luận gốc:{' '}
                          <code>{comment.parent.id}</code> · {statusLabel[comment.parent.status]}
                        </p>
                      ) : (
                        <p>Bình luận gốc · {comment.replyCount} phản hồi</p>
                      )}
                      {comment.parent?.status === 'HIDDEN' && (
                        <p>Không xuất hiện công khai vì bình luận gốc đang ẩn.</p>
                      )}
                      {comment.story.publishStatus === 'DRAFT' && (
                        <p>Truyện đang là bản nháp; bình luận chưa xuất hiện công khai.</p>
                      )}
                      <small>
                        ID: <code>{comment.id}</code> · Cập nhật {dateLabel(comment.updatedAt)}
                      </small>
                    </div>
                    <div className="stories-actions">
                      {comment.replyCount > 0 && (
                        <button
                          type="button"
                          className="stories-button secondary"
                          onClick={() => update('parentId', comment.id)}
                        >
                          Xem {comment.replyCount} phản hồi
                        </button>
                      )}
                      <button
                        type="button"
                        className="stories-button secondary"
                        disabled={mutation.isPending || mustReload}
                        aria-label={`${comment.status === 'VISIBLE' ? 'Ẩn' : 'Hiện'} bình luận ${comment.id}`}
                        onClick={() => {
                          setSelected(comment);
                          setError('');
                        }}
                      >
                        {comment.status === 'VISIBLE' ? <EyeOff size={16} /> : <Eye size={16} />}
                        {comment.status === 'VISIBLE' ? 'Ẩn bình luận' : 'Hiện bình luận'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            <div className="stories-pagination">
              <span>
                Trang {query.page} / {Math.max(1, result.data.pagination.totalPages)} ·{' '}
                {result.data.pagination.total} bình luận
              </span>
              <div>
                <button
                  className="stories-button secondary"
                  type="button"
                  disabled={query.page <= 1}
                  onClick={() => update('page', String(query.page - 1))}
                >
                  Trang trước
                </button>
                <button
                  className="stories-button secondary"
                  type="button"
                  disabled={query.page >= result.data.pagination.totalPages}
                  onClick={() => update('page', String(query.page + 1))}
                >
                  Trang sau
                </button>
              </div>
            </div>
          </>
        )}
      </section>
      {selected && (
        <ConfirmDialog
          title={selected.status === 'VISIBLE' ? 'Ẩn bình luận?' : 'Hiện bình luận?'}
          confirmLabel={
            selected.status === 'VISIBLE' ? 'Xác nhận ẩn bình luận' : 'Xác nhận hiện bình luận'
          }
          busy={mutation.isPending}
          onCancel={() => setSelected(null)}
          onConfirm={() => void moderate()}
        >
          <p>
            {selected.user.displayName}: {selected.content}
          </p>
          {selected.parentId === null && (
            <p>
              {selected.status === 'VISIBLE'
                ? 'Ẩn bình luận gốc cũng làm các phản hồi không xuất hiện công khai.'
                : 'Các phản hồi đang VISIBLE có thể hiển thị lại khi bình luận gốc được hiện.'}
            </p>
          )}
          {selected.parent?.status === 'HIDDEN' && (
            <p>Phản hồi vẫn không công khai khi bình luận gốc còn ẩn.</p>
          )}
          {selected.story.publishStatus === 'DRAFT' && (
            <p>Truyện đang là bản nháp; thao tác này không xuất bản truyện.</p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
