import { useRef, useState } from 'react';
import { LockKeyhole, UnlockKeyhole } from 'lucide-react';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Alert } from '../../components/Alert';
import { useToast } from '../../components/toast-context';
import { safeError } from '../../lib/api/errors';
import { chaptersApi } from './api';
import { useChapterWrite } from './queries';
import type { Chapter } from './model';
export function VipChapter({
  chapter,
  onReload,
}: {
  chapter: Chapter;
  onReload: () => Promise<unknown>;
}) {
  const [vip, setVip] = useState(chapter.isVip ?? false),
    [price, setPrice] = useState(String(chapter.coinPrice ?? 10));
  const [selected, setSelected] = useState<{
      isVip: boolean;
      coinPrice: number;
      version: string;
    } | null>(null),
    [error, setError] = useState(''),
    [mustReload, setMustReload] = useState(false);
  const flight = useRef(false),
    toast = useToast();
  const mutation = useChapterWrite(
    (input: { isVip: boolean; coinPrice: number; version: string }) =>
      chaptersApi.vip(chapter.id, input.isVip, input.coinPrice, input.version),
  );
  const valid = /^[1-9]\d*$/.test(price) && Number(price) <= 100000;
  const changed = vip !== (chapter.isVip ?? false) || Number(price) !== (chapter.coinPrice ?? 10);
  async function confirm() {
    if (!selected || flight.current) return;
    flight.current = true;
    setError('');
    try {
      await mutation.mutateAsync(selected);
      toast(
        selected.isVip
          ? `Đã đặt chương VIP · ${selected.coinPrice} Coin.`
          : 'Đã đặt chương miễn phí.',
      );
      setSelected(null);
    } catch (e) {
      setError(safeError(e).message);
      setMustReload(true);
      setSelected(null);
    } finally {
      flight.current = false;
    }
  }
  return (
    <section className="panel" style={{ padding: 24, display: 'grid', gap: 16 }}>
      <div className="panel-heading">
        <span className="heading-icon">
          {chapter.isVip ? <LockKeyhole size={21} /> : <UnlockKeyhole size={21} />}
        </span>
        <div>
          <h2>Quyền đọc chương</h2>
          <p>
            {chapter.isVip ? `VIP · ${chapter.coinPrice ?? 10} Coin` : 'Miễn phí cho mọi độc giả'}
          </p>
        </div>
      </div>
      <div
        className="stories-filters"
        style={{ padding: 0, gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))' }}
      >
        <label>
          Chế độ chương
          <select
            value={vip ? 'VIP' : 'FREE'}
            disabled={mutation.isPending || mustReload}
            onChange={(e) => setVip(e.target.value === 'VIP')}
          >
            <option value="FREE">Miễn phí</option>
            <option value="VIP">VIP dùng Coin</option>
          </select>
        </label>
        <label>
          Giá mở khóa (Coin)
          <input
            type="number"
            min={1}
            max={100000}
            step={1}
            value={price}
            disabled={mutation.isPending || mustReload || !vip}
            onChange={(e) => setPrice(e.target.value)}
          />
        </label>
      </div>
      <p className="stories-muted">
        Mặc định 10 Coin. Quyền mở khóa đã mua được giữ lại khi đổi giá hoặc chuyển miễn phí/VIP.
        Không sửa nội dung chương.
      </p>
      {vip && !valid && <Alert>Giá phải là số nguyên từ 1 đến 100.000 Coin.</Alert>}
      {error && <Alert>{error}</Alert>}
      {mustReload ? (
        <button className="stories-button secondary" onClick={() => void onReload()}>
          Tải lại chương để kiểm tra
        </button>
      ) : (
        <button
          className="stories-button"
          disabled={!changed || (vip && !valid) || mutation.isPending}
          onClick={() =>
            setSelected({
              isVip: vip,
              coinPrice: vip ? Number(price) : (chapter.coinPrice ?? 10),
              version: chapter.updatedAt,
            })
          }
        >
          Lưu quyền đọc
        </button>
      )}
      {selected && (
        <ConfirmDialog
          title={selected.isVip ? 'Đặt chương VIP?' : 'Đặt chương miễn phí?'}
          confirmLabel="Xác nhận quyền đọc"
          busy={mutation.isPending}
          onCancel={() => setSelected(null)}
          onConfirm={() => void confirm()}
        >
          <p>{chapter.title}</p>
          <p>
            {selected.isVip
              ? `Độc giả cần ${selected.coinPrice} Coin để mở khóa lần đầu. Người đã mở khóa không phải trả thêm.`
              : 'Mọi độc giả có thể đọc chương đã xuất bản. Không hoàn Coin tự động cho giao dịch cũ.'}
          </p>
        </ConfirmDialog>
      )}
    </section>
  );
}
