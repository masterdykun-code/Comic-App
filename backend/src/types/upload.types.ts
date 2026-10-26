export type UploadKind = 'cover' | 'chapter-pages';
export interface UploadFile { path: string; order: number; }
export interface UploadedImage { secureUrl: string; publicId: string; }
export interface ImageStorage {
  assertReady(): void;
  upload(path: string, folder: string, id: string, signal: AbortSignal): Promise<UploadedImage>;
}
export interface UploadPolicy { field: string; maxFiles: number; maxFileBytes: number; maxBodyBytes: number; }
export const MiB = 1024 * 1024;
export const uploadPolicies: Record<UploadKind, UploadPolicy> = {
  cover: { field: 'file', maxFiles: 1, maxFileBytes: 5 * MiB, maxBodyBytes: 5 * MiB + 64 * 1024 },
  'chapter-pages': { field: 'files', maxFiles: 20, maxFileBytes: 10 * MiB, maxBodyBytes: 50 * MiB },
};
