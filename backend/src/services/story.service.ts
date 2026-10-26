import { randomUUID } from 'node:crypto';
import { publicationSchema } from '../middlewares/story.validation';
import type { StoryCreateInput, StoryDeleteInput, StoryListQuery, StoryRecord, StoryStore, StoryTransaction, StoryUpdateInput } from '../types/story.types';
import { HttpError } from '../utils/http-error';
import { isTransactionConflict } from '../utils/transaction-conflict';
import { prismaStoryStore } from './story.store';

function slugBase(title: string) {
  return title.toLowerCase().replace(/đ/g, 'd').normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 160).replace(/-$/, '') || 'story';
}
function publicMetadata(row: StoryRecord) {
  const { createdBy: _creator, publishStatus: _publication, chapterCount: _chapters, ...data } = row;
  return data;
}
function assertPublishable(row: StoryRecord) {
  const result = publicationSchema.safeParse({
    title: row.title, type: row.type, authorName: row.authorName,
    description: row.description, coverUrl: row.coverUrl, status: row.status,
    genreIds: row.genres.map((g) => g.id),
  });
  if (!result.success) throw new HttpError(400, 'STORY_NOT_PUBLISHABLE', 'Publishing requires valid title, author, description, cover URL and at least one genre');
}
function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error ? error.code : undefined;
}
const missing = () => new HttpError(404, 'STORY_NOT_FOUND', 'Story not found');

export function createStoryService(store: StoryStore = prismaStoryStore) {
  async function write<T>(userId: string, work: (tx: StoryTransaction, attempt: number) => Promise<T>, retrySlug = false, deleting = false): Promise<T> {
    for (let attempt = 0; attempt < 5; attempt++) {
      try {
        return await store.transaction(async (tx) => {
          if (!await tx.adminIsActive(userId)) throw new HttpError(403, 'FORBIDDEN', 'An active ADMIN account is required');
          return work(tx, attempt);
        }, 'write');
      } catch (error) {
        const code = errorCode(error);
        if (isTransactionConflict(error) || (retrySlug && code === 'P2002')) {
          if (attempt < 4) continue;
          throw new HttpError(409, 'STORY_WRITE_CONFLICT', 'Concurrent story update conflict; please retry');
        }
        if (code === 'P2003') {
          if (deleting) throw new HttpError(409, 'STORY_DELETE_CONFLICT', 'Related data changed; reload the story before deleting');
          throw new HttpError(400, 'INVALID_GENRES', 'One or more genres no longer exist');
        }
        if (code === 'P2025') throw missing();
        throw error;
      }
    }
    throw new HttpError(409, 'STORY_WRITE_CONFLICT', 'Please retry');
  }
  return {
    async list(query: StoryListQuery, adminUserId?: string) {
      return store.transaction(async (tx) => {
        if (adminUserId && !await tx.adminIsActive(adminUserId)) throw new HttpError(403, 'FORBIDDEN', 'An active ADMIN account is required');
        const { data, total } = await tx.list(query, Boolean(adminUserId));
        return {
          data: adminUserId ? data : data.map(publicMetadata),
          pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
        };
      }, 'read');
    },
    async adminDetail(id: string, adminUserId: string) {
      return store.transaction(async (tx) => {
        if (!await tx.adminIsActive(adminUserId)) throw new HttpError(403, 'FORBIDDEN', 'An active ADMIN account is required');
        const row = await tx.find(id);
        if (!row) throw missing();
        return row;
      }, 'read');
    },
    async detail(id: string) {
      return store.transaction(async (tx) => {
        const row = await tx.find(id);
        if (!row || row.publishStatus !== 'PUBLISHED') throw missing();
        return publicMetadata(row);
      }, 'read');
    },
    create(userId: string, input: StoryCreateInput) {
      return write(userId, async (tx, attempt) => {
        const genres = input.genreIds ?? [];
        if (!await tx.genresExist(genres)) throw new HttpError(400, 'INVALID_GENRES', 'One or more genres do not exist');
        const base = slugBase(input.title);
        return tx.create({
          title: input.title, type: input.type, authorName: input.authorName,
          description: input.description ?? '', coverUrl: input.coverUrl ?? '', status: input.status ?? 'ONGOING',
          slug: attempt ? `${base}-${randomUUID()}` : base, createdBy: userId,
        }, genres);
      }, true);
    },
    update(userId: string, id: string, input: StoryUpdateInput) {
      return write(userId, async (tx) => {
        const current = await tx.find(id, true);
        if (!current) throw missing();
        if (input.type && input.type !== current.type && current.chapterCount > 0) {
          throw new HttpError(409, 'STORY_TYPE_LOCKED', 'Cannot change story type after chapters exist');
        }
        const { genreIds, ...data } = input;
        if (genreIds !== undefined && !await tx.genresExist(genreIds)) throw new HttpError(400, 'INVALID_GENRES', 'One or more genres do not exist');
        const updated = await tx.update(id, data, genreIds);
        // Failure rolls back both metadata and relation replacements.
        if (updated.publishStatus === 'PUBLISHED') assertPublishable(updated);
        return updated;
      });
    },
    publish(userId: string, id: string) {
      return write(userId, async (tx) => {
        const current = await tx.find(id, true);
        if (!current) throw missing();
        assertPublishable(current);
        return current.publishStatus === 'PUBLISHED' ? current : tx.update(id, { publishStatus: 'PUBLISHED' });
      });
    },
    unpublish(userId: string, id: string) {
      return write(userId, async tx => {
        const current = await tx.find(id, true);
        if (!current) throw missing();
        return current.publishStatus === 'DRAFT' ? current : tx.update(id, { publishStatus: 'DRAFT' });
      });
    },
    remove(userId: string, id: string, input: StoryDeleteInput) {
      return write(userId, async tx => {
        const current = await tx.find(id, true);
        if (!current) throw missing();
        if (input.confirm !== true) throw new HttpError(400, 'CONFIRMATION_REQUIRED', 'Explicit deletion confirmation is required');
        if (current.updatedAt.getTime() !== new Date(input.expectedUpdatedAt).getTime())
          throw new HttpError(409, 'STORY_STALE', 'Story changed; reload before confirming deletion');
        await tx.remove(id);
        return { deleted: true };
      }, false, true);
    },
  };
}
export type StoryService = ReturnType<typeof createStoryService>;
export const storyService = createStoryService();
