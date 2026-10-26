import { useRef, useState } from 'react';
import { useController, useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Pencil, Plus, Tags, Trash2 } from 'lucide-react';
import { useGenres } from '../stories/queries';
import { Loading, QueryError } from '../stories/components';
import type { Genre } from '../stories/model';
import { Alert } from '../../components/Alert';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast-context';
import { safeError } from '../../lib/api/errors';
import { genresApi } from './api';
import { genreInputSchema, genreSlug, type GenreInput } from './model';
import { useGenreWrite } from './queries';
import '../stories/stories.css';
import './genres.css';

export function GenresPage() {
  const query = useGenres();
  const [editing, setEditing] = useState<Genre | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Genre | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();
  const flight = useRef(false);
  const remove = useGenreWrite((id: string) => genresApi.remove(id));
  async function confirmDelete() {
    if (!deleting || flight.current) return;
    flight.current = true;
    setError('');
    try {
      await remove.mutateAsync(deleting.id);
      toast('Đã xóa thể loại chưa sử dụng.');
      setDeleting(null);
    } catch (err) {
      setError(safeError(err).message);
      setDeleting(null);
    } finally {
      flight.current = false;
    }
  }
  return (
    <div className="stories-page">
      <div className="page-title-row">
        <div>
          <span className="eyebrow">PHÂN LOẠI NỘI DUNG</span>
          <h1>Quản lý thể loại</h1>
          <p>Sắp xếp thư viện bằng những thể loại rõ ràng, dễ khám phá.</p>
        </div>
        <button
          className="stories-button"
          type="button"
          disabled={remove.isPending || editing !== null}
          onClick={() => {
            setEditing('new');
            setError('');
          }}
        >
          <Plus size={17} /> Thêm thể loại
        </button>
      </div>
      {error && <Alert>{error}</Alert>}
      {editing && (
        <GenreForm
          key={editing === 'new' ? 'new' : editing.id}
          genre={editing === 'new' ? undefined : editing}
          onCancel={() => setEditing(null)}
          onSuccess={() => setEditing(null)}
        />
      )}
      <section className="panel stories-library">
        <div className="stories-section-heading">
          <div className="stories-section-title">
            <span className="heading-icon">
              <Tags size={21} />
            </span>
            <div>
              <h2>Thể loại trong thư viện</h2>
              <p>
                {query.data
                  ? `${query.data.length} thể loại · sắp xếp theo tên`
                  : 'Đang lấy danh sách từ máy chủ'}
              </p>
            </div>
          </div>
        </div>
        {query.isPending ? (
          <Loading label="Đang tải thể loại…" />
        ) : query.isError ? (
          <QueryError error={query.error} retry={() => void query.refetch()} />
        ) : query.data.length === 0 ? (
          <div className="stories-empty">
            <Tags size={36} />
            <h3>Chưa có thể loại</h3>
            <p>Thêm thể loại đầu tiên để phân loại truyện.</p>
            <button
              type="button"
              className="stories-button"
              disabled={editing !== null}
              onClick={() => setEditing('new')}
            >
              Thêm thể loại đầu tiên
            </button>
          </div>
        ) : (
          <div
            className="stories-table-scroll"
            role="region"
            aria-label="Bảng thể loại"
            tabIndex={0}
          >
            <table className="stories-table">
              <thead>
                <tr>
                  <th scope="col">Tên thể loại</th>
                  <th scope="col">Slug</th>
                  <th scope="col">Thao tác</th>
                </tr>
              </thead>
              <tbody>
                {query.data.map((genre) => (
                  <tr key={genre.id}>
                    <td className="genres-name">{genre.name}</td>
                    <td>
                      <code>{genre.slug}</code>
                    </td>
                    <td>
                      <div className="stories-actions">
                        <button
                          className="stories-button secondary"
                          type="button"
                          aria-label={`Sửa ${genre.name}`}
                          disabled={editing !== null || remove.isPending}
                          onClick={() => {
                            setEditing(genre);
                            setError('');
                          }}
                        >
                          <Pencil size={15} /> Chỉnh sửa
                        </button>
                        <button
                          className="stories-button secondary"
                          type="button"
                          aria-label={`Xóa ${genre.name}`}
                          disabled={editing !== null || remove.isPending}
                          onClick={() => {
                            setDeleting(genre);
                            setError('');
                          }}
                        >
                          <Trash2 size={15} /> Xóa
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      {deleting && (
        <ConfirmDialog
          title="Xóa thể loại?"
          confirmLabel="Xác nhận xóa thể loại"
          busy={remove.isPending}
          onCancel={() => setDeleting(null)}
          onConfirm={() => void confirmDelete()}
        >
          <p>
            Xóa “{deleting.name}”? Chỉ thể loại chưa được bất kỳ truyện nào sử dụng mới có thể xóa.
          </p>
          <p>
            Máy chủ sẽ kiểm tra lại; thể loại đang dùng trả 409. Hệ thống không xóa liên kết hoặc
            thay đổi truyện.
          </p>
        </ConfirmDialog>
      )}
    </div>
  );
}
function GenreForm({
  genre,
  onCancel,
  onSuccess,
}: {
  genre?: Genre;
  onCancel: () => void;
  onSuccess: () => void;
}) {
  const {
    control,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<GenreInput>({
    resolver: zodResolver(genreInputSchema),
    defaultValues: { name: genre?.name ?? '', slug: genre?.slug ?? '' },
  });
  const name = useController({ control, name: 'name' }).field;
  const slug = useController({ control, name: 'slug' }).field;
  const [pending, setPending] = useState<GenreInput | null>(null);
  const [error, setError] = useState('');
  const flight = useRef(false);
  const toast = useToast();
  const mutation = useGenreWrite((input: GenreInput) =>
    genre ? genresApi.update(genre.id, input) : genresApi.create(input),
  );
  async function save() {
    if (!pending || flight.current) return;
    flight.current = true;
    setError('');
    try {
      await mutation.mutateAsync(pending);
      toast(genre ? 'Đã cập nhật thể loại.' : 'Đã tạo thể loại.');
      onSuccess();
    } catch (err) {
      setError(safeError(err).message);
      setPending(null);
    } finally {
      flight.current = false;
    }
  }
  return (
    <section className="panel stories-form-panel">
      <div className="stories-section-heading">
        <div>
          <h2>{genre ? 'Chỉnh sửa thể loại' : 'Thêm thể loại mới'}</h2>
          <p>Tên và slug không được trùng với thể loại đã có.</p>
        </div>
      </div>
      <form
        className="genres-form"
        onSubmit={(event) => {
          void handleSubmit((input) => {
            setPending(input);
            setError('');
          })(event);
        }}
        noValidate
      >
        <label className="stories-field">
          Tên thể loại
          <input
            {...name}
            maxLength={100}
            aria-label="Tên thể loại"
            aria-invalid={Boolean(errors.name)}
          />
          {errors.name && <span className="stories-field-error">{errors.name.message}</span>}
        </label>
        <label className="stories-field">
          Slug
          <input
            {...slug}
            maxLength={120}
            aria-label="Slug thể loại"
            aria-invalid={Boolean(errors.slug)}
          />
          {errors.slug && <span className="stories-field-error">{errors.slug.message}</span>}
        </label>
        <button
          type="button"
          className="stories-button secondary"
          onClick={() =>
            setValue('slug', genreSlug(name.value), { shouldDirty: true, shouldValidate: true })
          }
        >
          Tạo slug từ tên
        </button>
        <p className="stories-muted">
          Slug dùng chữ thường a–z, số, dấu gạch nối. Tên được giữ nguyên hoa/thường; kiểm tra trùng
          theo ràng buộc PostgreSQL.
        </p>
        {error && <Alert>{error}</Alert>}
        <div className="stories-actions">
          <button
            type="button"
            className="stories-button secondary"
            disabled={mutation.isPending}
            onClick={onCancel}
          >
            Hủy chỉnh sửa
          </button>
          <button type="submit" className="stories-button" disabled={mutation.isPending}>
            {genre ? 'Lưu thể loại' : 'Tạo thể loại'}
          </button>
        </div>
      </form>
      {pending && (
        <ConfirmDialog
          title={genre ? 'Lưu thay đổi thể loại?' : 'Tạo thể loại mới?'}
          confirmLabel={genre ? 'Xác nhận lưu thể loại' : 'Xác nhận tạo thể loại'}
          busy={mutation.isPending}
          onCancel={() => setPending(null)}
          onConfirm={() => void save()}
        >
          <p>
            {pending.name} · slug: {pending.slug}
          </p>
          {genre && (
            <p>
              Đổi tên/slug sẽ áp dụng cho thể loại đang được các truyện liên kết. Liên kết bằng UUID
              được giữ nguyên.
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
  );
}
