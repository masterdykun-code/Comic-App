import { type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { BookOpen, ChevronLeft, ChevronRight, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Badge, Cover, Loading, QueryError } from './components';
import { useGenres, useStories } from './queries';
import { dateLabel, labels, storyId, type StoryQuery } from './model';
import './stories.css';
import { StoryLifecycleActions } from './StoryLifecycleActions';

function queryFromParams(params: URLSearchParams): StoryQuery {
  const positive = (key: string, fallback: number, max: number) => {
    const raw = params.get(key) ?? '';
    const n = Number(raw);
    return /^[1-9]\d*$/.test(raw) && Number.isSafeInteger(n) && n <= max ? n : fallback;
  };
  const query: StoryQuery = {
    page: positive('page', 1, 2147483647),
    limit: positive('limit', 20, 100),
    sort: 'newest',
  };
  if ((query.page - 1) * query.limit > 2147483647) query.page = 1;
  const search = params.get('search')?.trim().slice(0, 200);
  if (search) query.search = search;
  const type = params.get('type');
  if (type === 'NOVEL' || type === 'COMIC') query.type = type;
  const status = params.get('status');
  if (status === 'ONGOING' || status === 'COMPLETED') query.status = status;
  const publishStatus = params.get('publishStatus');
  if (publishStatus === 'DRAFT' || publishStatus === 'PUBLISHED')
    query.publishStatus = publishStatus;
  const sort = params.get('sort');
  if (sort === 'title' || sort === 'updated') query.sort = sort;
  const genre = params.get('genreId');
  if (storyId.safeParse(genre).success) query.genreId = genre!;
  return query;
}
export function StoriesPage() {
  const [params, setParams] = useSearchParams();
  const query = queryFromParams(params);
  const result = useStories(query);
  const genres = useGenres();
  // Keying the filter form restores its values after browser back/forward.
  function apply(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const [key, value] of fields) {
      const text = String(value).trim();
      if (text) next.set(key, text);
    }
    next.set('page', '1');
    setParams(next);
  }
  function page(number: number) {
    const next = new URLSearchParams(params);
    next.set('page', String(number));
    setParams(next);
  }
  const filtered = Boolean(
    query.search || query.type || query.status || query.publishStatus || query.genreId,
  );
  const total = result.data?.pagination.total;
  return (
    <div className="stories-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">THƯ VIỆN NỘI DUNG</span>
          <h1>Quản lý truyện</h1>
          <p>Chăm chút từng câu chuyện, từ bản nháp đến độc giả.</p>
        </div>
        <div className="stories-actions">
          <Link className="stories-button secondary" to="/stories/import-epub">
            Nhập EPUB
          </Link>

          <Link className="stories-button" to="/stories/new">
            <Plus size={18} /> Tạo truyện mới
          </Link>
        </div>
      </div>
      <section className="panel stories-library">
        <div className="stories-section-heading">
          <div className="stories-section-title">
            <span className="heading-icon">
              <BookOpen size={21} />
            </span>
            <div>
              <h2>Thư viện truyện</h2>
              <p>
                {total === undefined
                  ? 'Danh sách dành cho quản trị viên'
                  : `${total} truyện${filtered ? ' khớp bộ lọc' : ' trong thư viện'}`}
              </p>
            </div>
          </div>
          <span className="outline-chip">NOVEL & COMIC</span>
        </div>
        <form key={params.toString()} className="stories-filters" onSubmit={apply}>
          <div className="stories-search">
            <Search size={18} />
            <input
              name="search"
              aria-label="Tìm tên truyện"
              placeholder="Tìm theo tên truyện…"
              maxLength={200}
              defaultValue={query.search ?? ''}
            />
          </div>
          <label>
            Loại truyện
            <select name="type" defaultValue={query.type ?? ''}>
              <option value="">Tất cả loại</option>
              {(['NOVEL', 'COMIC'] as const).map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Xuất bản
            <select name="publishStatus" defaultValue={query.publishStatus ?? ''}>
              <option value="">Tất cả xuất bản</option>
              {(['DRAFT', 'PUBLISHED'] as const).map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Trạng thái
            <select name="status" defaultValue={query.status ?? ''}>
              <option value="">Tất cả trạng thái</option>
              {(['ONGOING', 'COMPLETED'] as const).map((v) => (
                <option key={v} value={v}>
                  {labels[v]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Thể loại
            <select name="genreId" defaultValue={query.genreId ?? ''} disabled={!genres.data}>
              <option value="">Tất cả thể loại</option>
              {genres.data?.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sắp xếp
            <select name="sort" defaultValue={query.sort}>
              <option value="newest">Mới tạo nhất</option>
              <option value="updated">Mới cập nhật</option>
              <option value="title">Tên A–Z</option>
            </select>
          </label>
          <label>
            Mỗi trang
            <select name="limit" defaultValue={query.limit}>
              {[...new Set([10, 20, 50, 100, query.limit])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n} truyện
                  </option>
                ))}
            </select>
          </label>
          <div className="stories-filter-actions">
            <button className="stories-button" type="submit">
              <SlidersHorizontal size={16} /> Áp dụng
            </button>
            <button
              className="stories-button secondary"
              type="button"
              onClick={() => setParams({})}
            >
              Xóa bộ lọc
            </button>
          </div>
        </form>
        {genres.isError && <QueryError error={genres.error} retry={() => void genres.refetch()} />}
        {result.isPending ? (
          <Loading />
        ) : result.isError ? (
          <QueryError error={result.error} retry={() => void result.refetch()} />
        ) : (
          <>
            {result.data.data.length === 0 ? (
              <div className="stories-empty">
                <span className="stories-empty-icon">
                  <BookOpen size={35} strokeWidth={1.3} />
                </span>
                <h3>
                  {filtered
                    ? 'Không tìm thấy truyện phù hợp'
                    : query.page > 1
                      ? 'Trang này chưa có truyện'
                      : 'Thư viện đang chờ câu chuyện đầu tiên'}
                </h3>
                <p>
                  {filtered
                    ? 'Thử đổi từ khóa hoặc xóa bớt bộ lọc.'
                    : 'Tạo bản nháp và hoàn thiện trước khi xuất bản.'}
                </p>
                <Link className="stories-button" to="/stories/new">
                  <Plus size={17} /> Tạo truyện mới
                </Link>
              </div>
            ) : (
              <div
                className="stories-table-scroll"
                role="region"
                aria-label="Bảng truyện"
                tabIndex={0}
              >
                <table className="stories-table">
                  <thead>
                    <tr>
                      <th scope="col">Truyện / tác giả</th>
                      <th scope="col">Loại</th>
                      <th scope="col">Trạng thái</th>
                      <th scope="col">Xuất bản</th>
                      <th scope="col">Thời gian</th>
                      <th scope="col">Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {result.data.data.map((story) => (
                      <tr key={story.id}>
                        <td>
                          <div className="stories-table-identity">
                            <Cover url={story.coverUrl} title={story.title} />
                            <div>
                              <Link to={`/stories/${story.id}`}>{story.title}</Link>
                              <span>{story.authorName}</span>
                            </div>
                          </div>
                        </td>
                        <td>
                          <Badge value={story.type} />
                        </td>
                        <td>
                          <Badge value={story.status} />
                        </td>
                        <td>
                          <Badge value={story.publishStatus} />
                        </td>
                        <td className="stories-time">
                          <span>Tạo: {dateLabel(story.createdAt)}</span>
                          <span>Sửa: {dateLabel(story.updatedAt)}</span>
                        </td>
                        <td>
                          <div className="stories-row-actions">
                            <Link to={`/stories/${story.id}`} aria-label={`Xem ${story.title}`}>
                              Chi tiết
                            </Link>
                            <Link
                              to={`/stories/${story.id}/edit`}
                              aria-label={`Sửa ${story.title}`}
                            >
                              Chỉnh sửa
                            </Link>
                            <StoryLifecycleActions story={story} compact />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="stories-pagination">
              <span>
                Trang {query.page} / {Math.max(1, result.data.pagination.totalPages)} ·{' '}
                {result.data.pagination.total} truyện
              </span>
              <div>
                <button
                  className="stories-button secondary"
                  aria-label="Trang trước"
                  disabled={query.page <= 1}
                  onClick={() => page(query.page - 1)}
                >
                  <ChevronLeft size={17} /> Trước
                </button>
                <button
                  className="stories-button secondary"
                  aria-label="Trang sau"
                  disabled={query.page >= result.data.pagination.totalPages}
                  onClick={() => page(query.page + 1)}
                >
                  Sau <ChevronRight size={17} />
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
