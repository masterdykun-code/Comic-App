import yauzl from 'yauzl';
import { DOMParser, type Element, type Node } from '@xmldom/xmldom';
import { posix } from 'node:path';
import sharp from 'sharp';
import { crc32 } from 'node:zlib';
import { createHash } from 'node:crypto';
import { HttpError } from '../utils/http-error';

export type EpubBook = {
  title: string;
  authorName: string;
  sourceKey: string;
  chapters: Array<{ chapterNumber: number; title: string; content: string }>;
  warnings: string[];
  cover?: { bytes: Buffer; format: 'jpeg' | 'png' | 'webp' };
};
const invalid = (message = 'EPUB không hợp lệ hoặc không hỗ trợ.') =>
  new HttpError(400, 'EPUB_INVALID', message);
const MAX_EXPANDED = 64 * 1024 * 1024;

async function unzip(file: string): Promise<Map<string, Buffer>> {
  return new Promise((resolve, reject) => {
    yauzl.open(
      file,
      { lazyEntries: true, validateEntrySizes: true, strictFileNames: true },
      (error, zip) => {
        if (error || !zip) {
          reject(invalid());
          return;
        }
        const files = new Map<string, Buffer>();
        let expanded = 0,
          count = 0,
          stopped = false;
        const fail = () => {
          if (!stopped) {
            stopped = true;
            zip.close();
            reject(invalid('EPUB lỗi, mã hóa hoặc vượt giới hạn giải nén.'));
          }
        };
        zip.on('error', fail);
        zip.on('end', () => {
          if (!stopped) resolve(files);
        });
        zip.on('entry', (entry: yauzl.Entry) => {
          const name = entry.fileName;
          if (
            ++count > 5000 ||
            name.length > 512 ||
            name.includes('\\') ||
            name.startsWith('/') ||
            name.split('/').includes('..') ||
            name.includes(':') ||
            /[\x00-\x1f]/.test(name) ||
            files.has(name) ||
            entry.generalPurposeBitFlag & 1 ||
            ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000
          ) {
            fail();
            return;
          }
          if (name.endsWith('/')) {
            zip.readEntry();
            return;
          }
          expanded += entry.uncompressedSize;
          if (
            expanded > MAX_EXPANDED ||
            entry.uncompressedSize > 8 * 1024 * 1024 ||
            entry.uncompressedSize >
              Math.max(entry.compressedSize * 1000, 1024 * 1024)
          ) {
            fail();
            return;
          }
          zip.openReadStream(entry, (e, stream) => {
            if (e || !stream) {
              fail();
              return;
            }
            const chunks: Buffer[] = [];
            let length = 0;
            stream.on('error', fail);
            stream.on('data', (b: Buffer) => {
              length += b.length;
              if (length > entry.uncompressedSize || length > 8 * 1024 * 1024) {
                stream.destroy();
                fail();
              } else chunks.push(b);
            });
            stream.on('end', () => {
              if (stopped) return;
              const bytes = Buffer.concat(chunks);
              if (
                length !== entry.uncompressedSize ||
                crc32(bytes) !== entry.crc32
              ) {
                fail();
                return;
              }
              files.set(name, bytes);
              zip.readEntry();
            });
          });
        });
        zip.readEntry();
      },
    );
  });
}
function xml(bytes: Buffer | undefined) {
  if (!bytes || bytes.length > 2 * 1024 * 1024) throw invalid();
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw invalid('Chỉ hỗ trợ EPUB UTF-8.');
  }
  if (/<!ENTITY|<!DOCTYPE[^>]*\[/i.test(text) || text.includes('\0'))
    throw invalid();
  try {
    return new DOMParser({
      onError: () => {
        throw invalid();
      },
    }).parseFromString(text, 'application/xml');
  } catch {
    throw invalid('XML/HTML trong EPUB bị lỗi.');
  }
}
function nodes(root: Node, name: string): Element[] {
  const result: Element[] = [];
  const walk = (n: Node) => {
    if (n.nodeType === 1 && (n as Element).localName === name)
      result.push(n as Element);
    for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
  };
  walk(root);
  return result;
}
function ref(base: string, href: string): string {
  if (!href || /^(?:[a-z]+:|\/|\\)/i.test(href))
    throw invalid('EPUB có tham chiếu ngoài hoặc đường dẫn không an toàn.');
  let path: string;
  try {
    path = posix.normalize(
      posix.join(posix.dirname(base), decodeURIComponent(href.split('#')[0]!)),
    );
  } catch {
    throw invalid();
  }
  if (
    path === '..' ||
    path.startsWith('../') ||
    path.includes('\\') ||
    path.includes('\0')
  )
    throw invalid();
  return path;
}
function inline(node: Node): string {
  if (node.nodeType === 3 || node.nodeType === 4) return node.nodeValue ?? '';
  if (node.nodeType !== 1) return '';
  const tag = (node as Element).localName?.toLowerCase() ?? '';
  if (
    ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'nav'].includes(tag)
  )
    return '';
  if (tag === 'br') return '\n';
  let text = '';
  for (let c = node.firstChild; c; c = c.nextSibling) text += inline(c);
  return text;
}
const clean = (s: string) =>
  s
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\f\v \u00a0]+/g, ' ')
    .trim();
