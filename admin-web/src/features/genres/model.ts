import { z } from 'zod';
export const genreInputSchema = z
  .object({
    name: z
      .string()
      .trim()
      .normalize('NFC')
      .min(1, 'Vui lòng nhập tên thể loại.')
      .max(100, 'Tên tối đa 100 ký tự.')
      .refine(
        (v) =>
          [...v].every((char) => {
            const code = char.charCodeAt(0);
            return code > 31 && (code < 127 || code > 159) && char !== '<' && char !== '>';
          }) && v.replace(/[\s\p{Cf}]/gu, '').length > 0,
        'Tên thể loại không hợp lệ.',
      ),
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .min(1, 'Vui lòng nhập slug.')
      .max(120, 'Slug tối đa 120 ký tự.')
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug chỉ gồm chữ a–z, số và dấu gạch nối giữa các từ.'),
  })
  .strict();
export type GenreInput = z.infer<typeof genreInputSchema>;
export function genreSlug(name: string) {
  return name
    .trim()
    .toLowerCase()
    .replace(/đ/g, 'd')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
    .replace(/-$/, '');
}
