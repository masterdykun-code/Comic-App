import type { Request, RequestHandler } from 'express';
import { z } from 'zod';
import { receiveUpload } from '../middlewares/upload.validation';
import { UploadCapacity } from '../utils/upload-capacity';
import { HttpError } from '../utils/http-error';
import type { EpubImportService } from '../services/epub-import.service';

const metadata = z.strictObject({
  title: z.string().trim().min(1).max(200),
  authorName: z.string().trim().min(1).max(100),
  description: z.string().trim().max(10000).default(''),
  genreIds: z
    .array(z.uuid())
    .max(50)
    .refine((v) => new Set(v).size === v.length)
    .default([]),
  useCover: z.boolean().default(true),
});
function origin(req: Request) {
  const url = new URL(
    process.env.EPUB_PUBLIC_BASE_URL || `${req.protocol}://${req.get('host')}`,
  );
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !['', '/'].includes(url.pathname)
  )
    throw new HttpError(
      500,
      'EPUB_CONFIG',
      'Cấu hình địa chỉ bìa EPUB chưa hợp lệ.',
    );
  return url.origin;
}
export function createEpubImportController(
  service: EpubImportService,
  capacity = new UploadCapacity(1),
) {
  const preview: RequestHandler = async (req, res) => {
    const release = capacity.acquire();
    if (!release)
      throw new HttpError(429, 'UPLOAD_BUSY', 'Đang xử lý EPUB khác.');
    const abort = new AbortController();
    const cancel = () => {
      if (!res.writableFinished) abort.abort();
    };
    res.once('close', cancel);
    let batch: Awaited<ReturnType<typeof receiveUpload>> | undefined;
    try {
      batch = await receiveUpload(
        req,
        {
          field: 'file',
          maxFiles: 1,
          maxFileBytes: 25 * 1024 * 1024,
          maxBodyBytes: 26 * 1024 * 1024,
        },
        abort.signal,
      );
      const data = await service.preview(
        batch.files[0]!.path,
        res.locals.auth.user.id,
      );
      res.json({ success: true, message: 'EPUB preview ready', data });
    } finally {
      try {
        await batch?.cleanup();
      } finally {
        res.removeListener('close', cancel);
        release();
      }
    }
  };
  const confirm: RequestHandler = async (req, res) => {
    const parsed = metadata.safeParse(req.body);
    if (!parsed.success)
      throw new HttpError(400, 'INVALID_BODY', 'Thông tin truyện chưa hợp lệ.');
    const data = await service.confirm(
      String(req.params.id),
      res.locals.auth.user.id,
      parsed.data,
      origin(req),
    );
    res
      .status(201)
      .json({ success: true, message: 'EPUB imported as draft', data });
  };
  const cancel: RequestHandler = (req, res) => {
    service.cancel(String(req.params.id), res.locals.auth.user.id);
    res.json({ success: true, message: 'Preview discarded' });
  };
  const status: RequestHandler = (req, res) => {
    res.json({
      success: true,
      data: service.status(String(req.params.id), res.locals.auth.user.id),
    });
  };
  return { preview, confirm, cancel, status };
}
