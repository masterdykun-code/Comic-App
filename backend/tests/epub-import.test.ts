import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { randomBytes } from 'node:crypto';
import { ZipFile } from 'yazl';
import express from 'express';
import sharp from 'sharp';
import { parseEpub, type EpubBook } from '../src/services/epub.parser';
import { createEpubImportService } from '../src/services/epub-import.service';
import type { EpubImportStore } from '../src/services/epub-import.store';
import { createEpubImportRouter } from '../src/routes/epub-import.routes';
import { createAuthService } from '../src/services/auth.service';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { errorHandler } from '../src/middlewares/error-handler';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
const xml = (body: string) =>
  `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chương 1</title></head><body>${body}</body></html>`;
async function archive(entries: Record<string, Buffer | string>) {
  const zip = new ZipFile(),
    chunks: Buffer[] = [];
  zip.outputStream.on('data', (b: Buffer) => chunks.push(b));
  const done = once(zip.outputStream, 'end');
  for (const [name, body] of Object.entries(entries))
    zip.addBuffer(Buffer.isBuffer(body) ? body : Buffer.from(body), name);
  zip.end();
  await done;
  return Buffer.concat(chunks);
}
async function epub(overrides: Record<string, Buffer | string> = {}) {
  return archive({
    mimetype: 'application/epub+zip',
    'META-INF/container.xml':
      '<container><rootfiles><rootfile full-path="content.opf"/></rootfiles></container>',
    'content.opf':
      '<package xmlns="http://www.idpf.org/2007/opf" version="2.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Sách thử</dc:title><dc:creator>Tác giả thử</dc:creator><meta name="cover" content="cover"/></metadata><manifest><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/><item id="cover" href="cover.png"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>',
    'one.xhtml': xml(
      '<h1>Chương 1</h1><p>Chương 1</p><p>Tiếng Việt <strong>đậm</strong><br/>dòng hai.</p><script>PRIVATE_SCRIPT</script>',
    ),
    'two.xhtml': xml('<h1>Chương 2</h1><p>Kết thúc.</p>'),
    'cover.png': await sharp({
      create: { width: 8, height: 8, channels: 3, background: '#334455' },
    })
      .png()
      .toBuffer(),
    ...overrides,
  });
}
async function fixture(
  run: (dir: string, file: string) => Promise<void>,
  bytes?: Buffer,
) {
  const dir = await mkdtemp(join(tmpdir(), 'webnovel-epub-test-'));
  try {
    const file = join(dir, 'input.epub');
    await writeFile(file, bytes ?? (await epub()));
    await run(dir, file);
  } finally {
    const target = resolve(dir);
    assert.equal(dirname(target), resolve(tmpdir()));
    assert(basename(target).startsWith('webnovel-epub-test-'));
    await rm(target, { recursive: true, force: true });
  }
}
class MemoryStore implements EpubImportStore {
  rows = new Map<
    string,
    { title: string; chapters: EpubBook['chapters']; coverUrl: string }
  >();
  calls = 0;
  fail = false;
  async duplicate(title: string, _slug: string, id: string) {
    return (
      this.rows.has(id) ||
      [...this.rows.values()].some((r) => r.title === title)
    );
  }
  async create(
    id: string,
    _actor: string,
    m: { title: string },
    _slug: string,
    coverUrl: string,
    chapters: EpubBook['chapters'],
  ) {
    this.calls++;
    if (this.fail) throw Error('DATABASE_PASSWORD_SHOULD_NOT_LEAK');
    this.rows.set(id, { title: m.title, chapters, coverUrl });
    return { id, chapterCount: chapters.length };
  }
  async visibility(id: string) {
    return this.rows.has(id) ? ('DRAFT' as const) : null;
  }
}
const metadata = {
  title: 'Sách thử',
  authorName: 'Tác giả thử',
  description: '',
  genreIds: [],
  useCover: true,
};

