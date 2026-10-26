import { randomUUID } from 'node:crypto';
import { cloudinaryStorage } from '../config/cloudinary';
import { validateImage } from '../middlewares/upload.validation';
import type { ImageStorage, UploadedImage, UploadFile, UploadKind } from '../types/upload.types';
import { HttpError } from '../utils/http-error';
import { withUploadSlot } from '../utils/upload-capacity';

const folders: Record<UploadKind, string> = { cover: 'webnovel/covers', 'chapter-pages': 'webnovel/chapter-pages' };
export function createUploadService(storage: ImageStorage = cloudinaryStorage) {
  return {
    assertReady() { storage.assertReady(); },
    async upload(kind: UploadKind, files: UploadFile[], signal: AbortSignal) {
      // Validate the entire batch before creating any external assets.
      for (const file of files) {
        if (signal.aborted) throw new HttpError(400, 'UPLOAD_CANCELLED', 'Upload cancelled');
        await validateImage(file);
      }
      const results: Array<UploadedImage & { order: number }> = new Array(files.length);
      let cursor = 0;
      let failed = false;
      await Promise.all(Array.from({ length: Math.min(2, files.length) }, async () => {
        while (!failed && cursor < files.length) {
          const index = cursor++;
          const file = files[index];
          try {
            const value = await withUploadSlot(async () => {
              if (signal.aborted) throw new Error('Upload cancelled');
              return storage.upload(file.path, folders[kind], randomUUID(), signal);
            });
            if (new URL(value.secureUrl).protocol !== 'https:' || !value.publicId) throw new Error('Invalid image storage response');
            // Whitelist fields; no SDK metadata, credentials or local paths.
            results[index] = { secureUrl: value.secureUrl, publicId: value.publicId, order: file.order };
          } catch { failed = true; }
        }
      }));
      if (failed) throw new HttpError(502, 'UPLOAD_FAILED', 'Image storage upload failed; please try again later');
      return results;
    },
  };
}
export type UploadService = ReturnType<typeof createUploadService>;
export const uploadService = createUploadService();
