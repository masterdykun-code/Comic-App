import { getPrismaClient } from '../config/prisma';
import { Prisma } from '../generated/prisma/client';
import type { GenreStoriesQuery } from '../types/genre.types';
import { HttpError } from '../utils/http-error';

const genreSelect = {
  id: true,
  name: true,
  slug: true,
  createdAt: true,
} satisfies Prisma.GenreSelect;

export async function listGenres() {
  return getPrismaClient().genre.findMany({
    select: genreSelect,
    orderBy: [{ name: 'asc' }, { id: 'asc' }],
  });
}

export async function getGenreById(id: string) {
  const genre = await getPrismaClient().genre.findUnique({
    where: { id },
    select: genreSelect,
  });
  if (!genre) throw new HttpError(404, 'GENRE_NOT_FOUND', 'Genre not found');
  return genre;
}

export async function listGenreStories(genreId: string, query: GenreStoriesQuery) {
  const { page, limit, type } = query;
  const where: Prisma.StoryWhereInput = {
    publishStatus: 'PUBLISHED',
    genres: { some: { genreId } },
    ...(type ? { type } : {}),
  };

  // One consistent snapshot for existence, count and page; all operations read only.
  return getPrismaClient().$transaction(async (tx) => {
    const genre = await tx.genre.findUnique({ where: { id: genreId }, select: { id: true } });
    if (!genre) throw new HttpError(404, 'GENRE_NOT_FOUND', 'Genre not found');

    const total = await tx.story.count({ where });
    const data = await tx.story.findMany({
      where,
      skip: (page - 1) * limit,
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      // Only public story metadata. No creator/user fields or chapter content.
      select: {
        id: true,
        title: true,
        slug: true,
        type: true,
        authorName: true,
        description: true,
        coverUrl: true,
        status: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    return { data, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
}