test('EPUB parser keeps Vietnamese, paragraphs, order and a real cover, excluding executable HTML', async () =>
  fixture(async (_dir, file) => {
    const b = await parseEpub(file);
    assert.equal(b.title, 'Sách thử');
    assert.equal(b.chapters.length, 2);
    assert.equal(b.chapters[0].content, 'Tiếng Việt đậm\ndòng hai.');
    assert.equal(b.chapters[1].chapterNumber, 2);
    assert.equal(b.cover?.format, 'png');
    assert.equal(b.sourceKey.length, 64);
  }));
test('EPUB3 TOC excludes frontmatter and uses spine order', async () => {
  const opf =
    '<package><metadata><title>Sách</title><creator>Tác giả</creator></metadata><manifest><item id="intro" href="intro.xhtml"/><item id="nav" href="nav.xhtml" properties="nav"/><item id="one" href="one.xhtml"/><item id="two" href="two.xhtml"/><item id="three" href="three.xhtml"/><item id="four" href="four.xhtml"/></manifest><spine><itemref idref="intro"/><itemref idref="one"/><itemref idref="two"/><itemref idref="three"/><itemref idref="four"/></spine></package>';
  const data = await epub({
    'content.opf': opf,
    'intro.xhtml': xml('<p>Giới thiệu không phải chương.</p>'),
    'nav.xhtml':
      '<html><body><nav><a href="one.xhtml">1</a><a href="two.xhtml">2</a><a href="three.xhtml">3</a><a href="four.xhtml">4</a></nav></body></html>',
    'three.xhtml': xml('<p>Ba.</p>'),
    'four.xhtml': xml('<p>Bốn.</p>'),
  });
  await fixture(async (_d, f) => {
    const b = await parseEpub(f);
    assert.equal(b.chapters.length, 4);
    assert(!b.chapters[0].content.includes('Giới thiệu'));
  }, data);
});
test('chapter navigation does not cause the narrative to be skipped', async () =>
  fixture(
    async (_d, f) => {
      const book = await parseEpub(f);
      assert.equal(book.chapters.length, 2);
      assert.equal(book.chapters[0].content, 'Nội dung chương.');
    },
    await epub({
      'one.xhtml': xml(
        '<h1>Chương 1</h1><p>Nội dung chương.</p><nav><a href="two.xhtml">Chương sau</a></nav>',
      ),
    }),
  ));
