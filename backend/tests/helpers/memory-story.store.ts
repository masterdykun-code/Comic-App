import { randomUUID } from 'node:crypto';
import type { StoryRecord, StoryStore, StoryTransaction } from '../../src/types/story.types';
import type { MemoryAuthStore } from './memory-auth.store';
import type { ChapterRecord } from '../../src/types/chapter.types';

type Genre = StoryRecord['genres'][number];
const failure = (code: string) => Object.assign(new Error('Simulated persistence conflict'), { code });

export class MemoryStoryStore implements StoryStore {
  stories = new Map<string, StoryRecord>();
  genres = new Map<string, Genre>();
  chapters = new Map<string, ChapterRecord>();
  commitFailures: string[] = [];
  transactions = 0;
  private tail = Promise.resolve();

  constructor(private auth: MemoryAuthStore) {}

  async transaction<T>(work: (tx: StoryTransaction) => Promise<T>, _mode: 'read' | 'write'): Promise<T> {
    let release!: () => void;
    const previous = this.tail;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const snapshot = structuredClone(this.stories);
    const chapterSnapshot = structuredClone(this.chapters);
    this.transactions++;
    const tx: StoryTransaction = {
      adminIsActive: async (id) => {
        const user = this.auth.users.get(id);
        return user?.status === 'ACTIVE' && user.role === 'ADMIN';
      },
      list: async (query, admin) => {
        const found = [...this.stories.values()].filter((s) =>
          (admin ? !query.publishStatus || s.publishStatus === query.publishStatus : s.publishStatus === 'PUBLISHED') &&
          (!query.search || s.title.toLowerCase().includes(query.search.toLowerCase())) &&
          (!query.type || s.type === query.type) && (!query.status || s.status === query.status) &&
          (!query.genreId || s.genres.some((g) => g.id === query.genreId)));
        found.sort((a, b) => {
          const primary = query.sort === 'title' ? a.title.localeCompare(b.title) :
            query.sort === 'updated' ? b.updatedAt.getTime() - a.updatedAt.getTime() : b.createdAt.getTime() - a.createdAt.getTime();
          return primary || a.id.localeCompare(b.id);
        });
        return { data: structuredClone(found.slice((query.page - 1) * query.limit, query.page * query.limit)), total: found.length };
      },
      find: async (id) => structuredClone(this.stories.get(id) ?? null),
      genresExist: async (ids) => ids.every((id) => this.genres.has(id)),
      create: async (data, ids) => {
        if ([...this.stories.values()].some((s) => s.slug === data.slug)) throw failure('P2002');
        const story: StoryRecord = {
          ...data, id: randomUUID(), publishStatus: 'DRAFT', createdAt: new Date(), updatedAt: new Date(),
          chapterCount: 0, genres: ids.map((id) => this.genres.get(id)!),
        };
        this.stories.set(story.id, story);
        return structuredClone(story);
      },
      update: async (id, data, ids) => {
        const story = this.stories.get(id);
        if (!story) throw failure('P2025');
        Object.assign(story, data, { updatedAt: new Date() });
        if (ids !== undefined) story.genres = ids.map((genreId) => this.genres.get(genreId)!);
        return structuredClone(story);
      },
      remove: async id => {
        for (const [chapterId, chapter] of this.chapters) if (chapter.storyId === id) this.chapters.delete(chapterId);
        this.stories.delete(id);
      },
    };
    try {
      const result = await work(tx);
      const code = this.commitFailures.shift();
      if (code) throw failure(code);
      return result;
    } catch (error) {
      this.stories = snapshot;
      this.chapters = chapterSnapshot;
      throw error;
    } finally {
      release();
    }
  }
}
