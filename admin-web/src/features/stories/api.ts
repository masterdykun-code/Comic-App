import type { AxiosInstance } from 'axios';
import { z } from 'zod';
import { ApiError } from '../../lib/api/errors';
import { api } from '../auth/runtime';
import {
  storyFormSchema,
  storyId,
  type CoverUpload,
  type Genre,
  type Story,
  type StoryInput,
  type StoryList,
  type StoryQuery,
} from './model';

// Production uses the existing authenticated singleton; injection is only for tests.
export function createStoriesApi(client: AxiosInstance) {
  return {
    async list(query: StoryQuery, signal?: AbortSignal): Promise<StoryList> {
      const { data } = await client.get<StoryList>('/admin/stories', { params: query, signal });
      return data;
    },
    async detail(id: string, signal?: AbortSignal): Promise<Story> {
      storyId.parse(id);
      return (await client.get<{ data: Story }>(`/admin/stories/${id}`, { signal })).data.data;
    },
    async genres(signal?: AbortSignal): Promise<Genre[]> {
      return (await client.get<{ data: Genre[] }>('/genres', { signal })).data.data;
    },
    async create(input: StoryInput): Promise<Story> {
      return (await client.post<{ data: Story }>('/stories', storyFormSchema.parse(input))).data
        .data;
    },
    async update(id: string, input: StoryInput, typeLocked: boolean): Promise<Story> {
      storyId.parse(id);
      const { type, ...fields } = storyFormSchema.parse(input);
      return (
        await client.patch<{ data: Story }>(
          `/stories/${id}`,
          typeLocked ? fields : { ...fields, type },
        )
      ).data.data;
    },
    async publish(id: string): Promise<Story> {
      storyId.parse(id);
      return (await client.patch<{ data: Story }>(`/stories/${id}/publish`, {})).data.data;
    },
    async unpublish(id: string): Promise<Story> {
      storyId.parse(id);
      return (await client.patch<{ data: Story }>(`/admin/stories/${id}/unpublish`, {})).data.data;
    },
    async remove(id: string, expectedUpdatedAt: string): Promise<{ deleted: true }> {
      storyId.parse(id);
      z.iso.datetime({ offset: true }).parse(expectedUpdatedAt);
      const response = await client.delete(`/admin/stories/${id}`, {
        data: { confirm: true, expectedUpdatedAt },
      });
      if (response.data?.success !== true || response.data?.data?.deleted !== true)
        throw new ApiError(
          502,
          'Chưa xác nhận kết quả xóa. Hãy kiểm tra danh sách trước khi thao tác tiếp.',
        );
      return { deleted: true };
    },
    async upload(file: File): Promise<CoverUpload> {
      const form = new FormData();
      form.append('file', file);
      // Browser supplies the multipart boundary. Never replay uploads automatically.
      return (
        await client.post<{ data: CoverUpload }>('/admin/uploads/cover', form, { timeout: 45_000 })
      ).data.data;
    },
  };
}
export const storiesApi = createStoriesApi(api);
