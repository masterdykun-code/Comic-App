import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Plus, FileStack } from 'lucide-react';
import { useStory } from '../stories/queries';
import { Badge, Loading, QueryError } from '../stories/components';
import { dateLabel, storyId } from '../stories/model';
import { useChapters } from './queries';
import { PublishChapter } from './PublishChapter';
import './chapters.css';
export function ChapterListPage() {
  const { storyId: rawId = '' } = useParams();
  const id = rawId.toLowerCase();
  const [params, setParams] = useSearchParams();
  const number = (key: string, fallback: number, max: number) => {
    const text = params.get(key) ?? '';
    const n = Number(text);
    return /^[1-9]\d*$/.test(text) && Number.isSafeInteger(n) && n <= max ? n : fallback;
  };
  const limit = number('limit', 20, 100);
  const requested = number('page', 1, 2147483647);
  const page = (requested - 1) * limit <= 2147483647 ? requested : 1;
  const story = useStory(id);
  const chapters = useChapters(id, page, limit);
  const root = `/stories/${id}/chapters`;
  if (!storyId.safeParse(id).success) return <AlertInvalid />;
  if (story.isPending) return <Loading />;
  if (story.isError) return <QueryError error={story.error} retry={() => void story.refetch()} />;
  const setPage = (n: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(n));
    setParams(next);
  };
  return (
    <div className="stories-page chapters-page">
      <Link className="stories-back" to={`/stories/${id}`}>
        <ArrowLeft size={17} /> Chi tiết truyện
      </Link>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">NỘI DUNG CHƯƠNG</span>
          <h1>Quản lý chương</h1>
          <p>{story.data.title}</p>
        </div>
        <div className="stories-actions">
          <Badge value={story.data.type} />
          <Link className="stories-button" to={`${root}/new`}>
            <Plus size={17} /> Thêm chương
          </Link>
        </div>
      </div>
      <section className="panel stories-library">
        <div className="stories-section-heading">
          <div className="stories-section-title">
            <span className="heading-icon">
              <FileStack size={21} />
            </span>
            <div>
              <h2>Danh sách chương</h2>
              <p>
                {chapters.data
                  ? `${chapters.data.pagination.total} chương · Bản nháp và đã xuất bản`
                  : 'Đang lấy dữ liệu từ máy chủ'}
              </p>
            </div>
          </div>
          <label className="chapters-page-limit">
            Mỗi trang
            <select
              aria-label="Số chương mỗi trang"
              value={limit}
              onChange={(event) => setParams({ limit: event.target.value, page: '1' })}
            >
              {[...new Set([10, 20, 50, 100, limit])]
                .sort((a, b) => a - b)
                .map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {chapters.isPending ? (
          <Loading label="Đang tải chương…" />
        ) : chapters.isError ? (
          <QueryError error={chapters.error} retry={() => void chapters.refetch()} />
        ) : (
          <>
            {chapters.data.data.length === 0 ? (
              <div className="stories-empty">
                <FileStack size={38} />
                <h3>Chưa có chương ở trang này</h3>
                <p>Bắt đầu bằng một chương nháp cho câu chuyện của bạn.</p>
                <Link className="stories-button" to={`${root}/new`}>
                  Thêm chương
                </Link>
              </div>
            ) : (
              <div
                className="stories-table-scroll"
                role="region"
                aria-label="Bảng chương"
                tabIndex={0}
              >
                <table className="stories-table">
                  <thead>
                    <tr>
                      <th>Số chương</th>
                      <th>Tên chương</th>
                      <th>Xuất bản</th>
                      <th>Thời gian</th>
                      <th>Thao tác</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chapters.data.data.map((chapter) => (
                      <tr key={chapter.id}>
                        <td className="chapters-number">{chapter.chapterNumber}</td>
                        <td>
                          <Link className="chapters-title" to={`${root}/${chapter.id}`}>
                            {chapter.title}
                          </Link>
                        </td>
                        <td>
                          <Badge value={chapter.publishStatus} />
                          <span className="stories-badge">
                            {chapter.isVip ? `VIP · ${chapter.coinPrice ?? 10} Coin` : 'Miễn phí'}
                          </span>
                        </td>
                        <td className="stories-time">
                          <span>Tạo: {dateLabel(chapter.createdAt)}</span>
                          <span>Sửa: {dateLabel(chapter.updatedAt)}</span>
                        </td>
                        <td>
                          <div className="stories-row-actions">
                            <Link to={`${root}/${chapter.id}`}>Chi tiết</Link>
                            <Link to={`${root}/${chapter.id}/edit`}>Chỉnh sửa</Link>
                            {chapter.publishStatus === 'DRAFT' && (
                              <PublishChapter
                                key={chapter.updatedAt}
                                id={chapter.id}
                                story={story.data}
                                onConflict={() => void chapters.refetch()}
                              />
                            )}
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
                Trang {page} / {Math.max(1, chapters.data.pagination.totalPages)} ·{' '}
                {chapters.data.pagination.total} chương
              </span>
              <div>
                <button
                  className="stories-button secondary"
                  disabled={page <= 1}
                  onClick={() => setPage(page - 1)}
                >
                  Trang trước
                </button>
                <button
                  className="stories-button secondary"
                  disabled={page >= chapters.data.pagination.totalPages}
                  onClick={() => setPage(page + 1)}
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
function AlertInvalid() {
  return (
    <div role="alert" className="alert alert-error">
      UUID truyện không hợp lệ.
    </div>
  );
}
