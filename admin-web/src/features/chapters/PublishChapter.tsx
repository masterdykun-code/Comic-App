import { useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { chaptersApi } from './api';
import { useChapterWrite } from './queries';
import { chapterProblem, type Chapter } from './model';
import type { Story } from '../stories/model';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Alert } from '../../components/Alert';
import { useToast } from '../../components/toast-context';
import { safeError } from '../../lib/api/errors';
export function PublishChapter({
  id,
  story,
  label = 'Xuất bản',
  onConflict,
}: {
  id: string;
  story: Story;
  label?: string;
  onConflict?: () => void;
}) {
  const [chapter, setChapter] = useState<Chapter | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const flight = useRef(false);
  const toast = useToast();
  const mutation = useChapterWrite((current: Chapter) =>
    chaptersApi.publish(id, current.updatedAt),
  );
  const problem = chapter
    ? chapterProblem(chapter, story.type, story.publishStatus === 'PUBLISHED')
    : '';
  async function open() {
    if (flight.current) return;
    flight.current = true;
    setLoading(true);
    setError('');
    try {
      const current = await chaptersApi.detail(id);
      if (current.storyId !== story.id) throw new Error('Chapter mismatch');
      setConflict(false);
      setChapter(current);
    } catch (err) {
      setError(safeError(err).message);
    } finally {
      flight.current = false;
      setLoading(false);
    }
  }
  async function publish() {
    if (!chapter || problem || flight.current) return;
    flight.current = true;
    setError('');
    try {
      await mutation.mutateAsync(chapter);
      setChapter(null);
      toast('Đã xuất bản chương.');
    } catch (err) {
      const failure = safeError(err);
      setError(failure.message);
      if (failure.status === 409) {
        setConflict(true);
        onConflict?.();
      }
      setChapter(null);
    } finally {
      flight.current = false;
    }
  }
  return (
    <div className="chapters-publish">
      <button
        type="button"
        className="stories-button"
        disabled={loading || mutation.isPending || conflict}
        onClick={() => void open()}
      >
        <Send size={15} />
        {loading ? 'Đang kiểm tra…' : label}
      </button>
      {error && (
        <Alert>
          {error}
          {conflict && ' Tải lại dữ liệu trước khi thử tiếp.'}
        </Alert>
      )}
      {conflict && (
        <button
          type="button"
          className="stories-button secondary"
          onClick={() => void open()}
          disabled={loading}
        >
          Tải lại điều kiện
        </button>
      )}
      {chapter && (
        <ConfirmDialog
          title="Xuất bản chương?"
          confirmLabel="Xác nhận xuất bản"
          busy={mutation.isPending}
          confirmDisabled={Boolean(problem)}
          onCancel={() => setChapter(null)}
          onConfirm={() => void publish()}
        >
          <p>
            Xuất bản chương {chapter.chapterNumber}: {chapter.title}. Chỉ nội dung đã lưu trên máy
            chủ được xuất bản.
          </p>
          {problem && <Alert>{problem}</Alert>}
          {problem && <p>Hãy quay lại hoàn thiện điều kiện trước khi xuất bản.</p>}
        </ConfirmDialog>
      )}
    </div>
  );
}
