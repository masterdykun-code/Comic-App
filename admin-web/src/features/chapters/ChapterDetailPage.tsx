import { Link, useParams } from 'react-router';
import { ArrowLeft, Pencil } from 'lucide-react';
import { Alert } from '../../components/Alert';
import { useStory } from '../stories/queries';
import { Badge, Loading, QueryError } from '../stories/components';
import { dateLabel, storyId } from '../stories/model';
import { useChapter } from './queries';
import { PublishChapter } from './PublishChapter';
import './chapters.css';
import { VipChapter } from './VipChapter';
export function ChapterDetailPage() {
  const { storyId: rawParent = '', chapterId: rawChapter = '' } = useParams();
  const parent = rawParent.toLowerCase();
  const chapterId = rawChapter.toLowerCase();
  const story = useStory(parent);
  const chapter = useChapter(chapterId);
  if (!storyId.safeParse(parent).success || !storyId.safeParse(chapterId).success)
    return <Alert>UUID truyện hoặc chương không hợp lệ.</Alert>;
  if (story.isPending || chapter.isPending) return <Loading label="Đang tải chi tiết chương…" />;
  if (story.isError) return <QueryError error={story.error} retry={() => void story.refetch()} />;
  if (chapter.isError)
    return <QueryError error={chapter.error} retry={() => void chapter.refetch()} />;
  if (chapter.data.storyId !== parent) return <Alert>Chương không thuộc truyện đang xem.</Alert>;
  const current = chapter.data;
  const root = `/stories/${parent}/chapters`;
  return (
    <div className="stories-page chapters-page">
      <Link className="stories-back" to={root}>
        <ArrowLeft size={17} /> Danh sách chương · {story.data.title}
      </Link>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">CHƯƠNG {current.chapterNumber}</span>
          <h1>{current.title}</h1>
          <p>Cập nhật {dateLabel(current.updatedAt)}</p>
        </div>
        <div className="stories-actions">
          <Link className="stories-button secondary" to={`${root}/${chapterId}/edit`}>
            <Pencil size={16} /> Chỉnh sửa chương
          </Link>
          {current.publishStatus === 'DRAFT' && (
            <PublishChapter
              key={current.updatedAt}
              id={chapterId}
              story={story.data}
              onConflict={() => void chapter.refetch()}
            />
          )}
        </div>
      </div>
      <VipChapter key={current.updatedAt} chapter={current} onReload={() => chapter.refetch()} />
      <section className="panel chapters-reader">
        <div className="stories-section-heading">
          <div className="stories-badges">
            <Badge value={story.data.type} />
            <Badge value={current.publishStatus} />
          </div>
          <span className="stories-muted">
            {story.data.type === 'NOVEL'
              ? `${current.content?.length ?? 0} ký tự`
              : `${current.pages.length} trang ảnh`}
          </span>
        </div>
        {story.data.type === 'NOVEL' ? (
          <div className="chapters-novel">{current.content || 'Chưa có nội dung chữ.'}</div>
        ) : (
          <div className="chapters-reader-pages">
            {current.pages.length === 0 ? (
              <p>Chưa có trang ảnh.</p>
            ) : (
              [...current.pages]
                .sort((a, b) => a.pageNumber - b.pageNumber)
                .map((page) => (
                  <figure key={page.pageNumber}>
                    <figcaption>Trang {page.pageNumber}</figcaption>
                    <img
                      src={page.imageUrl}
                      alt={`Trang ${page.pageNumber}`}
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </figure>
                ))
            )}
          </div>
        )}
      </section>
    </div>
  );
}
