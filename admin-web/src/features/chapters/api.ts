import type { AxiosInstance } from 'axios';
import { api } from '../auth/runtime';
import { ApiError, safeError } from '../../lib/api/errors';
import { storyId } from '../stories/model';
import {
  chapterInputSchema,
  batchPayloadLimit,
  imageError,
  type Chapter,
  type ChapterInput,
  type ChapterList,
  type PageInput,
  type UploadedPage,
} from './model';

export function createChaptersApi(client: AxiosInstance) {
  const detail = async (id: string, signal?: AbortSignal): Promise<Chapter> => {
    storyId.parse(id);
    return (await client.get<{ data: Chapter }>(`/admin/chapters/${id}`, { signal })).data.data;
  };
  async function checkVersion(id: string, expectedUpdatedAt: string) {
    const current = await detail(id);
    if (current.updatedAt !== expectedUpdatedAt)
      throw new ApiError(
        409,
        'Chương đã được thay đổi. Hãy tải lại dữ liệu trước khi lưu.',
        'CHAPTER_STALE',
      );
  }
  return {
    detail,

    async vip(id: string, isVip: boolean, coinPrice: number, version: string): Promise<Chapter> {
      storyId.parse(id);
      if (
        typeof isVip !== 'boolean' ||
        !Number.isInteger(coinPrice) ||
        coinPrice < 1 ||
        coinPrice > 100000
      )
        throw new ApiError(400, 'Giá Coin không hợp lệ.');
      await checkVersion(id, version);
      return (
        await client.patch<{ data: Chapter }>(`/admin/chapters/${id}`, {
          isVip,
          coinPrice,
          expectedUpdatedAt: version,
        })
      ).data.data;
    },
    async list(
      id: string,
      page: number,
      limit: number,
      signal?: AbortSignal,
    ): Promise<ChapterList> {
      storyId.parse(id);
      return (
        await client.get<ChapterList>(`/admin/stories/${id}/chapters`, {
          params: { page, limit },
          signal,
        })
      ).data;
    },
    async create(id: string, input: ChapterInput): Promise<Chapter> {
      storyId.parse(id);
      return (
        await client.post<{ data: Chapter }>(
          `/admin/stories/${id}/chapters`,
          chapterInputSchema.parse(input),
        )
      ).data.data;
    },
    async update(id: string, input: ChapterInput, version: string): Promise<Chapter> {
      storyId.parse(id);
      const body = chapterInputSchema.parse(input);
      await checkVersion(id, version);
      return (
        await client.patch<{ data: Chapter }>(`/admin/chapters/${id}`, {
          ...body,
          expectedUpdatedAt: version,
        })
      ).data.data;
    },
    async pages(id: string, pages: PageInput[], version: string): Promise<Chapter> {
      storyId.parse(id);
      await checkVersion(id, version);
      return (
        await client.put<{ data: Chapter }>(`/admin/chapters/${id}/pages`, {
          pages,
          expectedUpdatedAt: version,
        })
      ).data.data;
    },
    async publish(id: string, version: string): Promise<Chapter> {
      storyId.parse(id);
      await checkVersion(id, version);
      return (
        await client.patch<{ data: Chapter }>(`/admin/chapters/${id}/publish`, {
          expectedUpdatedAt: version,
        })
      ).data.data;
    },
    async upload(files: File[], onProgress?: (percent: number) => void): Promise<UploadedPage[]> {
      if (
        !files.length ||
        files.length > 20 ||
        files.some((f) => imageError(f)) ||
        files.reduce((sum, f) => sum + f.size, 0) > batchPayloadLimit
      )
        throw new ApiError(
          400,
          'Batch ảnh không hợp lệ: tối đa 20 ảnh, mỗi ảnh 10 MiB, tổng dưới 50 MiB.',
        );
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      const result = (
        await client
          .post<{ data: UploadedPage[] }>('/admin/uploads/chapter-pages', form, {
            timeout: 120000,
            onUploadProgress: (event) => {
              if (event.total)
                onProgress?.(Math.min(99, Math.round((event.loaded / event.total) * 100)));
            },
          })
          .catch((error: unknown) => {
            const failure = safeError(error);
            if (failure.code === 'UPLOAD_TOO_LARGE')
              throw new ApiError(
                413,
                'Ảnh hoặc batch vượt giới hạn: mỗi ảnh 10 MiB, toàn request 50 MiB.',
                failure.code,
              );
            throw failure;
          })
      ).data.data;
      if (
        !Array.isArray(result) ||
        result.length !== files.length ||
        result.some(
          (p) =>
            !Number.isInteger(p.order) ||
            p.order < 1 ||
            p.order > files.length ||
            !p.publicId ||
            !p.secureUrl?.startsWith('https://'),
        ) ||
        new Set(result.map((p) => p.order)).size !== files.length
      )
        throw new ApiError(
          502,
          'Phản hồi upload không đầy đủ. Hãy kiểm tra Cloudinary trước khi tải lại.',
        );
      onProgress?.(100);
      return [...result].sort((a, b) => a.order - b.order);
    },
  };
}
export const chaptersApi = createChaptersApi(api);
