import { useRef, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { z } from 'zod';
import { RefreshCw, Users, LockKeyhole, UnlockKeyhole, ArrowLeft } from 'lucide-react';
import { Alert } from '../../components/Alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast-context';
import { safeError } from '../../lib/api/errors';
import { dateLabel } from '../stories/model';
import { Loading, QueryError } from '../stories/components';
import { userQuerySchema, type ManagedUser } from './api';
import { useManagedUser, useUsers, useUserStatus } from './queries';
import '../stories/stories.css';
import './users.css';
export function UsersPage() {
  const [params, setParams] = useSearchParams();
  const repeated = [...params.keys()].some((key) => params.getAll(key).length > 1);
  const parsed = userQuerySchema.safeParse(repeated ? { page: [] } : Object.fromEntries(params));
  const query = parsed.success ? parsed.data : { page: 1, limit: 20 };
  const result = useUsers(query, parsed.success);
  function filter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = new URLSearchParams();
    for (const [key, value] of new FormData(event.currentTarget))
      if (String(value).trim()) next.set(key, String(value).trim());
    next.set('page', '1');
    setParams(next);
  }
  function page(value: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(value));
    setParams(next);
  }
  return (
    <div className="stories-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">CỘNG ĐỒNG WEBNOVEL</span>
          <h1>Quản lý người dùng</h1>
          <p>Tìm tài khoản USER và kiểm soát quyền truy cập an toàn.</p>
        </div>
        <button
          className="stories-button secondary"
          disabled={!parsed.success || result.isFetching}
          onClick={() => void result.refetch()}
        >
          <RefreshCw size={16} /> Làm mới
        </button>
      </div>
      <section className="panel stories-library">
        <div className="stories-section-heading">
          <div className="stories-section-title">
            <span className="heading-icon">
              <Users size={21} />
            </span>
            <div>
              <h2>Tài khoản USER</h2>
              <p>
                {result.data
                  ? `${result.data.pagination.total} tài khoản khớp bộ lọc`
                  : 'Không bao gồm tài khoản ADMIN'}
              </p>
            </div>
          </div>
        </div>
        <form key={params.toString()} className="stories-filters users-filters" onSubmit={filter}>
          <label>
            Tìm kiếm
            <input
              name="search"
              maxLength={200}
              defaultValue={params.get('search') ?? ''}
              placeholder="Tên, username hoặc email"
            />
          </label>
          <label>
            Trạng thái
            <select name="status" defaultValue={params.get('status') ?? ''}>
              <option value="">Tất cả</option>
              <option value="ACTIVE">Hoạt động</option>
              <option value="BANNED">Đã khóa</option>
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
            <button className="stories-button">Tìm người dùng</button>
            <button
              className="stories-button secondary"
              type="button"
              onClick={() => setParams({})}
            >
              Xóa bộ lọc
            </button>
          </div>
        </form>
        {!parsed.success ? (
          <Alert>Bộ lọc không hợp lệ. Hãy xóa hoặc chọn lại bộ lọc.</Alert>
        ) : result.isPending ? (
          <Loading label="Đang tải người dùng…" />
        ) : result.isError ? (
          <QueryError error={result.error} retry={() => void result.refetch()} />
        ) : (
          <>
            {result.data.data.length === 0 ? (
              <div className="stories-empty">
                <Users size={36} />
                <h3>Không có người dùng phù hợp</h3>
                <p>Thử tìm kiếm tên hoặc email khác.</p>
              </div>
            ) : (
              <div className="users-list">
                {result.data.data.map((user) => (
                  <article className="user-row" key={user.id}>
                    <span className="user-initial" aria-hidden="true">
                      {(user.displayName || user.username).slice(0, 1).toUpperCase()}
                    </span>
                    <div className="user-summary">
                      <Link to={`/users/${user.id}`}>{user.displayName}</Link>
                      <span>
                        @{user.username} · {user.email}
                      </span>
                      <small>Tạo {dateLabel(user.createdAt)}</small>
                    </div>
                    <Status user={user} />
                    <Link className="stories-button secondary" to={`/users/${user.id}`}>
                      Chi tiết
                    </Link>
                  </article>
                ))}
              </div>
            )}
            <div className="stories-pagination">
              <span>
                Trang {query.page} / {Math.max(1, result.data.pagination.totalPages)} ·{' '}
                {result.data.pagination.total} tài khoản
              </span>
              <div>
                <button
                  className="stories-button secondary"
                  disabled={query.page <= 1}
                  onClick={() => page(query.page - 1)}
                >
                  Trang trước
                </button>
                <button
                  className="stories-button secondary"
                  disabled={query.page >= result.data.pagination.totalPages}
                  onClick={() => page(query.page + 1)}
                >
                  Trang sau
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
function Status({ user }: { user: ManagedUser }) {
  return (
    <span className={`stories-badge user-${user.status.toLowerCase()}`}>
      {user.status === 'ACTIVE' ? 'Hoạt động' : 'Đã khóa'}
    </span>
  );
}
export function UserDetailPage() {
  const { id = '' } = useParams(),
    valid = z.uuid().safeParse(id).success;
  const result = useManagedUser(id, valid),
    mutation = useUserStatus(),
    toast = useToast();
  const [selected, setSelected] = useState<ManagedUser | null>(null),
    [error, setError] = useState(''),
    [mustReload, setMustReload] = useState(false);
  const flight = useRef(false);
  async function reload() {
    const next = await result.refetch();
    if (!next.error) {
      setMustReload(false);
      setError('');
    }
  }
  async function confirm() {
    if (!selected || flight.current) return;
    flight.current = true;
    setError('');
    const status = selected.status === 'ACTIVE' ? 'BANNED' : 'ACTIVE';
    try {
      await mutation.mutateAsync({
        id: selected.id,
        status,
        expectedUpdatedAt: selected.updatedAt,
      });
      toast(
        status === 'BANNED'
          ? 'Đã khóa tài khoản và thu hồi các phiên đăng nhập.'
          : 'Đã mở khóa. Người dùng cần đăng nhập lại.',
      );
      setSelected(null);
    } catch (err) {
      setError(safeError(err).message);
      setMustReload(true);
      setSelected(null);
    } finally {
      flight.current = false;
    }
  }
  const user = result.data;
  return (
    <div className="stories-page">
      <Link className="text-button" to="/users">
        <ArrowLeft size={16} /> Danh sách người dùng
      </Link>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">QUẢN LÝ TÀI KHOẢN</span>
          <h1>Chi tiết người dùng</h1>
          <p>Thông tin tài khoản và trạng thái truy cập.</p>
        </div>
        <button
          className="stories-button secondary"
          disabled={!valid || result.isFetching || mutation.isPending}
          onClick={() => void reload()}
        >
          <RefreshCw size={16} /> Làm mới tài khoản
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {mustReload && (
        <Alert kind="info">
          Hãy làm mới tài khoản để kiểm tra kết quả trước khi thao tác tiếp.
        </Alert>
      )}
      {!valid ? (
        <Alert>ID tài khoản không hợp lệ.</Alert>
      ) : result.isPending ? (
        <Loading label="Đang tải tài khoản…" />
      ) : result.isError ? (
        <QueryError error={result.error} retry={() => void reload()} />
      ) : (
        user && (
          <section className="panel user-detail">
            <div className="user-detail-heading">
              <span className="user-initial">
                {(user.displayName || user.username).slice(0, 1).toUpperCase()}
              </span>
              <div>
                <h2>{user.displayName}</h2>
                <p>@{user.username}</p>
              </div>
              <Status user={user} />
            </div>
            <dl className="account-details">
              <div>
                <dt>Email</dt>
                <dd>{user.email}</dd>
              </div>
              <div>
                <dt>Vai trò</dt>
                <dd>USER</dd>
              </div>
              <div>
                <dt>ID tài khoản</dt>
                <dd>{user.id}</dd>
              </div>
              <div>
                <dt>Ngày tạo</dt>
                <dd>{dateLabel(user.createdAt)}</dd>
              </div>
              <div>
                <dt>Cập nhật</dt>
                <dd>{dateLabel(user.updatedAt)}</dd>
              </div>
            </dl>
            <p className="user-help">
              Khóa tài khoản sẽ chặn các chức năng cần đăng nhập và thu hồi mọi phiên hiện tại. Mở
              khóa yêu cầu người dùng đăng nhập lại. Dữ liệu truyện và hoạt động của tài khoản được
              giữ nguyên.
            </p>
            <button
              className="stories-button secondary"
              disabled={mutation.isPending || mustReload}
              onClick={() => setSelected({ ...user })}
            >
              {user.status === 'ACTIVE' ? <LockKeyhole size={17} /> : <UnlockKeyhole size={17} />}{' '}
              {user.status === 'ACTIVE' ? 'Khóa tài khoản' : 'Mở khóa tài khoản'}
            </button>
          </section>
        )
      )}
      {selected && (
        <ConfirmDialog
          title={selected.status === 'ACTIVE' ? 'Khóa tài khoản?' : 'Mở khóa tài khoản?'}
          danger={selected.status === 'ACTIVE'}
          confirmLabel={selected.status === 'ACTIVE' ? 'Xác nhận khóa' : 'Xác nhận mở khóa'}
          busy={mutation.isPending}
          onCancel={() => setSelected(null)}
          onConfirm={() => void confirm()}
        >
          <p>
            {selected.displayName} · {selected.email}
          </p>
          <p>
            {selected.status === 'ACTIVE'
              ? 'Các phiên đăng nhập sẽ bị thu hồi. Người dùng không thể sử dụng chức năng cần đăng nhập.'
              : 'Tài khoản có thể đăng nhập trở lại. Các phiên cũ không được khôi phục.'}
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