test('EPUB rejects non-ZIP, XXE/entity expansion, DRM, empty and oversized chapters', async () => {
  const bads = [
    Buffer.from('not an epub'),
    await epub({
      'one.xhtml':
        '<!DOCTYPE html [<!ENTITY x SYSTEM "file:///secret">]><html><body>&x;</body></html>',
    }),
    await epub({ 'META-INF/encryption.xml': '<encryption/>' }),
    await epub({ 'one.xhtml': xml('<p/>'), 'two.xhtml': xml('<p/>') }),
    await epub({
      'one.xhtml': xml(
        '<p>' +
          Array.from(
            { length: 50000 },
            (_, i) => String(i) + ' tiếng Việt.',
          ).join(' ') +
          '</p>',
      ),
    }),
  ];
  for (const bytes of bads)
    await fixture(async (_d, f) => {
      await assert.rejects(
        () => parseEpub(f),
        (e) =>
          typeof e === 'object' &&
          e !== null &&
          'code' in e &&
          e.code === 'EPUB_INVALID',
      );
    }, bytes);
});
test('EPUB rejects traversal and CRC-corrupt bytes', async () => {
  const raw = await archive({ 'abc.txt': 'data' });
  const escaped = Buffer.from(
    raw.toString('latin1').replaceAll('abc.txt', '../x.tx'),
    'latin1',
  );
  await fixture(async (_d, f) => {
    await assert.rejects(() => parseEpub(f));
  }, escaped);
  const raw2 = await epub();
  const corrupt = Buffer.from(raw2);
  const central = corrupt.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  corrupt.writeUInt32LE(0, central + 16);
  await fixture(async (_d, f) => {
    await assert.rejects(() => parseEpub(f));
  }, corrupt);
});
test('EPUB preview never writes DB; confirm is idempotent, owner-bound and expires', async () =>
  fixture(async (dir, file) => {
    const store = new MemoryStore();
    let now = 0;
    const svc = createEpubImportService(store, join(dir, 'covers'), () => now);
    try {
      const p = await svc.preview(file, 'admin');
      assert.equal(store.calls, 0);
      assert.throws(() => svc.status(p.previewId, 'other'));
      const first = await svc.confirm(
        p.previewId,
        'admin',
        metadata,
        'http://example.test',
      );
      const repeated = await svc.confirm(
        p.previewId,
        'admin',
        metadata,
        'http://example.test',
      );
      assert.deepEqual(repeated, first);
      assert.equal(store.calls, 1);
      assert.equal(store.rows.get(first.id)?.chapters.length, 2);
      assert.equal((await svc.cover(first.id)).type, 'image/png');
      assert.equal(svc.status(p.previewId, 'admin').status, 'imported');
      const second = await svc.preview(file, 'admin');
      assert.equal(second.duplicate, true);
      await assert.rejects(() =>
        svc.confirm(
          second.previewId,
          'admin',
          { ...metadata, title: 'Đổi tên vẫn trùng nội dung' },
          'http://example.test',
        ),
      );
      now = 16 * 60000;
      assert.throws(() => svc.status(second.previewId, 'admin'));
    } finally {
      svc.dispose();
    }
  }));
test('EPUB ambiguous store failure blocks automatic resubmission', async () =>
  fixture(async (dir, file) => {
    const store = new MemoryStore();
    store.fail = true;
    const svc = createEpubImportService(store, join(dir, 'covers'));
    try {
      const p = await svc.preview(file, 'admin');
      await assert.rejects(() =>
        svc.confirm(p.previewId, 'admin', metadata, 'http://example.test'),
      );
      assert.equal(svc.status(p.previewId, 'admin').status, 'unknown');
      await assert.rejects(() =>
        svc.confirm(p.previewId, 'admin', metadata, 'http://example.test'),
      );
      assert.equal(store.calls, 1);
      assert.equal(store.rows.size, 0);
    } finally {
      svc.dispose();
    }
  }));
test('two concurrent confirmations cannot submit the same preview twice', async () =>
  fixture(async (dir, file) => {
    const store = new MemoryStore(),
      svc = createEpubImportService(store, join(dir, 'covers'));
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const original = store.create.bind(store);
    store.create = async (...args) => {
      await wait;
      return original(...args);
    };
    try {
      const p = await svc.preview(file, 'admin');
      const first = svc.confirm(
        p.previewId,
        'admin',
        metadata,
        'http://example.test',
      );
      await assert.rejects(() =>
        svc.confirm(p.previewId, 'admin', metadata, 'http://example.test'),
      );
      release();
      await first;
      assert.equal(store.calls, 1);
    } finally {
      release();
      svc.dispose();
    }
  }));
test('EPUB cover SVG is ignored with a warning rather than rendered/executed', async () =>
  fixture(
    async (_dir, file) => {
      const book = await parseEpub(file);
      assert.equal(book.cover, undefined);
      assert(book.warnings.some((w) => w.includes('Bìa không hợp lệ')));
    },
    await epub({
      'cover.png':
        '<svg xmlns="http://www.w3.org/2000/svg"><script>PRIVATE</script></svg>',
    }),
  ));