export async function parseEpub(file: string): Promise<EpubBook> {
  const files = await unzip(file);
  if (files.get('mimetype')?.toString().trim() !== 'application/epub+zip')
    throw invalid('File không phải EPUB.');
  if (files.has('META-INF/encryption.xml'))
    throw invalid('Không hỗ trợ EPUB có mã hóa/DRM.');
  const container = xml(files.get('META-INF/container.xml'));
  const opf = ref(
    'root',
    nodes(container, 'rootfile')[0]?.getAttribute('full-path') ?? '',
  );
  const doc = xml(files.get(opf));
  const metadata = nodes(doc, 'metadata')[0];
  if (!metadata) throw invalid();
  const manifest = nodes(doc, 'manifest')[0],
    spine = nodes(doc, 'spine')[0];
  if (!manifest || !spine) throw invalid();
  const items = new Map(
    nodes(manifest, 'item').map((n) => [n.getAttribute('id'), n]),
  );
  if (items.size !== nodes(manifest, 'item').length) throw invalid();
  const book: EpubBook = {
    title: clean(nodes(metadata, 'title')[0]?.textContent ?? ''),
    authorName: clean(nodes(metadata, 'creator')[0]?.textContent ?? ''),
    sourceKey: '',
    chapters: [],
    warnings: [],
  };
  const tocItem =
    [...items.values()].find((x) =>
      x.getAttribute('properties')?.split(/\s+/).includes('nav'),
    ) ??
    [...items.values()].find(
      (x) => x.getAttribute('media-type') === 'application/x-dtbncx+xml',
    );
  const tocPaths = new Set<string>();
  if (tocItem) {
    const tocPath = ref(opf, tocItem.getAttribute('href') ?? '');
    const toc = xml(files.get(tocPath));
    for (const el of [...nodes(toc, 'a'), ...nodes(toc, 'content')]) {
      const href = el.getAttribute('href') ?? el.getAttribute('src');
      if (href) tocPaths.add(ref(tocPath, href));
    }
  }
  const useToc = tocPaths.size >= nodes(spine, 'itemref').length * 0.8;
  const seen = new Set<string>();
  let textBytes = 0,
    skipped = 0;
  for (const itemref of nodes(spine, 'itemref')) {
    if (itemref.getAttribute('linear') === 'no') {
      skipped++;
      continue;
    }
    const item = items.get(itemref.getAttribute('idref'));
    if (!item) throw invalid();
    const path = ref(opf, item.getAttribute('href') ?? '');
    if (seen.has(path))
      throw invalid('Spine lặp tài liệu; hãy kiểm tra mục lục EPUB.');
    seen.add(path);
    if (useToc && !tocPaths.has(path)) {
      skipped++;
      continue;
    }
    if (item.getAttribute('properties')?.split(/\s+/).includes('nav')) {
      skipped++;
      continue;
    }
    const html = xml(files.get(path));
    const body = nodes(html, 'body')[0];
    if (!body) throw invalid();
    const heading =
      nodes(body, 'h1')[0] ??
      nodes(body, 'h2')[0] ??
      nodes(body, 'h3')[0] ??
      nodes(body, 'h4')[0];
    const title = clean(
      heading?.textContent ?? nodes(html, 'title')[0]?.textContent ?? '',
    );
    if (
      /^(?:cover|title\s?page|mục lục|contents|table of contents)$/i.test(
        title,
      ) ||
      /^(?:titlepage|cover|mucluc|toc|nav)$/i.test(
        item.getAttribute('id') ?? '',
      )
    ) {
      skipped++;
      continue;
    }
    const blocks: string[] = [];
    const walk = (node: Node) => {
      if (node === heading) return;
      if (node.nodeType !== 1) return;
      const el = node as Element,
        tag = el.localName?.toLowerCase() ?? '';
      if (
        ['script', 'style', 'iframe', 'object', 'embed', 'svg', 'nav'].includes(
          tag,
        )
      )
        return;
      if (
        [
          'p',
          'li',
          'blockquote',
          'pre',
          'h1',
          'h2',
          'h3',
          'h4',
          'h5',
          'h6',
        ].includes(tag)
      ) {
        const t = clean(inline(el));
        if (t && !(blocks.length === 0 && t === title)) blocks.push(t);
        return;
      }
      let run = '';
      const flush = () => {
        const t = clean(run);
        if (t) blocks.push(t);
        run = '';
      };
      for (let c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 1) {
          if (
            [
              'div',
              'section',
              'article',
              'p',
              'li',
              'blockquote',
              'pre',
              'h1',
              'h2',
              'h3',
              'h4',
              'h5',
              'h6',
              'ul',
              'ol',
            ].includes((c as Element).localName ?? '')
          ) {
            flush();
            walk(c);
          } else run += inline(c);
        } else if (c.nodeType === 3) run += c.nodeValue ?? '';
      }
      flush();
    };
    walk(body);
    const content = blocks.join('\n\n');
    if (!content.trim()) {
      skipped++;
      continue;
    }
    if (content.length > 200000 || title.length > 200)
      throw invalid(
        'Một chương vượt giới hạn Reader (200.000 ký tự) hoặc tiêu đề quá dài.',
      );
    if (content.includes('\ufffd'))
      throw invalid('Nội dung chứa ký tự giải mã lỗi.');
    textBytes += Buffer.byteLength(content);
    if (textBytes > 32 * 1024 * 1024 || book.chapters.length >= 2000)
      throw invalid('EPUB vượt giới hạn 2.000 chương hoặc 32 MB nội dung.');
    book.chapters.push({
      chapterNumber: book.chapters.length + 1,
      title: title || `Chương ${book.chapters.length + 1}`,
      content,
    });
  }
  if (!book.chapters.length)
    throw invalid('Không tìm thấy chương truyện chữ trong EPUB.');
  if (book.title.length > 200 || book.authorName.length > 100)
    throw invalid('Metadata EPUB quá dài.');
  if (skipped)
    book.warnings.push(
      `Đã bỏ qua ${skipped} tài liệu bìa/mục lục hoặc tài liệu không có chữ; hãy đối chiếu danh sách chương.`,
    );
  if (book.chapters.some((c) => !/[.!?…。”’\")\]]$/.test(c.content.trim())))
    book.warnings.push(
      'Một số chương không có dấu kết câu. Nội dung được giữ nguyên, không tự bổ sung.',
    );
  let coverItem = [...items.values()].find((x) =>
    x.getAttribute('properties')?.split(/\s+/).includes('cover-image'),
  );
  const coverId = nodes(metadata, 'meta')
    .find((x) => x.getAttribute('name') === 'cover')
    ?.getAttribute('content');
  coverItem ??= items.get(coverId ?? '');
  if (coverItem) {
    const bytes = files.get(ref(opf, coverItem.getAttribute('href') ?? ''));
    try {
      if (!bytes || bytes.length > 5 * 1024 * 1024) throw Error();
      const image = sharp(bytes, {
        failOn: 'warning',
        limitInputPixels: 16_000_000,
      });
      const m = await image.metadata();
      if (
        !['jpeg', 'png', 'webp'].includes(m.format ?? '') ||
        (m.pages ?? 1) !== 1
      )
        throw Error();
      await image.stats();
      book.cover = { bytes, format: m.format as 'jpeg' | 'png' | 'webp' };
    } catch {
      book.warnings.push(
        'Bìa không hợp lệ, quá 5 MB hoặc không phải JPEG/PNG/WebP tĩnh; không nhập bìa.',
      );
    }
  }
  if (!book.cover)
    book.warnings.push(
      'Không có bìa hợp lệ; có thể bổ sung trong form sửa truyện.',
    );
  book.warnings.push(
    'Chưa xác minh quyền sử dụng nguyên tác, bản dịch và bìa. Chỉ nhập bản nháp; không tự xuất bản.',
  );
  book.sourceKey = createHash('sha256')
    .update(
      JSON.stringify([
        book.title.normalize('NFC'),
        book.authorName.normalize('NFC'),
        book.chapters,
      ]),
    )
    .digest('hex');
  return book;
}
