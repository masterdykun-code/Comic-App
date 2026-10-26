import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useController, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Save } from 'lucide-react';
import { Alert } from '../../components/Alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast-context';
import { safeError } from '../../lib/api/errors';
import { useStory } from '../stories/queries';
import { Badge, Loading, QueryError } from '../stories/components';
import { storyId, type Story } from '../stories/model';
import { chaptersApi } from './api';
import { useChapter, useChapterWrite } from './queries';
import {
  chapterInputSchema,
  existingPages,
  numberedPages,
  type Chapter,
  type ChapterInput,
} from './model';
import { ComicPagesEditor } from './ComicPagesEditor';
import { useUnsavedChanges } from './UnsavedChanges';
import './chapters.css';

export function ChapterFormPage({ edit = false }: { edit?: boolean }) {
  const { storyId: rawParent = '', chapterId: rawChapter = '' } = useParams();
  const parent = rawParent.toLowerCase();
  const chapterId = rawChapter.toLowerCase();
  const story = useStory(parent);
  const chapter = useChapter(edit ? chapterId : '');
  const [revision, setRevision] = useState(0);
  if (!storyId.safeParse(parent).success || (edit && !storyId.safeParse(chapterId).success))
    return <Alert>UUID truyện hoặc chương không hợp lệ.</Alert>;
  if (story.isPending || (edit && chapter.isPending))
    return <Loading label="Đang chuẩn bị chương…" />;
  if (story.isError) return <QueryError error={story.error} retry={() => void story.refetch()} />;
  if (edit && chapter.isError && !chapter.data)
    return <QueryError error={chapter.error} retry={() => void chapter.refetch()} />;
  if (edit && chapter.data?.storyId !== parent)
    return <Alert>Chương không thuộc truyện đang xem.</Alert>;
  return (
    <ChapterForm
      key={`${edit ? chapterId : parent}-${revision}`}
      story={story.data}
      chapter={edit ? chapter.data : undefined}
      onReload={async () => {
        const result = await chapter.refetch();
        if (result.error) throw result.error;
        setRevision((n) => n + 1);
      }}
    />
  );
}
function ChapterForm({
  story,
  chapter,
  onReload,
}: {
  story: Story;
  chapter?: Chapter;
  onReload: () => Promise<void>;
}) {
  const navigate = useNavigate();
  const toast = useToast();
  const [base, setBase] = useState(chapter);
  const [pages, setPages] = useState(() => existingPages(chapter?.pages ?? []));
  const [pagesDirty, setPagesDirty] = useState(false);
  const [queued, setQueued] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [unclear, setUnclear] = useState(false);
  const [confirm, setConfirm] = useState<'pages' | 'reload' | null>(null);
  const [reloading, setReloading] = useState(false);
  const flight = useRef(false);
  const novel = story.type === 'NOVEL';
  const root = `/stories/${story.id}/chapters`;
  const metadata = useChapterWrite((input: ChapterInput) =>
    base ? chaptersApi.update(base.id, input, base.updatedAt) : chaptersApi.create(story.id, input),
  );
  const pageMutation = useChapterWrite(() =>
    chaptersApi.pages(base!.id, numberedPages(pages), base!.updatedAt),
  );
  const form = useForm<ChapterInput>({
    resolver: zodResolver(chapterInputSchema),
    defaultValues: {
      chapterNumber: chapter?.chapterNumber ?? 1,
      title: chapter?.title ?? '',
      ...(novel ? { content: chapter?.content ?? '' } : {}),
    },
  });
  const number = useController({ control: form.control, name: 'chapterNumber' }).field;
  const title = useController({ control: form.control, name: 'title' }).field;
  const content = useController({ control: form.control, name: 'content' }).field;
  const busy = metadata.isPending || pageMutation.isPending || uploading || reloading;
  const guard = useUnsavedChanges(
    form.formState.isDirty || pagesDirty || queued || uploaded,
    busy,
    uploaded,
  );
  const disabled = busy || conflict || unclear;
  function fail(err: unknown, sent = true) {
    const failure = safeError(err);
    setError(failure.message);
    if (failure.status === 409) setConflict(true);
    if (sent && [0, 500, 502, 503, 504].includes(failure.status)) {
      setUnclear(true);
      setError(`${failure.message} Kết quả lưu chưa rõ; tải lại để kiểm tra trước khi gửi tiếp.`);
    }
  }
  async function save(input: ChapterInput) {
    if (flight.current || disabled) return;
    flight.current = true;
    setError('');
    if (novel && base?.publishStatus === 'PUBLISHED' && !input.content?.trim()) {
      form.setError('content', {
        message: 'Chương đã xuất bản phải giữ nội dung chữ không trống.',
      });
      flight.current = false;
      return;
    }
    const body = {
      chapterNumber: input.chapterNumber,
      title: input.title,
      ...(novel ? { content: input.content ?? '' } : {}),
    };
    try {
      const result = await metadata.mutateAsync(body);
      if (!base) {
        guard.permit();
        toast(
          novel
            ? 'Đã tạo chương nháp.'
            : 'Đã tạo chương COMIC nháp. Hãy tải ảnh và xác nhận lưu trang.',
        );
        navigate(novel ? `${root}/${result.id}` : `${root}/${result.id}/edit`);
      } else {
        setBase(result);
        form.reset(body);
        toast(
          novel
            ? 'Đã lưu thông tin chương.'
            : 'Đã lưu thông tin chương. Danh sách ảnh chưa lưu vẫn được giữ trong form.',
        );
      }
    } catch (err) {
      fail(err);
    } finally {
      flight.current = false;
    }
  }
  async function savePages() {
    if (!base || disabled || flight.current || queued) return;
    if (base.publishStatus === 'PUBLISHED' && !pages.length) {
      setError('COMIC đã xuất bản phải giữ ít nhất một trang ảnh.');
      setConfirm(null);
      return;
    }
    flight.current = true;
    setError('');
    try {
      const result = await pageMutation.mutateAsync(undefined);
      setBase(result);
      setPages(existingPages(result.pages));
      setPagesDirty(false);
      setUploaded(false);
      toast('Đã lưu toàn bộ danh sách trang.');
    } catch (err) {
      fail(err);
    } finally {
      flight.current = false;
      setConfirm(null);
    }
  }
  async function reload() {
    if (busy) return;
    setReloading(true);
    setError('');
    try {
      await onReload();
    } catch (err) {
      fail(err, false);
      setReloading(false);
      setConfirm(null);
    }
  }
  return (
    <div className="stories-page chapters-page">
      <Link className="stories-back" to={root}>
        <ArrowLeft size={17} /> Danh sách chương · {story.title}
      </Link>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">BIÊN TẬP CHƯƠNG</span>
          <h1>{base ? 'Chỉnh sửa chương' : 'Tạo chương mới'}</h1>
          <p>
            {story.title} ·{' '}
            {base
              ? 'Lưu thông tin và lưu trang ảnh là hai thao tác riêng.'
              : 'Chương mới luôn được tạo dưới dạng bản nháp.'}
          </p>
        </div>
        <div className="stories-badges">
          <Badge value={story.type} />
          <Badge value={base?.publishStatus ?? 'DRAFT'} />
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {(conflict || unclear) && (
        <Alert kind="info">
          Đã khóa thao tác ghi để bảo vệ dữ liệu. Hãy tải lại phiên bản mới nhất; thay đổi cục bộ sẽ
          bị bỏ sau xác nhận.
        </Alert>
      )}
      {(conflict || unclear) && !base && (
        <Link className="stories-button secondary" to={root}>
          Kiểm tra danh sách chương trước khi tạo lại
        </Link>
      )}
      <form
        className="stories-editor"
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit(save)(event);
        }}
      >
        <section className="panel stories-form-panel">
          <div className="stories-section-heading">
            <div>
              <h2>Thông tin chương</h2>
              <p>Không thể thay đổi truyện sở hữu chương.</p>
            </div>
            <span className="stories-step">01</span>
          </div>
          <fieldset className="chapters-metadata-fields" disabled={disabled}>
            <div className="stories-form-grid">
              <label className="stories-field">
                Số chương
                <input
                  {...number}
                  type="number"
                  min={1}
                  max={2147483647}
                  step={1}
                  onChange={(event) =>
                    number.onChange(event.target.value === '' ? NaN : Number(event.target.value))
                  }
                  aria-invalid={Boolean(form.formState.errors.chapterNumber)}
                />
                {form.formState.errors.chapterNumber && (
                  <span className="stories-field-error">
                    {form.formState.errors.chapterNumber.message}
                  </span>
                )}
              </label>
              <label className="stories-field">
                Tên chương
                <input
                  {...title}
                  type="text"
                  maxLength={200}
                  aria-invalid={Boolean(form.formState.errors.title)}
                />
                {form.formState.errors.title && (
                  <span className="stories-field-error">{form.formState.errors.title.message}</span>
                )}
              </label>
              {novel && (
                <label className="stories-field full">
                  Nội dung chương
                  <textarea
                    {...content}
                    value={content.value ?? ''}
                    rows={20}
                    className="chapters-content-editor"
                    aria-label="Nội dung chương"
                    placeholder="Viết nội dung chương dạng văn bản…"
                    aria-invalid={Boolean(form.formState.errors.content)}
                  />
                  <small>
                    {content.value?.length ?? 0} / 200.000 ký tự · Văn bản thuần, giữ nguyên xuống
                    dòng.
                  </small>
                  {form.formState.errors.content && (
                    <span className="stories-field-error">
                      {form.formState.errors.content.message}
                    </span>
                  )}
                </label>
              )}
            </div>
          </fieldset>
          <div className="chapters-save-metadata">
            <button type="submit" className="stories-button" disabled={disabled}>
              <Save size={16} />
              {metadata.isPending ? 'Đang lưu…' : base ? 'Lưu thông tin chương' : 'Tạo chương nháp'}
            </button>
          </div>
        </section>
      </form>
      {!novel && !base && (
        <Alert kind="info">
          Tạo bản nháp trước để nhận ID chương. Sau đó bạn có thể chọn, upload nhiều batch và xác
          nhận lưu toàn bộ danh sách trang.
        </Alert>
      )}
      {!novel && base && (
        <section className="panel stories-form-panel">
          <ComicPagesEditor
            pages={pages}
            disabled={disabled}
            onChange={(next) => {
              setPages(next);
              setPagesDirty(true);
            }}
            onBusy={setUploading}
            onQueue={setQueued}
            onUpload={() => setUploaded(true)}
          />
          {uploaded && (
            <div className="chapters-warning">
              <Alert kind="info">
                Có ảnh đã tải chưa lưu vào chương. Rời trang hoặc bỏ ảnh khỏi danh sách không tự xóa
                ảnh trên Cloudinary.
              </Alert>
            </div>
          )}
          <div className="chapters-save-pages">
            <p>
              {queued
                ? 'Còn ảnh chờ tải. Tải hoặc bỏ ảnh chờ trước khi lưu trang.'
                : 'Chỉ danh sách bên trên sẽ được lưu. Thông tin tên/số chương được lưu riêng.'}
            </p>
            <button
              type="button"
              className="stories-button"
              disabled={
                disabled ||
                queued ||
                !pagesDirty ||
                (base.publishStatus === 'PUBLISHED' && !pages.length)
              }
              onClick={() => setConfirm('pages')}
            >
              <Save size={16} /> Lưu danh sách trang
            </button>
          </div>
        </section>
      )}
      <div className="stories-actions">
        <Link className="stories-button secondary" to={base ? `${root}/${base.id}` : root}>
          {base ? 'Xem nội dung đã lưu' : 'Hủy'}
        </Link>
        {base && (
          <button
            type="button"
            className="stories-button secondary"
            disabled={busy}
            onClick={() => setConfirm('reload')}
          >
            Tải lại dữ liệu chương
          </button>
        )}
      </div>
      {confirm === 'pages' && (
        <ConfirmDialog
          title="Thay thế toàn bộ trang ảnh?"
          confirmLabel="Xác nhận lưu danh sách trang"
          busy={pageMutation.isPending}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void savePages()}
        >
          <p>
            Lưu {pages.length} trang theo thứ tự đang hiển thị, thay thế toàn bộ danh sách hiện có
            của chương. Không xóa tài nguyên Cloudinary.
          </p>
          <p>
            Thông tin chương và trang ảnh là hai lần lưu độc lập. Chỉ nội dung đã lưu mới được xuất
            bản từ trang chi tiết.
          </p>
        </ConfirmDialog>
      )}
      {confirm === 'reload' && (
        <ConfirmDialog
          title="Tải lại dữ liệu mới nhất?"
          confirmLabel="Bỏ thay đổi và tải lại"
          busy={reloading}
          onCancel={() => setConfirm(null)}
          onConfirm={() => void reload()}
        >
          <p>
            Thay đổi chưa lưu sẽ bị bỏ.{' '}
            {uploaded && 'Ảnh đã upload có thể vẫn còn trên Cloudinary và không tự bị xóa.'}
          </p>
        </ConfirmDialog>
      )}
      {guard.dialog}
    </div>
  );
}
