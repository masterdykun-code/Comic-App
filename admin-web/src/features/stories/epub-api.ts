import { z } from 'zod';
import { api } from '../auth/runtime';
import { ApiError } from '../../lib/api/errors';
const result = z.object({ id: z.uuid(), chapterCount: z.number().int().positive() });
const preview = z.object({
  previewId: z.uuid(),
  expiresAt: z.string(),
  title: z.string(),
  authorName: z.string(),
  chapterCount: z.number().int().positive().max(2000),
  duplicate: z.boolean(),
  warnings: z.array(z.string()),
  sample: z.string(),
  coverDataUrl: z.string().nullable(),
  chapters: z
    .array(
      z.object({
        chapterNumber: z.number().int().positive(),
        title: z.string(),
        characters: z.number().int().positive(),
      }),
    )
    .max(2000),
});
export type EpubPreview = z.infer<typeof preview>;
export type EpubResult = z.infer<typeof result>;
export type EpubInput = {
  title: string;
  authorName: string;
  description: string;
  genreIds: string[];
  useCover: boolean;
};
function checked<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new ApiError(502, 'Phản hồi nhập EPUB chưa hợp lệ.');
  return parsed.data;
}
export const epubApi = {
  async preview(file: File): Promise<EpubPreview> {
    const form = new FormData();
    form.append('file', file);
    return checked(
      preview,
      (await api.post<{ data: unknown }>('/admin/epub-imports/preview', form, { timeout: 90_000 }))
        .data.data,
    );
  },
  async confirm(id: string, input: EpubInput): Promise<EpubResult> {
    return checked(
      result,
      (
        await api.post<{ data: unknown }>(
          `/admin/epub-imports/${z.uuid().parse(id)}/confirm`,
          input,
          { timeout: 90_000 },
        )
      ).data.data,
    );
  },
  async status(id: string) {
    return checked(
      z.object({
        status: z.enum(['ready', 'pending', 'imported', 'unknown']),
        result: result.nullable(),
      }),
      (await api.get<{ data: unknown }>(`/admin/epub-imports/${z.uuid().parse(id)}`)).data.data,
    );
  },
  async cancel(id: string) {
    await api.delete(`/admin/epub-imports/${z.uuid().parse(id)}`);
  },
};
