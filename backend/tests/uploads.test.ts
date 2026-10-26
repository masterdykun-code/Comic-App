import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve, dirname, basename } from 'node:path';
import { Readable, PassThrough } from 'node:stream';
import test, { mock } from 'node:test';

import express from 'express';
import sharp from 'sharp';
import { v2 as cloudinary, type UploadApiOptions, type UploadResponseCallback } from 'cloudinary';
import { cloudinaryStorage } from '../src/config/cloudinary';
import { createAuthService } from '../src/services/auth.service';
import { createUploadService } from '../src/services/upload.service';
import { createUploadRouter } from '../src/routes/upload.routes';
import { errorHandler, notFoundHandler } from '../src/middlewares/error-handler';
import { receiveUpload } from '../src/middlewares/upload.validation';
import type { ImageStorage } from '../src/types/upload.types';
import { MiB } from '../src/types/upload.types';
import { UploadCapacity } from '../src/utils/upload-capacity';
import { MemoryAuthStore } from './helpers/memory-auth.store';
import { createStorySchema } from '../src/middlewares/story.validation';
import { chapterPagesSchema } from '../src/middlewares/chapter.validation';
import { disconnectPrisma, getPrismaClient } from '../src/config/prisma';

process.env.JWT_SECRET = randomBytes(48).toString('hex');
const png = () => sharp({ create: { width: 8, height: 8, channels: 3, background: '#117744' } }).png().toBuffer();
type FileSpec = { bytes: Buffer; name?: string; mime?: string; field?: string };

class FakeCloudinary implements ImageStorage {
  calls: Array<{ path: string; folder: string; id: string; bytes: Buffer }> = [];
  active = 0; peak = 0; fail = false;
  wait?: Promise<void>;
  onStart?: () => void;
  assertReady() {}
  async upload(path: string, folder: string, id: string, signal: AbortSignal) {
    const index = this.calls.length;
    const call = { path, folder, id, bytes: Buffer.alloc(0) };
    this.calls.push(call); call.bytes = await readFile(path);
    this.active++; this.peak = Math.max(this.peak, this.active); this.onStart?.();
    try {
      if (this.wait) await this.wait;
      await new Promise(resolve => setTimeout(resolve, index === 0 ? 25 : 2));
      if (signal.aborted || this.fail) throw new Error('PRIVATE_API_SECRET_AND_DRIVER_STACK_MUST_NOT_LEAK');
      return { secureUrl: `https://res.cloudinary.com/mock/image/upload/${folder}/${id}.png`, publicId: `${folder}/${id}` };
    } finally { this.active--; }
  }
}

async function fixture(run: (f: {
  storage: FakeCloudinary; authStore: MemoryAuthStore;
  send: (endpoint: 'cover' | 'chapter-pages', files: FileSpec[], actor?: 'admin' | 'user' | 'guest', fields?: Record<string, string>) => Promise<{ status: number; body: any }>;
}) => Promise<void>, capacity = new UploadCapacity(2), storageOverride?: ImageStorage) {
  const authStore = new MemoryAuthStore(); const auth = createAuthService(authStore);
  const user = await auth.register({ username: 'upload_admin', email: 'admin@example.test', password: 'Test-password-123' });
  authStore.users.get(user.id)!.role = 'ADMIN'; // Memory-only identity.
  await auth.register({ username: 'upload_user', email: 'user@example.test', password: 'Test-password-123' });
  const tokens = {
    admin: (await auth.login('admin@example.test', 'Test-password-123')).accessToken,
    user: (await auth.login('user@example.test', 'Test-password-123')).accessToken,
  };
  const storage = new FakeCloudinary();
  const app = express();
  app.use('/api/admin/uploads', createUploadRouter(createUploadService(storageOverride ?? storage), auth, capacity));
  app.use(notFoundHandler); app.use(errorHandler);
  const server = app.listen(0, '127.0.0.1');
  try {
    await once(server, 'listening'); const address = server.address(); assert(address && typeof address !== 'string');
    const send = async (endpoint: 'cover' | 'chapter-pages', files: FileSpec[], actor: 'admin' | 'user' | 'guest' = 'admin', fields: Record<string, string> = {}) => {
      const form = new FormData();
      for (const file of files) form.append(file.field ?? (endpoint === 'chapter-pages' ? 'files' : 'file'),
        new Blob([new Uint8Array(file.bytes)], { type: file.mime ?? 'image/png' }), file.name ?? 'image.png');
      for (const [key, value] of Object.entries(fields)) form.append(key, value);
      const response = await fetch(`http://127.0.0.1:${address.port}/api/admin/uploads/${endpoint}`, {
        method: 'POST', body: form, headers: actor === 'guest' ? {} : { Authorization: `Bearer ${tokens[actor]}` },
      });
      return { status: response.status, body: await response.json() };
    };
    await run({ storage, authStore, send });
  } finally {
    await new Promise<void>((resolve, reject) => { server.close(e => e ? reject(e) : resolve()); server.closeAllConnections(); });
  }
}

