import type { Request } from 'express';
import busboy from 'busboy';
import sharp from 'sharp';
import { createWriteStream } from 'node:fs';
import { mkdtemp, open, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { UploadFile, UploadPolicy } from '../types/upload.types';
import { HttpError } from '../utils/http-error';

const invalidFile = () => new HttpError(400, 'INVALID_IMAGE', 'Only valid static JPEG, PNG and WebP images are accepted');

export async function validateImage(file: UploadFile): Promise<void> {
  const input = await open(file.path, 'r');
  let format: string;
  try {
    const header = Buffer.alloc(12);
    await input.read(header, 0, 12, 0);
    if (header.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) format = 'jpeg';
    else if (header.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) format = 'png';
    else if (header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WEBP') format = 'webp';
    else throw invalidFile();
  } finally { await input.close(); }
  try {
    // A single capped file buffer avoids libvips retaining Windows file handles.
    // Requests remain disk-spooled; this never buffers the whole image batch.
    const image = sharp(await readFile(file.path), { failOn: 'warning', limitInputPixels: 16_000_000, sequentialRead: true });
    const metadata = await image.metadata();
    if (metadata.format !== format || !metadata.width || !metadata.height || (metadata.pages ?? 1) !== 1) throw invalidFile();
    // Decode every pixel without generating a full output buffer. Metadata/magic
    // alone would allow files with truncated or corrupt raster data.
    await image.stats();
  } catch { throw invalidFile(); }
}

export async function receiveUpload(req: Request, policy: UploadPolicy, signal: AbortSignal) {
  if (!req.is('multipart/form-data') || (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity')) {
    throw new HttpError(400, 'INVALID_MULTIPART', 'Use multipart/form-data with image files');
  }
  const declared = Number(req.headers['content-length']);
  if (Number.isFinite(declared) && declared > policy.maxBodyBytes) throw new HttpError(413, 'UPLOAD_TOO_LARGE', 'Upload request exceeds the size limit');
  const directory = await mkdtemp(join(tmpdir(), 'webnovel-upload-'));
  const cleanup = async () => {
    // Verify the recursive deletion target is precisely our generated temp dir.
    const target = resolve(directory);
    if (dirname(target) !== resolve(tmpdir()) || !basename(target).startsWith('webnovel-upload-')) throw new Error('Unsafe temp cleanup path');
    await rm(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
  };
  const files: UploadFile[] = [];
  const writes: Promise<unknown>[] = [];
  const cancelWrites = new AbortController();
  let receiveFailure: HttpError | undefined;
  try {
    await new Promise<void>((done, reject) => {
      let parser: ReturnType<typeof busboy>;
      try {
        parser = busboy({ headers: req.headers, highWaterMark: 16384, fileHwm: 16384,
          limits: { files: policy.maxFiles, fields: 0, parts: policy.maxFiles + 1,
            fileSize: policy.maxFileBytes + 1, headerPairs: 50, fieldNameSize: 100 } });
      } catch { reject(new HttpError(400, 'INVALID_MULTIPART', 'Invalid multipart request')); return; }
      let failure: HttpError | undefined;
      let bytes = 0;
      const streams = new Set<import('node:stream').Readable>();
      const counter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(bytes > policy.maxBodyBytes ? new HttpError(413, 'UPLOAD_TOO_LARGE', 'Upload request exceeds the size limit') : null, chunk);
      } });
      const fail = (error: HttpError) => {
        if (failure) return;
        failure = error;
        receiveFailure = error;
        cancelWrites.abort();
        req.unpipe(counter); counter.unpipe(parser); counter.destroy();
        for (const file of streams) file.destroy();
        parser.destroy(error);
        req.resume();
        dispose();
        reject(error);
      };
      const abort = () => fail(new HttpError(400, 'UPLOAD_CANCELLED', 'Upload cancelled'));
      const timer = setTimeout(() => fail(new HttpError(408, 'UPLOAD_TIMEOUT', 'Upload request timed out')), 60000);
      const dispose = () => {
        clearTimeout(timer); signal.removeEventListener('abort', abort);
        req.removeListener('aborted', abort); req.removeListener('error', abort);
      };
      counter.on('error', (error) => fail(error instanceof HttpError ? error : new HttpError(400, 'INVALID_MULTIPART', 'Invalid multipart request')));
      parser.on('file', (field, file) => {
        streams.add(file); file.on('error', () => {});
        if (failure) { file.destroy(); return; }
        if (field !== policy.field) { fail(new HttpError(400, 'INVALID_MULTIPART', 'Unexpected upload field')); return; }
        const entry = { path: join(directory, randomUUID()), order: files.length + 1 };
        files.push(entry);
        file.once('limit', () => fail(new HttpError(413, 'UPLOAD_TOO_LARGE', 'An image exceeds the file size limit')));
        const sink = createWriteStream(entry.path, { flags: 'wx', mode: 0o600 });
        writes.push(pipeline(file, sink, { signal: cancelWrites.signal })
          .catch(() => fail(new HttpError(500, 'UPLOAD_IO_ERROR', 'Unable to process upload'))));
      });
      parser.once('filesLimit', () => fail(new HttpError(400, 'TOO_MANY_FILES', 'Too many uploaded files')));
      parser.once('fieldsLimit', () => fail(new HttpError(400, 'INVALID_MULTIPART', 'Text fields are not accepted')));
      parser.once('partsLimit', () => fail(new HttpError(400, 'TOO_MANY_FILES', 'Too many multipart parts')));
      parser.once('error', () => { dispose(); reject(failure ?? new HttpError(400, 'INVALID_MULTIPART', 'Invalid multipart request')); });
      parser.once('close', () => { dispose(); failure ? reject(failure) : done(); });
      req.once('aborted', abort); req.once('error', abort); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted || req.aborted) abort();
      else req.pipe(counter).pipe(parser);
    });
    await Promise.all(writes);
    if (receiveFailure) throw receiveFailure;
    if (!files.length) throw new HttpError(400, 'FILE_REQUIRED', 'At least one image file is required');
    return { files, cleanup };
  } catch (error) {
    await Promise.allSettled(writes);
    await cleanup();
    throw error;
  }
}
