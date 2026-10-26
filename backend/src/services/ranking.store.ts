import { Prisma, type PrismaClient } from '../generated/prisma/client';
import { getPrismaClient } from '../config/prisma';
import type { RankedStory, RankingStore } from '../types/ranking.types';
type SqlStory = Omit<RankedStory, 'rank' | 'readCount' | 'ratingCount'> & {
  rank: bigint;
  readCount: bigint;
  ratingCount: bigint;
};
function count(value: bigint) {
  const result = Number(value);
  if (!Number.isSafeInteger(result) || result < 0)
    throw Error('Invalid ranking count');
  return result;
}
export function createPrismaRankingStore(
  client: () => PrismaClient = getPrismaClient,
): RankingStore {
  return {
    list(query) {
      return client().$transaction(
        async (tx) => {
          const total = await tx.story.count({
            where: {
              publishStatus: 'PUBLISHED',
              ...(query.type ? { type: query.type } : {}),
              ...(query.kind === 'rating' ? { ratings: { some: {} } } : {}),
            },
          });
          // Sort clauses are static SQL fragments, never interpolated client text.
          const order =
            query.kind === 'reads'
              ? Prisma.sql`read_count DESC, updated_at DESC, id ASC`
              : query.kind === 'rating'
                ? Prisma.sql`average_score DESC NULLS LAST, rating_count DESC, updated_at DESC, id ASC`
                : Prisma.sql`updated_at DESC, id ASC`;
          const rows = await tx.$queryRaw<SqlStory[]>(Prisma.sql`
          WITH read_counts AS (
            SELECT h.story_id, count(*) AS read_count
            FROM public.reading_history h
            JOIN public.chapters c ON c.id=h.chapter_id AND c.story_id=h.story_id
            WHERE c.publish_status='PUBLISHED'
            GROUP BY h.story_id
          ), rating_scores AS (
            SELECT story_id, avg(score) AS average_score, count(*) AS rating_count
            FROM public.ratings GROUP BY story_id
          ), eligible AS (
            SELECT s.id,s.title,s.author_name,s.cover_url,s.type,s.updated_at,
              coalesce(r.read_count,0::bigint) AS read_count,
              v.average_score,coalesce(v.rating_count,0::bigint) AS rating_count
            FROM public.stories s
            LEFT JOIN read_counts r ON r.story_id=s.id
            LEFT JOIN rating_scores v ON v.story_id=s.id
            WHERE s.publish_status='PUBLISHED'
              ${query.type ? Prisma.sql`AND s.type=${query.type}::public.story_type` : Prisma.empty}
              ${query.kind === 'rating' ? Prisma.sql`AND v.rating_count>0` : Prisma.empty}
          )
          SELECT id,title,author_name AS "authorName",cover_url AS "coverUrl",type,
            updated_at AS "updatedAt",row_number() OVER (ORDER BY ${order}) AS rank,
            read_count AS "readCount",round(average_score,2)::double precision AS "averageScore",
            rating_count AS "ratingCount"
          FROM eligible ORDER BY ${order}
          LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
        `);
          return {
            total,
            data: rows.map((row) => ({
              ...row,
              rank: count(row.rank),
              readCount: count(row.readCount),
              ratingCount: count(row.ratingCount),
            })),
          };
        },
        { isolationLevel: 'RepeatableRead', maxWait: 5000, timeout: 10000 },
      );
    },
  };
}
export const prismaRankingStore = createPrismaRankingStore();