test('ADMIN uploads real JPEG/PNG/WebP; returns only secure URL and public ID', async () => fixture(async ({ send, storage }) => {
  const images = [await png(), await sharp(await png()).jpeg().toBuffer(), await sharp(await png()).webp().toBuffer()];
  for (const bytes of images) {
    const r = await send('cover', [{ bytes }]); assert.equal(r.status, 201);
    assert.deepEqual(Object.keys(r.body.data).sort(), ['publicId', 'secureUrl']);
    assert(r.body.data.secureUrl.startsWith('https://')); assert(r.body.data.publicId.startsWith('webnovel/covers/'));
  }
  assert.equal(storage.calls.length, 3);
  for (const call of storage.calls) await assert.rejects(access(call.path));
}));

test('USER/Guest receive 403/401 before parsing upload files', async () => fixture(async ({ send, storage }) => {
  for (const endpoint of ['cover', 'chapter-pages'] as const) {
    assert.equal((await send(endpoint, [{ bytes: Buffer.from('invalid') }], 'user')).status, 403);
    assert.equal((await send(endpoint, [{ bytes: Buffer.from('invalid') }], 'guest')).status, 401);
  }
  assert.equal(storage.calls.length, 0);
}));



test('reject SVG, GIF, PDF, fake raster signature and truncated JPEG regardless of client MIME/name', async () => fixture(async ({ send, storage }) => {
  const jpeg = await sharp(await png()).jpeg().toBuffer();
  for (const bytes of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'), Buffer.from('GIF89a'), Buffer.from('%PDF-1.7'), Buffer.from([137,80,78,71,13,10,26,10,1,2,3,4]), jpeg.subarray(0, Math.floor(jpeg.length / 2))]) {
    const r = await send('cover', [{ bytes, name: 'safe.jpg', mime: 'image/jpeg' }]); assert.equal(r.status, 400);
    assert.equal(r.body.error.code, 'INVALID_IMAGE');
  }
  assert.equal(storage.calls.length, 0);
}));

test('trust decoded bytes instead of filename/MIME and never use client filename as path/public ID', async () => fixture(async ({ send, storage }) => {
  const r = await send('cover', [{ bytes: await png(), name: '../../credentials.png', mime: 'application/octet-stream' }]);
  assert.equal(r.status, 201); assert.equal(storage.calls.length, 1);
  assert.match(storage.calls[0].id, /^[0-9a-f-]{36}$/); assert(!storage.calls[0].path.includes('credentials'));
  assert(!JSON.stringify(r.body).includes('credentials'));
}));

test('image above pixel cap is rejected before Cloudinary', async () => fixture(async ({ send, storage }) => {
  const bytes = await sharp({ create: { width: 5000, height: 4000, channels: 3, background: 'white' } }).png().toBuffer();
  assert.equal((await send('cover', [{ bytes }])).status, 400); assert.equal(storage.calls.length, 0);
}));

test('file limits reject cover >5MiB and chapter page >10MiB', async () => fixture(async ({ send, storage }) => {
  const bytes = await png();
  assert.equal((await send('cover', [{ bytes: Buffer.concat([bytes, Buffer.alloc(5 * MiB + 1)]) }])).status, 413);
  assert.equal((await send('chapter-pages', [{ bytes: Buffer.concat([bytes, Buffer.alloc(10 * MiB + 1)]) }])).status, 413);
  assert.equal(storage.calls.length, 0);
}));

