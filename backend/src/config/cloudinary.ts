import 'dotenv/config';
import { createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { v2 as cloudinary } from 'cloudinary';
import { z } from 'zod';
import type { ImageStorage, UploadedImage } from '../types/upload.types';
import { HttpError } from '../utils/http-error';

function configuration() {
  const credential = z.string().min(1).max(512).refine((s) => !/^(your_|replace_|placeholder)/i.test(s));
  const result = z.object({ cloud_name: credential, api_key: credential, api_secret: credential }).safeParse({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
  });
  if (!result.success) throw new HttpError(503, 'UPLOAD_NOT_CONFIGURED', 'Cloudinary upload is not configured');
  return result.data;
}

export const cloudinaryStorage: ImageStorage = {
  assertReady() { configuration(); },
  async upload(path, folder, id, signal) {
    const credentials = configuration();
    if (signal.aborted) throw new Error('Upload cancelled');
    let resolveResponse!: (value: UploadedImage) => void;
    let rejectResponse!: (error: Error) => void;
    const response = new Promise<UploadedImage>((resolve, reject) => { resolveResponse = resolve; rejectResponse = reject; });
    const stream = cloudinary.uploader.upload_stream({
        ...credentials, folder, public_id: id, resource_type: 'image',
        overwrite: false, use_filename: false, unique_filename: false,
        allowed_formats: ['jpg', 'jpeg', 'png', 'webp'], timeout: 30000,
      }, (error, result) => {
        if (error || !result?.secure_url || !result.public_id) { rejectResponse(new Error('Cloudinary upload failed')); return; }
        resolveResponse({ secureUrl: result.secure_url, publicId: result.public_id });
      });
    const abort = () => stream.destroy(new Error('Upload cancelled'));
    signal.addEventListener('abort', abort, { once: true });
    // Keep the transfer slot until both the SDK response and local file stream
    // settle, including client aborts. Never remove a still-open Windows file.
    const transfer = pipeline(createReadStream(path), stream, { signal });
    void response.catch(() => stream.destroy(new Error('Cloudinary upload failed')));
    const guard = setTimeout(() => {
      stream.destroy(new Error('Upload timed out'));
      rejectResponse(new Error('Cloudinary upload failed'));
    }, 35000);
    try {
      const [remote, local] = await Promise.allSettled([response, transfer]);
      if (remote.status === 'rejected' || local.status === 'rejected') throw new Error('Cloudinary upload failed');
      return remote.value;
    } finally {
      clearTimeout(guard);
      signal.removeEventListener('abort', abort);
    }
  },
};