test('HTTP EPUB import: Guest 401, USER 403, ADMIN preview/confirm, draft cover protected, no secret leakage', async () =>
  fixture(async (dir, _file) => {
    const authStore = new MemoryAuthStore(),
      auth = createAuthService(authStore),
      store = new MemoryStore();
    const admin = await auth.register({
      username: 'epub_admin',
      email: 'epub-admin@example.test',
      password: 'Test-password-123',
    });
    authStore.users.get(admin.id)!.role = 'ADMIN';
    await auth.register({
      username: 'epub_user',
      email: 'epub-user@example.test',
      password: 'Test-password-123',
    });
    const adminToken = (
        await auth.login('epub-admin@example.test', 'Test-password-123')
      ).accessToken,
      userToken = (
        await auth.login('epub-user@example.test', 'Test-password-123')
      ).accessToken;
    const svc = createEpubImportService(store, join(dir, 'covers')),
      app = express();
    app.use(createEpubImportRouter(svc, auth));
    app.use(errorHandler);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const addr = server.address();
    assert(addr && typeof addr !== 'string');
    const base = `http://127.0.0.1:${addr.port}`;
    const send = async (
      path: string,
      method: string,
      token?: string,
      body?: BodyInit,
      json = false,
    ) =>
      fetch(base + path, {
        method,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(json ? { 'Content-Type': 'application/json' } : {}),
        },
        body,
      });
    try {
      const route = '/api/admin/epub-imports';
      assert.equal((await send(route + '/preview', 'POST')).status, 401);
      assert.equal(
        (await send(route + '/preview', 'POST', userToken)).status,
        403,
      );
      const tooMany = new FormData();
      for (let i = 0; i < 2; i++)
        tooMany.append('file', new Blob(['not epub']), `${i}.epub`);
      assert.equal(
        (await send(route + '/preview', 'POST', adminToken, tooMany)).status,
        400,
      );
      const tooLarge = new FormData();
      tooLarge.append(
        'file',
        new Blob([new Uint8Array(26 * 1024 * 1024)]),
        'huge.epub',
      );
      assert.equal(
        (await send(route + '/preview', 'POST', adminToken, tooLarge)).status,
        413,
      );
      const form = new FormData();
      form.append(
        'file',
        new Blob([new Uint8Array(await epub())]),
        'book.epub',
      );
      const r = await send(route + '/preview', 'POST', adminToken, form);
      assert.equal(r.status, 200);
      const p = (await r.json()).data;
      assert.equal(store.calls, 0);
      assert.equal(
        (
          await send(
            route + '/' + p.previewId + '/confirm',
            'POST',
            adminToken,
            JSON.stringify({ ...metadata, role: 'ADMIN' }),
            true,
          )
        ).status,
        400,
      );
      const committed = await send(
        route + '/' + p.previewId + '/confirm',
        'POST',
        adminToken,
        JSON.stringify(metadata),
        true,
      );
      assert.equal(committed.status, 201);
      const book = (await committed.json()).data;
      assert.equal(
        (await send('/api/epub-covers/' + book.id, 'GET')).status,
        401,
      );
      assert.equal(
        (await send('/api/epub-covers/' + book.id, 'GET', userToken)).status,
        403,
      );
      assert.equal(
        (await send('/api/epub-covers/' + book.id, 'GET', adminToken)).status,
        200,
      );
      const replay = await send(
        route + '/' + p.previewId + '/confirm',
        'POST',
        adminToken,
        JSON.stringify(metadata),
        true,
      );
      assert.equal(replay.status, 201);
      assert.equal(store.calls, 1);
      store.fail = true;
      const bad = new FormData();
      bad.append('file', new Blob(['INVALID']), 'fake.epub');
      const response = await send(route + '/preview', 'POST', adminToken, bad);
      assert.equal(response.status, 400);
      assert(!(await response.text()).includes('PASSWORD_SHOULD_NOT_LEAK'));
      authStore.users.get(admin.id)!.status = 'BANNED';
      assert.equal(
        (await send(route + '/' + p.previewId, 'GET', adminToken)).status,
        401,
      );
    } finally {
      svc.dispose();
      await new Promise<void>((done) => {
        server.close(() => done());
        server.closeAllConnections();
      });
    }
  }));