test('reject too many files and require at least one file', async () => fixture(async ({ send, storage }) => {
  const bytes = await png();
  assert.equal((await send('cover', [{ bytes }, { bytes }])).status, 400);
  assert.equal((await send('chapter-pages', Array.from({ length: 21 }, () => ({ bytes })))).status, 400);
  assert.equal((await send('cover', [])).status, 400); assert.equal(storage.calls.length, 0);
}));

test('accepts 20 pages, preserves multipart order despite upload completion order', async () => fixture(async ({ send, storage }) => {
  const bytes = await png();
  const r = await send('chapter-pages', Array.from({ length: 20 }, (_, i) => ({ bytes, name: `page-${20 - i}.png` })));
  assert.equal(r.status, 201); assert.deepEqual(r.body.data.map((x: any) => x.order), Array.from({ length: 20 }, (_, i) => i + 1));
  assert.deepEqual(r.body.data.map((x: any) => x.publicId), storage.calls.map(x => `${x.folder}/${x.id}`));
  assert(storage.calls.every(x => x.folder === 'webnovel/chapter-pages'));
  assert.equal(new Set(r.body.data.map((x: any) => x.publicId)).size, 20); assert(storage.peak <= 2);
}));

test('validates whole batch before uploading any file', async () => fixture(async ({ send, storage }) => {
  const r = await send('chapter-pages', [{ bytes: await png() }, { bytes: Buffer.from('not an image') }]);
  assert.equal(r.status, 400); assert.equal(storage.calls.length, 0);
}));

test('Cloudinary failure is sanitized; temporary files and transfer slots are released', async () => fixture(async ({ send, storage }) => {
  storage.fail = true;
  const r = await send('chapter-pages', [{ bytes: await png() }, { bytes: await png() }]);
  assert.equal(r.status, 502); assert.deepEqual(r.body, { success: false, message: 'Image storage upload failed; please try again later', error: { code: 'UPLOAD_FAILED' } });
  for (const call of storage.calls) await assert.rejects(access(call.path));
  assert.equal(storage.active, 0); storage.fail = false;
  assert.equal((await send('cover', [{ bytes: await png() }])).status, 201);
}));

test('extra text fields/folder selection and unexpected file field are rejected', async () => fixture(async ({ send, storage }) => {
  assert.equal((await send('cover', [{ bytes: await png() }], 'admin', { folder: 'outside' })).status, 400);
  assert.equal((await send('cover', [{ bytes: await png(), field: 'arbitrary' }])).status, 400);
  assert.equal(storage.calls.length, 0);
}));

test('global outbound concurrency remains <=2 across two page batches', async () => fixture(async ({ send, storage }) => {
  const bytes = await png();
  const result = await Promise.all([1, 2].map(() => send('chapter-pages', [{ bytes }, { bytes }, { bytes }])));
  assert(result.every(r => r.status === 201)); assert.equal(storage.calls.length, 6); assert(storage.peak <= 2);
}));

test('request admission rejects excess active request and recovers after completion', async () => fixture(async ({ send, storage }) => {
  let release!: () => void; storage.wait = new Promise<void>(r => { release = r; });
  let started!: () => void; const ready = new Promise<void>(r => { started = r; }); storage.onStart = started;
  const first = send('cover', [{ bytes: await png() }]);
  try {
    await ready;
    const second = await send('cover', [{ bytes: await png() }]); assert.equal(second.status, 429); assert.equal(second.body.error.code, 'UPLOAD_BUSY');
  } finally { release(); }
  assert.equal((await first).status, 201);
  assert.equal((await send('cover', [{ bytes: await png() }])).status, 201);
}, new UploadCapacity(1)));

test('upload rate limiter returns 429 after 30 attempts', async () => fixture(async ({ send }) => {
  for (let i = 0; i < 30; i++) assert.equal((await send('cover', [])).status, 400);
  const r = await send('cover', []); assert.equal(r.status, 429); assert.equal(r.body.error.code, 'RATE_LIMITED');
}));

