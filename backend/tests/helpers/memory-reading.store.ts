import { randomUUID } from 'node:crypto';
import type { ChapterRecord } from '../../src/types/chapter.types';
import type { FavoriteEntry, HistoryEntry, ProgressEntry, ReadingQuery, ReadingStore, ReadingStory, ReadingTransaction } from '../../src/types/reading.types';
import type { MemoryAuthStore } from './memory-auth.store';

type Story = ReadingStory & { publishStatus: 'DRAFT' | 'PUBLISHED' };
type Owned<T> = T & { userId: string };
// All writes and rollback occur in memory. No real Prisma/Cloudinary calls.
export class MemoryReadingStore implements ReadingStore {
  stories = new Map<string, Story>();
  chapters = new Map<string, ChapterRecord>();
  favoriteRows: Owned<FavoriteEntry>[] = [];
  progressRows: Owned<ProgressEntry>[] = [];
  historyRows: Owned<HistoryEntry>[] = [];
  failCode: string | undefined;
  failCommit = false;
  calls = 0;
  private queue = Promise.resolve();
  constructor(private auth: MemoryAuthStore) {}
  private storyValue(id: string): ReadingStory {
    const s = this.stories.get(id)!;
    return { id: s.id, title: s.title, slug: s.slug, type: s.type, coverUrl: s.coverUrl, authorName: s.authorName };
  }
  private chapterValue(id: string) {
    const c = this.chapters.get(id)!; return { id: c.id, chapterNumber: c.chapterNumber, title: c.title };
  }
  private visible(storyId: string, chapterId?: string) {
    return this.stories.get(storyId)?.publishStatus === 'PUBLISHED' && (!chapterId || this.chapters.get(chapterId)?.publishStatus === 'PUBLISHED');
  }
  private result<T>(rows: Owned<T>[], query: ReadingQuery, time: (r: Owned<T>) => Date) {
    const sorted = [...rows].sort((a, b) => time(b).getTime() - time(a).getTime() || String((b as { id?: string }).id).localeCompare(String((a as { id?: string }).id)));
    return { data: sorted.slice((query.page - 1) * query.limit, query.page * query.limit).map(({ userId: _owner, ...r }) => r as T), total: rows.length };
  }
  private adapter(): ReadingTransaction {
    return {
      activeUser: async (id) => this.auth.users.get(id)?.status === 'ACTIVE',
      story: async (id) => this.stories.get(id) ?? null,
      chapter: async (id, storyId) => {
        const c = this.chapters.get(id); return c?.storyId === storyId ? c : null;
      },
      favorites: async (id, q) => this.result(this.favoriteRows.filter((r) => r.userId === id && this.visible(r.storyId)), q, (r) => r.createdAt),
      favoriteExists: async (id, storyId) => this.favoriteRows.some((r) => r.userId === id && r.storyId === storyId),
      addFavorite: async (userId, storyId) => {
        const row = { id: randomUUID(), userId, storyId, createdAt: new Date(), story: this.storyValue(storyId) };
        this.favoriteRows.push(row); const { userId: _owner, ...safe } = row; return safe;
      },
      removeFavorite: async (id, storyId) => {
        const before = this.favoriteRows.length;
        this.favoriteRows = this.favoriteRows.filter((r) => r.userId !== id || r.storyId !== storyId); return before - this.favoriteRows.length;
      },
      progressList: async (id, q) => this.result(this.progressRows.filter((r) => r.userId === id && this.visible(r.storyId, r.chapterId)), q, (r) => r.updatedAt),
      progress: async (id, storyId) => {
        const row = this.progressRows.find((r) => r.userId === id && r.storyId === storyId);
        if (!row) return null;
        const { userId: _owner, ...safe } = row; return safe;
      },
      saveProgress: async (userId, storyId, input, updatedAt) => {
        const row = this.progressRows.find((r) => r.userId === userId && r.storyId === storyId);
        const value = { id: row?.id ?? randomUUID(), userId, storyId, ...input, updatedAt, story: this.storyValue(storyId), chapter: this.chapterValue(input.chapterId) };
        if (row) this.progressRows[this.progressRows.indexOf(row)] = value; else this.progressRows.push(value);
        const { userId: _owner, ...safe } = value; return safe;
      },
      history: async (id, q) => this.result(this.historyRows.filter((r) => r.userId === id && this.visible(r.storyId, r.chapterId)), q, (r) => r.readAt),
      recentHistory: async (id, storyId, chapterId, since) => {
        const row = this.historyRows.filter((r) => r.userId === id && r.storyId === storyId && r.chapterId === chapterId && r.readAt >= since).sort((a,b) => b.readAt.getTime() - a.readAt.getTime())[0];
        if (!row) return null; const { userId: _owner, ...safe } = row; return safe;
      },
      addHistory: async (userId, storyId, chapterId, readAt) => {
        const row = { id: randomUUID(), userId, storyId, chapterId, readAt, story: this.storyValue(storyId), chapter: this.chapterValue(chapterId) };
        this.historyRows.push(row); const { userId: _owner, ...safe } = row; return safe;
      },
      clearHistory: async (id) => {
        const before = this.historyRows.length; this.historyRows = this.historyRows.filter((r) => r.userId !== id); return before - this.historyRows.length;
      },
    };
  }
  async transaction<T>(_userId: string, _mode: 'read' | 'write', work: (tx: ReadingTransaction) => Promise<T>): Promise<T> {
    const previous = this.queue; let release!: () => void;
    this.queue = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    const before = structuredClone({ favorites: this.favoriteRows, progress: this.progressRows, history: this.historyRows });
    try {
      this.calls++;
      if (this.failCode) throw Object.assign(new Error('PRIVATE_DATABASE_DETAILS'), { code: this.failCode });
      const value = await work(this.adapter());
      if (this.failCommit) throw new Error('PRIVATE_COMMIT_DETAILS');
      return value;
    } catch (e) {
      this.favoriteRows = before.favorites; this.progressRows = before.progress; this.historyRows = before.history; throw e;
    } finally { release(); }
  }
}
