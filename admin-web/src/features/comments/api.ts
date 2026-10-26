import type { AxiosInstance } from 'axios';
import { api } from '../auth/runtime';
import { storyId } from '../stories/model';
import type { CommentList, CommentQuery, CommentStatus } from './model';
export function createCommentsApi(client: AxiosInstance) {
  return {
    async list(query: CommentQuery, signal?: AbortSignal): Promise<CommentList> {
      return (await client.get<CommentList>('/admin/comments', { params: query, signal })).data;
    },
    async moderate(
      id: string,
      status: CommentStatus,
    ): Promise<{ id: string; storyId: string; status: CommentStatus; updatedAt: string }> {
      storyId.parse(id);
      return (
        await client.patch<{
          data: { id: string; storyId: string; status: CommentStatus; updatedAt: string };
        }>(`/admin/comments/${id}/moderate`, { status })
      ).data.data;
    },
  };
}
export const commentsApi = createCommentsApi(api);