test('streaming body limit also rejects requests without Content-Length', async () => {
  const boundary = 'test-stream-boundary';
  const bytes = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="image.png"\r\nContent-Type: image/png\r\n\r\n`), Buffer.alloc(2048), Buffer.from(`\r\n--${boundary}--\r\n`)]);
  const req = Object.assign(Readable.from([bytes.subarray(0, 500), bytes.subarray(500)]), {
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` }, is: () => true,
  }) as unknown as express.Request;
  await assert.rejects(receiveUpload(req, { field: 'files', maxFiles: 20, maxFileBytes: 4096, maxBodyBytes: 1024 }, new AbortController().signal),
    (e: unknown) => typeof e === 'object' && e !== null && 'statusCode' in e && e.statusCode === 413);
});

test('missing credentials fail safely with 503; no real Cloudinary call', async () => {
  const names = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const saved = names.map(name => process.env[name]); names.forEach(name => { delete process.env[name]; });
  try {
    await fixture(async ({ send }) => {
      const r = await send('cover', [{ bytes: await png() }]);
      assert.equal(r.status, 503); assert.equal(r.body.error.code, 'UPLOAD_NOT_CONFIGURED');
      assert(!JSON.stringify(r.body).includes('api_secret'));
    }, new UploadCapacity(2), cloudinaryStorage);
  } finally { names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; }); }
});

test('official SDK adapter streams local bytes with safe fixed options (SDK mocked)', async () => {
  const names = ['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'];
  const saved = names.map(name => process.env[name]);
  [process.env.CLOUDINARY_CLOUD_NAME, process.env.CLOUDINARY_API_KEY, process.env.CLOUDINARY_API_SECRET] = ['mock-cloud', 'mock-key', 'mock-secret'];
  const root = await mkdtemp(join(tmpdir(), 'webnovel-sdk-test-')); const file = join(root, 'input'); await writeFile(file, await png());
  let options: UploadApiOptions | undefined;
  const stub = mock.method(cloudinary.uploader, 'upload_stream', (input: UploadApiOptions, callback: UploadResponseCallback) => {
    options = input;
    const stream = new PassThrough(); stream.resume();
    stream.on('finish', () => callback(undefined, { secure_url: 'https://res.cloudinary.com/mock/image.png', public_id: 'webnovel/covers/server-id' } as never));
    return stream;
  });
  try {
    const result = await cloudinaryStorage.upload(file, 'webnovel/covers', 'server-id', new AbortController().signal);
    assert.equal(options?.overwrite, false); assert.equal(options?.use_filename, false);
    assert.equal(options?.folder, 'webnovel/covers'); assert.equal(options?.public_id, 'server-id'); assert.equal(options?.resource_type, 'image');
    assert.deepEqual(Object.keys(result).sort(), ['publicId', 'secureUrl']); assert(!JSON.stringify(result).includes('mock-secret'));
  } finally {
    stub.mock.restore();
    names.forEach((name, i) => { if (saved[i] === undefined) delete process.env[name]; else process.env[name] = saved[i]; });
    const target = resolve(root); assert.equal(dirname(target), resolve(tmpdir())); assert(basename(target).startsWith('webnovel-sdk-test-'));
    await rm(target, { recursive: true, force: true });
  }
});



test('upload output fits existing Stories/Chapters validation and does not create PostgreSQL rows', async () => {
  const db = getPrismaClient();
  const counts = () => Promise.all([
    db.user.count(), db.story.count(), db.genre.count(), db.storyGenre.count(), db.chapter.count(), db.chapterPage.count(),
    db.favorite.count(), db.readingProgress.count(), db.readingHistory.count(), db.rating.count(), db.comment.count(),
    db.authSession.count(), db.refreshToken.count(),
  ]);
  try {
    const before = await counts();
    await fixture(async ({ send }) => {
      const cover = await send('cover', [{ bytes: await png() }]); assert.equal(cover.status, 201);
      assert(createStorySchema.safeParse({ title: 'Cover compatibility', type: 'NOVEL', authorName: 'Author', coverUrl: cover.body.data.secureUrl }).success);
      const pages = await send('chapter-pages', [{ bytes: await png() }]); assert.equal(pages.status, 201);
      assert(chapterPagesSchema.safeParse({ pages: pages.body.data.map((p: any) => ({
        pageNumber: p.order, imageUrl: p.secureUrl, storagePublicId: p.publicId,
      })) }).success);
    });
    assert.deepEqual(await counts(), before);
  } finally { await disconnectPrisma(); }
});
