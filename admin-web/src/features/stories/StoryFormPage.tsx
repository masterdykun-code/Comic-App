import { useRef, useState } from 'react';
import { Link, useBeforeUnload, useNavigate, useParams } from 'react-router';
import { useForm, useController } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { ArrowLeft, Save } from 'lucide-react';
import { Alert } from '../../components/Alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast-context';
import { safeError } from '../../lib/api/errors';
import { CoverField } from './CoverField';
import { Loading, QueryError } from './components';
import {
  defaults,
  labels,
  publicationIssues,
  storyFormSchema,
  storyId,
  type Story,
  type StoryInput,
} from './model';
import { useGenres, useStory, useStoryWrite } from './queries';
import './stories.css';

export function StoryFormPage({ edit = false }: { edit?: boolean }) {
  const { id = '' } = useParams();
  const query = useStory(edit ? id : '');
  if (edit && !storyId.safeParse(id).success) return <Alert>UUID truyện không hợp lệ.</Alert>;
  if (edit && query.isPending) return <Loading />;
  if (edit && query.isError)
    return <QueryError error={query.error} retry={() => void query.refetch()} />;
  return <StoryForm key={edit ? id : 'new'} story={edit ? query.data : undefined} />;
}
function StoryForm({ story }: { story?: Story }) {
  const navigate = useNavigate();
  const toast = useToast();
  const genres = useGenres();
  const locked = (story?.chapterCount ?? 0) > 0;
  const mutation = useStoryWrite(story ? 'update' : 'create', story?.id, locked);
  const [pendingFile, setPendingFile] = useState(false);
  const [uploaded, setUploaded] = useState<string[]>([]);
  const [cancel, setCancel] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const saved = useRef(false);
  const submitting = useRef(false);
  const {
    handleSubmit,
    control,
    setValue,
    formState: { errors, isDirty, isReady },
  } = useForm<StoryInput>({
    resolver: zodResolver(storyFormSchema),
    defaultValues: story
      ? {
          title: story.title,
          type: story.type,
          authorName: story.authorName,
          description: story.description,
          coverUrl: story.coverUrl,
          genreIds: story.genres.map((g) => g.id),
          status: story.status,
        }
      : defaults,
  });
  const title = useController({ control, name: 'title' }).field;
  const author = useController({ control, name: 'authorName' }).field;
  const description = useController({ control, name: 'description' }).field;
  const cover = useController({ control, name: 'coverUrl' }).field;
  const type = useController({ control, name: 'type' }).field;
  const status = useController({ control, name: 'status' }).field;
  const selectedGenres = useController({ control, name: 'genreIds' }).field;
  const unsaved = isDirty || uploaded.length > 0 || pendingFile;
  useBeforeUnload((event) => {
    if (!saved.current && unsaved) {
      event.preventDefault();
      event.returnValue = '';
    }
  });
  const exit = () => navigate(story ? `/stories/${story.id}` : '/stories');
  async function submit(input: StoryInput) {
    if (submitting.current || pendingFile || !genres.data) return;
    if (
      story?.publishStatus === 'PUBLISHED' &&
      publicationIssues({
        ...input,
        genres: input.genreIds.map((id) => ({ id, name: '', slug: '' })),
      })
    ) {
      setSubmitError('Truyện đã xuất bản cần mô tả, ảnh bìa và ít nhất một thể loại.');
      return;
    }
    submitting.current = true;
    setSubmitError('');
    try {
      const result = await mutation.mutateAsync(input);
      saved.current = true;
      const unused = uploaded.length - Number(uploaded.includes(result.coverUrl));
      toast(
        `${story ? 'Đã lưu thay đổi.' : 'Đã tạo bản nháp.'}${unused > 0 ? ' Ảnh tải trước đó nhưng không sử dụng vẫn còn trên Cloudinary.' : ''}`,
      );
      navigate(`/stories/${result.id}`);
    } catch (error) {
      setSubmitError(safeError(error).message);
    } finally {
      submitting.current = false;
    }
  }
  if (!isReady || genres.isPending) return <Loading label="Đang chuẩn bị form truyện…" />;
  if (genres.isError)
    return <QueryError error={genres.error} retry={() => void genres.refetch()} />;
  return (
    <div className="stories-page">
      <Link
        className="stories-back"
        to={story ? `/stories/${story.id}` : '/stories'}
        onClick={(event) => {
          if (unsaved) {
            event.preventDefault();
            setCancel(true);
          }
        }}
      >
        <ArrowLeft size={17} /> {story ? 'Chi tiết truyện' : 'Thư viện truyện'}
      </Link>
      <div className="page-title-row">
        <div>
          <span className="eyebrow">BIÊN TẬP NỘI DUNG</span>
          <h1>{story ? 'Chỉnh sửa truyện' : 'Tạo truyện mới'}</h1>
          <p>
            {story
              ? 'Cập nhật thông tin và hình ảnh của câu chuyện.'
              : 'Bắt đầu bằng bản nháp. Bạn sẽ xuất bản khi mọi thứ sẵn sàng.'}
          </p>
        </div>
        <span className="stories-badge badge-draft">
          {story ? labels[story.publishStatus] : 'Bản nháp'}
        </span>
      </div>
      <form
        className="stories-editor"
        onSubmit={(event) => {
          void handleSubmit(submit)(event);
        }}
        noValidate
      >
        <section className="panel stories-form-panel">
          <div className="stories-section-heading">
            <div>
              <h2>Thông tin câu chuyện</h2>
              <p>Tên truyện và tác giả là thông tin bắt buộc.</p>
            </div>
            <span className="stories-step">01</span>
          </div>
          <div className="stories-form-grid">
            <label className="stories-field full">
              Tên truyện <span aria-hidden="true">*</span>
              <input
                {...title}
                type="text"
                maxLength={200}
                aria-invalid={Boolean(errors.title)}
                aria-describedby={errors.title ? 'title-error' : undefined}
                placeholder="Nhập tên câu chuyện của bạn"
              />
              {errors.title && (
                <span className="stories-field-error" id="title-error">
                  {errors.title.message}
                </span>
              )}
            </label>
            <label className="stories-field">
              Tác giả <span aria-hidden="true">*</span>
              <input
                {...author}
                type="text"
                maxLength={100}
                aria-invalid={Boolean(errors.authorName)}
              />
              {errors.authorName && (
                <span className="stories-field-error">{errors.authorName.message}</span>
              )}
            </label>
            <label className="stories-field">
              Loại truyện
              <select {...type} disabled={locked}>
                {(['NOVEL', 'COMIC'] as const).map((v) => (
                  <option key={v} value={v}>
                    {labels[v]}
                  </option>
                ))}
              </select>
              {locked && (
                <small>Đã có {story?.chapterCount} chương; không thể đổi loại truyện.</small>
              )}
            </label>
            <label className="stories-field full">
              Mô tả
              <textarea
                {...description}
                maxLength={10000}
                rows={7}
                placeholder="Giới thiệu thế giới, nhân vật và điều khiến câu chuyện khác biệt…"
                aria-invalid={Boolean(errors.description)}
              />
              <small>Cần có mô tả trước khi xuất bản · tối đa 10.000 ký tự.</small>
              {errors.description && (
                <span className="stories-field-error">{errors.description.message}</span>
              )}
            </label>
            <label className="stories-field">
              Trạng thái
              <select {...status}>
                {(['ONGOING', 'COMPLETED'] as const).map((v) => (
                  <option key={v} value={v}>
                    {labels[v]}
                  </option>
                ))}
              </select>
            </label>
            <fieldset className="stories-genres">
              <legend>Thể loại</legend>
              {genres.data.length === 0 ? (
                <p>Chưa có thể loại. Bạn vẫn có thể lưu nháp, nhưng cần thể loại để xuất bản.</p>
              ) : (
                <div className="stories-genre-options">
                  {genres.data.map((genre) => (
                    <label key={genre.id}>
                      <input
                        type="checkbox"
                        value={genre.id}
                        checked={selectedGenres.value.includes(genre.id)}
                        onBlur={selectedGenres.onBlur}
                        onChange={(event) =>
                          selectedGenres.onChange(
                            event.target.checked
                              ? [...selectedGenres.value, genre.id]
                              : selectedGenres.value.filter((id) => id !== genre.id),
                          )
                        }
                      />
                      {genre.name}
                    </label>
                  ))}
                </div>
              )}
              {errors.genreIds && (
                <span className="stories-field-error">
                  {errors.genreIds.message ?? 'Danh sách thể loại chưa hợp lệ.'}
                </span>
              )}
            </fieldset>
          </div>
        </section>
        <section className="panel stories-form-panel">
          <div className="stories-section-heading">
            <div>
              <h2>Hình ảnh & ảnh bìa</h2>
              <p>Chọn ảnh rồi xác nhận tải lên, hoặc nhập URL ảnh hợp lệ.</p>
            </div>
            <span className="stories-step">02</span>
          </div>
          <CoverField
            value={cover.value}
            disabled={mutation.isPending}
            onPending={setPendingFile}
            onUploaded={(result) => {
              setValue('coverUrl', result.secureUrl, { shouldDirty: true, shouldValidate: true });
              setUploaded((items) => [...items, result.secureUrl]);
            }}
          />
          <label className="stories-field">
            URL ảnh bìa
            <input
              type="url"
              {...cover}
              maxLength={2048}
              placeholder="https://…"
              aria-invalid={Boolean(errors.coverUrl)}
            />
            {errors.coverUrl && (
              <span className="stories-field-error">{errors.coverUrl.message}</span>
            )}
          </label>
          {pendingFile && (
            <Alert kind="info">
              Ảnh mới chỉ được chọn trên máy. Hãy xác nhận tải lên hoặc bỏ ảnh đã chọn trước khi
              lưu.
            </Alert>
          )}
          {uploaded.length > 0 && (
            <Alert kind="info">
              Đã tải ảnh lên Cloudinary nhưng chưa lưu vào truyện. Nếu rời hoặc hủy form, ảnh có thể
              vẫn còn trên Cloudinary. Hệ thống không tự xóa ảnh.
            </Alert>
          )}
        </section>
        {submitError && <Alert>{submitError}</Alert>}
        <div className="stories-editor-footer">
          <p>
            {story?.publishStatus === 'PUBLISHED'
              ? 'Thay đổi sẽ áp dụng cho truyện đã xuất bản.'
              : 'Lưu dưới dạng bản nháp. Không tự động xuất bản.'}
          </p>
          <div className="stories-actions">
            <button
              type="button"
              className="stories-button secondary"
              disabled={mutation.isPending}
              onClick={() => (unsaved ? setCancel(true) : exit())}
            >
              Hủy
            </button>
            <button
              className="stories-button"
              type="submit"
              disabled={mutation.isPending || pendingFile || !genres.data}
            >
              <Save size={17} />{' '}
              {mutation.isPending ? 'Đang lưu…' : story ? 'Lưu thay đổi' : 'Lưu bản nháp'}
            </button>
          </div>
        </div>
      </form>
      {cancel && (
        <ConfirmDialog
          title="Rời trang biên tập?"
          confirmLabel="Rời trang"
          onCancel={() => setCancel(false)}
          onConfirm={exit}
        >
          <p>Những thay đổi chưa lưu sẽ không được giữ lại.</p>
          {uploaded.length > 0 && (
            <p>
              Ảnh đã tải có thể vẫn còn trên Cloudinary dù chưa được gắn vào truyện. Hệ thống không
              tự xóa.
            </p>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
