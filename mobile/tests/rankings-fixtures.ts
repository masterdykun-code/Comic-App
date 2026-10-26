import type { RankedStory } from '../src/features/rankings/api';
export const rankedNovel: RankedStory = {
  id: '20000000-0000-4000-8000-000000000001',
  title: 'Tiểu thuyết nổi bật',
  authorName: 'Tác giả A',
  coverUrl: 'https://example.test/cover.png',
  type: 'NOVEL',
  updatedAt: '2026-10-24T00:00:00Z',
  rank: 1,
  readCount: 30,
  averageScore: 4.5,
  ratingCount: 2,
};
export const rankedComic: RankedStory = {
  ...rankedNovel,
  id: '20000000-0000-4000-8000-000000000002',
  title: 'Truyện tranh nổi bật',
  authorName: 'Tác giả B',
  type: 'COMIC',
  rank: 2,
  readCount: 20,
  averageScore: 4.2,
  ratingCount: 5,
};
export function rankingResult(
  data: RankedStory[],
  kind: 'reads' | 'rating' | 'updated' = 'reads',
  page = 1,
  total = data.length,
) {
  return {
    success: true as const,
    data,
    pagination: { page, limit: 20, total, totalPages: Math.ceil(total / 20) },
    ranking: { kind, readMetric: 'STORED_AUTHENTICATED_HISTORY' as const },
  };
}
