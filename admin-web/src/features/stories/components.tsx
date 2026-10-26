import { useEffect, useState } from 'react';
import { api } from '../auth/runtime';
import { BookOpen, RefreshCw } from 'lucide-react';
import { Alert } from '../../components/Alert';
import { safeError } from '../../lib/api/errors';
import { labels, type Story } from './model';

export function Cover({
  url,
  title,
  large = false,
}: {
  url: string;
  title: string;
  large?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState('');
  const [localCover, setLocalCover] = useState<{ url: string; blob: string }>();
  let localId: string | undefined;
  try {
    localId = new URL(url).pathname.match(/^\/api\/epub-covers\/([0-9a-f-]{36})$/i)?.[1];
  } catch {
    /* Existing empty cover placeholder. */
  }
  useEffect(() => {
    if (!localId) return;
    const controller = new AbortController();
    let live = true,
      objectUrl: string | undefined;
    void api
      .get<Blob>(`/epub-covers/${localId}`, { responseType: 'blob', signal: controller.signal })
      .then((response) => {
        if (!live) return;
        objectUrl = URL.createObjectURL(response.data);
        setLocalCover({ url, blob: objectUrl });
      })
      .catch(() => {
        if (live) setFailedUrl(url);
      });
    return () => {
      live = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [localId, url]);
  const source = localId ? (localCover?.url === url ? localCover.blob : '') : url;
  return (
    <div className={`stories-cover ${large ? 'large' : ''}`}>
      {source && failedUrl !== url ? (
        <img
          src={source}
          alt={`Bìa ${title}`}
          onError={() => setFailedUrl(url)}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <BookOpen aria-label="Chưa có ảnh bìa" size={large ? 46 : 22} />
      )}
    </div>
  );
}
export function Badge({
  value,
}: {
  value: Story['publishStatus'] | Story['type'] | Story['status'];
}) {
  return <span className={`stories-badge badge-${value.toLowerCase()}`}>{labels[value]}</span>;
}
export function QueryError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="stories-error">
      <Alert>{safeError(error).message}</Alert>
      <button type="button" className="stories-button secondary" onClick={retry}>
        <RefreshCw size={16} /> Tải lại
      </button>
    </div>
  );
}
export function Loading({ label = 'Đang tải truyện…' }: { label?: string }) {
  return (
    <div className="stories-loading" role="status">
      <span>{label}</span>
      {[0, 1, 2, 3].map((n) => (
        <div className="stories-skeleton" key={n} />
      ))}
    </div>
  );
}
