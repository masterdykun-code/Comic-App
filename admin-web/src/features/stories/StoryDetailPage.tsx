import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { StoryLifecycleActions } from './StoryLifecycleActions';
import { ArrowLeft, FileStack, Pencil, Send } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Alert } from '../../components/Alert';
import { useToast } from '../../components/toast-context';
import { safeError } from '../../lib/api/errors';
import { Badge, Cover, Loading, QueryError } from './components';
import { dateLabel, publicationIssues, storyId } from './model';
import { useStory, useStoryWrite } from './queries';
import './stories.css';

export function StoryDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const query = useStory(id);
  const mutation = useStoryWrite('publish', id);
  const toast = useToast();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  if (!storyId.safeParse(id).success) return <Alert>UUID truyện không hợp lệ.</Alert>;
  if (query.isPending) return <Loading />;
  if (query.isError) return <QueryError error={query.error} retry={() => void query.refetch()} />;
  const story = query.data;
  const missing = publicationIssues(story);
  async function publish() {
    if (mutation.isPending) return;
    setError('');
    try {
      await mutation.mutateAsync(undefined);
      setConfirm(false);
      toast('Đã xuất bản truyện.');
    } catch (err) {
      setError(safeError(err).message);
      setConfirm(false);
    }
  }
  return (
    <div className="stories-page">
      <Link className="stories-back" to="/stories">
        <ArrowLeft size={17} /> Thư viện truyện
      </Link>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">CHI TIẾT CÂU CHUYỆN</span>
          <h1 className="stories-detail-title">{story.title}</h1>
          <p>Thông tin biên tập và trạng thái xuất bản.</p>
        </div>
        <div className="stories-actions">
          <Link className="stories-button secondary" to={`/stories/${id}/edit`}>
            <Pencil size={16} /> Chỉnh sửa
          </Link>
          {story.publishStatus === 'DRAFT' && (
            <button
              type="button"
              className="stories-button"
              onClick={() => setConfirm(true)}
              disabled={mutation.isPending}
            >
              <Send size={16} /> Xuất bản
            </button>
          )}
          <StoryLifecycleActions
            story={story}
            onDeleted={() => navigate('/stories', { replace: true })}
          />
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {story.publishStatus === 'DRAFT' && (
        <Alert kind="info">
          Truyện đang ở bản nháp hoặc đã ngừng xuất bản. Chọn Xuất bản để công khai lại; trạng thái
          từng chương được giữ nguyên.
        </Alert>
      )}
      <section className="panel stories-detail-panel">
        <Cover url={story.coverUrl} title={story.title} large />
        <div className="stories-detail-info">
          <div className="stories-badges">
            <Badge value={story.type} />
            <Badge value={story.status} />
            <Badge value={story.publishStatus} />
          </div>
          <p className="stories-author">
            Tác giả <strong>{story.authorName}</strong>
          </p>
          <h2>Giới thiệu truyện</h2>
          <p className="stories-description">{story.description || 'Chưa có mô tả.'}</p>
          <h3>Thể loại</h3>
          <div className="stories-badges">
            {story.genres.length ? (
              story.genres.map((g) => (
                <span className="stories-genre-chip" key={g.id}>
                  {g.name}
                </span>
              ))
            ) : (
              <span className="stories-muted">Chưa gắn thể loại.</span>
            )}
          </div>
          <dl className="stories-metadata">
            <div>
              <dt>Slug</dt>
              <dd>{story.slug}</dd>
            </div>
            <div>
              <dt>Số chương</dt>
              <dd>{story.chapterCount}</dd>
            </div>
            <div>
              <dt>Ngày tạo</dt>
              <dd>{dateLabel(story.createdAt)}</dd>
            </div>
            <div>
              <dt>Cập nhật</dt>
              <dd>{dateLabel(story.updatedAt)}</dd>
            </div>
          </dl>
        </div>
      </section>
      {story.publishStatus === 'DRAFT' && missing && (
        <Alert kind="info">
          Trước khi xuất bản, hãy bổ sung {missing}. Bạn có thể tiếp tục chỉnh sửa bản nháp.
        </Alert>
      )}
      <section className="panel stories-chapters-placeholder">
        <span className="heading-icon">
          <FileStack size={23} />
        </span>
        <div>
          <h2>Nội dung chương</h2>
          <p>{story.chapterCount} chương · Biên tập nội dung NOVEL và trang ảnh COMIC.</p>
        </div>
        <Link className="stories-button secondary" to={`/stories/${id}/chapters`}>
          Quản lý chương
        </Link>
      </section>
      {confirm && (
        <ConfirmDialog
          title="Xuất bản truyện?"
          confirmLabel="Xác nhận xuất bản"
          busy={mutation.isPending}
          onCancel={() => setConfirm(false)}
          onConfirm={() => void publish()}
        >
          <p>
            Truyện “{story.title}” sẽ xuất hiện công khai với độc giả. Các chương vẫn tuân theo
            trạng thái xuất bản riêng.
          </p>
          {missing && (
            <Alert kind="info">
              Hiện còn thiếu {missing}. Máy chủ sẽ kiểm tra lại điều kiện xuất bản.
            </Alert>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
