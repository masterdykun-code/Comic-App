import type { AxiosInstance } from 'axios';
import { api } from '../auth/runtime';
import { storyId, type Genre } from '../stories/model';
import { genreInputSchema, type GenreInput } from './model';
export function createGenresApi(client: AxiosInstance) {
  return {
    async create(input: GenreInput): Promise<Genre> {
      return (await client.post<{ data: Genre }>('/admin/genres', genreInputSchema.parse(input)))
        .data.data;
    },
    async update(id: string, input: GenreInput): Promise<Genre> {
      storyId.parse(id);
      return (
        await client.patch<{ data: Genre }>(`/admin/genres/${id}`, genreInputSchema.parse(input))
      ).data.data;
    },
    async remove(id: string): Promise<{ id: string; removed: boolean }> {
      storyId.parse(id);
      return (
        await client.delete<{ data: { id: string; removed: boolean } }>(`/admin/genres/${id}`)
      ).data.data;
    },
  };
}
export const genresApi = createGenresApi(api);
