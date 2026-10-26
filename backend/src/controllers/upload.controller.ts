import type { RequestHandler } from 'express';
import type { UploadService } from '../services/upload.service';
import { receiveUpload } from '../middlewares/upload.validation';
import { uploadPolicies, type UploadKind } from '../types/upload.types';
import { HttpError } from '../utils/http-error';
import { UploadCapacity, uploadRequests } from '../utils/upload-capacity';

export function createUploadController(service: UploadService, capacity: UploadCapacity = uploadRequests) {
  const handler = (kind: UploadKind): RequestHandler => async (req, res) => {
    service.assertReady();
    const release = capacity.acquire();
    if (!release) {
      res.setHeader('Retry-After', '5');
      throw new HttpError(429, 'UPLOAD_BUSY', 'Upload capacity reached; try again later');
    }
    const abort = new AbortController();
    const cancel = () => { if (!res.writableFinished) abort.abort(); };
    res.once('close', cancel);
    let batch: Awaited<ReturnType<typeof receiveUpload>> | undefined;
    try {
      batch = await receiveUpload(req, uploadPolicies[kind], abort.signal);
      const values = await service.upload(kind, batch.files, abort.signal);
      await batch.cleanup();
      batch = undefined;
      if (kind === 'cover') {
        const { secureUrl, publicId } = values[0];
        res.status(201).json({ success: true, message: 'Cover uploaded', data: { secureUrl, publicId } });
      } else res.status(201).json({ success: true, message: 'Chapter images uploaded', data: values });
    } finally {
      try { await batch?.cleanup(); }
      finally { res.removeListener('close', cancel); release(); }
    }
  };
  return { cover: handler('cover'), chapterPages: handler('chapter-pages') };
}
