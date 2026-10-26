import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEpub, type EpubBook } from './epub.parser';
import {
  epubSlug,
  prismaEpubImportStore,
  type EpubImportStore,
  type EpubMetadata,
} from './epub-import.store';
import { HttpError } from '../utils/http-error';

type Preview = {
  owner: string;
  expires: number;
  book: EpubBook;
  bytes: number;
  pending: boolean;
  uncertain?: boolean;
  result?: { id: string; chapterCount: number };
};
const importId = (key: string) =>
  `${key.slice(0, 8)}-${key.slice(8, 12)}-5${key.slice(13, 16)}-a${key.slice(17, 20)}-${key.slice(20, 32)}`;
export function createEpubImportService(
  store: EpubImportStore = prismaEpubImportStore,
  root = resolve('storage/epub-covers'),
  clock = Date.now,
) {
  const previews = new Map<string, Preview>();
  const sweep = () => {
    for (const [id, p] of previews)
      if (p.expires < clock() && !p.pending) previews.delete(id);
  };
  const timer = setInterval(sweep, 60000);
  timer.unref();
  const get = (id: string, actor: string) => {
    sweep();
    const p = previews.get(id);
    if (!p || p.owner !== actor)
      throw new HttpError(
        410,
        'EPUB_PREVIEW_EXPIRED',
        'Bản xem trước hết hạn. Hãy chọn lại EPUB.',
      );
    return p;
  };
  return {
    dispose() {
      clearInterval(timer);
      previews.clear();
    },
    async preview(file: string, actor: string) {
      sweep();
      if (
        previews.size >= 4 ||
        [...previews.values()].filter((p) => p.owner === actor).length >= 2
      )
        throw new HttpError(
          429,
          'EPUB_PREVIEW_LIMIT',
          'Quá nhiều bản xem trước. Hãy hủy bản cũ hoặc đợi hết hạn.',
        );
      const book = await parseEpub(file);
      const bytes = book.chapters.reduce(
        (n, c) => n + Buffer.byteLength(c.content),
        book.cover?.bytes.length ?? 0,
      );
      if (
        [...previews.values()].reduce((n, p) => n + p.bytes, bytes) >
        64 * 1024 * 1024
      )
        throw new HttpError(
          429,
          'EPUB_PREVIEW_LIMIT',
          'Bộ nhớ xem trước đang đầy. Thử lại sau.',
        );
      const duplicate = await store.duplicate(
        book.title,
        epubSlug(book.title),
        importId(book.sourceKey),
      );
      const id = randomUUID(),
        expires = clock() + 15 * 60000;
      previews.set(id, { owner: actor, expires, book, bytes, pending: false });
      return {
        previewId: id,
        expiresAt: new Date(expires).toISOString(),
        title: book.title,
        authorName: book.authorName,
        chapterCount: book.chapters.length,
        duplicate,
        warnings: book.warnings,
        chapters: book.chapters.map((c) => ({
          chapterNumber: c.chapterNumber,
          title: c.title,
          characters: c.content.length,
        })),
        sample: book.chapters[0]!.content.slice(0, 4000),
        coverDataUrl: book.cover
          ? `data:image/${book.cover.format};base64,${book.cover.bytes.toString('base64')}`
          : null,
      };
    },
    cancel(id: string, actor: string) {
      const p = get(id, actor);
      if (p.pending)
        throw new HttpError(409, 'EPUB_IMPORT_BUSY', 'Đang nhập EPUB.');
      previews.delete(id);
    },
    status(id: string, actor: string) {
      const p = get(id, actor);
      return {
        status: p.result
          ? 'imported'
          : p.pending
            ? 'pending'
            : p.uncertain
              ? 'unknown'
              : 'ready',
        result: p.result ?? null,
      };
    },
    async confirm(
      id: string,
      actor: string,
      metadata: EpubMetadata,
      origin: string,
    ) {
      const p = get(id, actor);
      if (p.result) return p.result;
      if (p.uncertain)
        throw new HttpError(
          409,
          'EPUB_OUTCOME_UNKNOWN',
          'Kiểm tra danh sách truyện trước khi thao tác tiếp.',
        );
      if (p.pending)
        throw new HttpError(
          409,
          'EPUB_IMPORT_BUSY',
          'Đang nhập EPUB. Không gửi lặp.',
        );
      p.pending = true;
      try {
        const storyId = importId(p.book.sourceKey);
        if (
          await store.duplicate(
            metadata.title,
            epubSlug(metadata.title),
            storyId,
          )
        )
          throw new HttpError(
            409,
            'EPUB_DUPLICATE',
            'Truyện đã tồn tại; không ghi đè.',
          );
        let coverUrl = '';
        if (metadata.useCover && p.book.cover) {
          await mkdir(root, { recursive: true });
          const file = resolve(root, `${storyId}.image`);
          try {
            await writeFile(file, p.book.cover.bytes, {
              flag: 'wx',
              mode: 0o600,
            });
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
            if (!(await readFile(file)).equals(p.book.cover.bytes))
              throw new HttpError(
                409,
                'EPUB_COVER_CONFLICT',
                'Bìa cục bộ đã có nội dung khác. Bỏ chọn bìa để tiếp tục; không ghi đè ảnh.',
              );
          }
          coverUrl = `${origin}/api/epub-covers/${storyId}`;
        }
        const result = await store.create(
          storyId,
          actor,
          metadata,
          epubSlug(metadata.title),
          coverUrl,
          p.book.chapters,
        );
        p.result = result;
        p.book = { ...p.book, chapters: [], cover: undefined };
        p.bytes = 0;
        return result;
      } catch (e) {
        if (!(e instanceof HttpError)) p.uncertain = true;
        throw e;
      } finally {
        p.pending = false;
      }
    },
    visibility(id: string) {
      return store.visibility(id);
    },
    async cover(id: string) {
      if (!/^[0-9a-f-]{36}$/i.test(id))
        throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy ảnh.');
      try {
        const bytes = await readFile(resolve(root, `${id}.image`));
        const format = bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
          ? 'jpeg'
          : bytes
                .subarray(0, 8)
                .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? 'png'
            : bytes.toString('ascii', 0, 4) === 'RIFF' &&
                bytes.toString('ascii', 8, 12) === 'WEBP'
              ? 'webp'
              : null;
        if (!format) throw Error('Invalid stored cover');
        return { bytes, type: `image/${format}` };
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        throw new HttpError(404, 'NOT_FOUND', 'Không tìm thấy ảnh.');
      }
    },
  };
}
export type EpubImportService = ReturnType<typeof createEpubImportService>;
export const epubImportService = createEpubImportService();
