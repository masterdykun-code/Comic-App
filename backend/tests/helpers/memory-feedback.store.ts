import { randomUUID } from 'node:crypto';
import type { CommentEntry, FeedbackQuery, FeedbackStore, FeedbackTransaction, RatingEntry } from '../../src/types/feedback.types';
import type { MemoryAuthStore } from './memory-auth.store';
import { THREAD_REPLY_LIMIT } from '../../src/services/feedback.store';

type OwnedRating = RatingEntry & { userId: string };
export class MemoryFeedbackStore implements FeedbackStore {
  stories = new Map<string, { id: string; publishStatus: 'DRAFT' | 'PUBLISHED' }>();
  ratingRows: OwnedRating[] = [];
  commentRows: CommentEntry[] = [];
  failCode: string | undefined;
  failCommits = 0;
  calls = 0;
  private tail = Promise.resolve();
  constructor(private auth: MemoryAuthStore) {}
  private user(id: string) {
    const u = this.auth.users.get(id)!; return { username: u.username, displayName: u.displayName, avatarUrl: u.avatarUrl };
  }
  private order<T extends { id: string; createdAt: Date }>(rows: T[], sort: FeedbackQuery['sort']) {
    return [...rows].sort((a, b) => (a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)) * (sort === 'oldest' ? 1 : -1));
  }
  private page<T>(rows: T[], q: FeedbackQuery) { return { data: rows.slice((q.page - 1) * q.limit, q.page * q.limit), total: rows.length }; }
  private adapter(): FeedbackTransaction {
    return {
      activeUser: async (id, admin = false) => {
        const u = this.auth.users.get(id); return u?.status === 'ACTIVE' && (!admin || u.role === 'ADMIN');
      },
      story: async (id) => this.stories.get(id) ?? null,
      ratings: async (storyId, query) => {
        const rows = this.ratingRows.filter((r) => r.storyId === storyId);
        const distribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
        for (const r of rows) distribution[r.score as 1 | 2 | 3 | 4 | 5]++;
        const data = this.order(rows, query.sort).map(({ userId: _owner, ...r }) => r);
        return { ...this.page(data, query), summary: { averageScore: rows.length ? Number((rows.reduce((sum, r) => sum + r.score, 0) / rows.length).toFixed(2)) : null, totalRatings: rows.length, distribution } };
      },
      saveRating: async (userId, storyId, input) => {
        let row = this.ratingRows.find((r) => r.userId === userId && r.storyId === storyId);
        if (row) { row.score = input.score; if (input.reviewText !== undefined) row.reviewText = input.reviewText; row.updatedAt = new Date(); }
        else { row = { id: randomUUID(), userId, storyId, score: input.score, reviewText: input.reviewText ?? null, createdAt: new Date(), updatedAt: new Date(), user: this.user(userId) }; this.ratingRows.push(row); }
        const { userId: _owner, ...safe } = row; return safe;
      },
      deleteRating: async (userId, storyId) => {
        const before = this.ratingRows.length; this.ratingRows = this.ratingRows.filter((r) => r.userId !== userId || r.storyId !== storyId); return before - this.ratingRows.length;
      },
      roots: async (storyId, q) => {
        const roots = this.order(this.commentRows.filter((r) => r.storyId === storyId && r.status === 'VISIBLE' && r.parentId === null), q.sort);
        const result = this.page(roots, q);
        return { ...result, data: result.data.map((root) => {
          const replies = this.order(this.commentRows.filter((r) => r.parentId === root.id && r.storyId === storyId && r.status === 'VISIBLE'), 'oldest');
          return { ...root, replies: replies.slice(0, THREAD_REPLY_LIMIT), replyCount: replies.length };
        }) };
      },
      replies: async (parentId, storyId, q) => this.page(this.order(this.commentRows.filter((r) => r.parentId === parentId && r.storyId === storyId && r.status === 'VISIBLE'), q.sort), q),
      commentStoryId: async (id) => this.commentRows.find((r) => r.id === id)?.storyId ?? null,
      comment: async (id, storyId) => this.commentRows.find((r) => r.id === id && r.storyId === storyId) ?? null,
      createComment: async (userId, storyId, input) => {
        const row: CommentEntry = { id: randomUUID(), userId, storyId, content: input.content, parentId: input.parentId ?? null, status: 'VISIBLE', createdAt: new Date(), updatedAt: new Date(), user: this.user(userId) };
        this.commentRows.push(row); return row;
      },
      editComment: async (id, content) => { const row = this.commentRows.find((r) => r.id === id)!; row.content = content; row.updatedAt = new Date(); return row; },
      replyCount: async (id) => this.commentRows.filter((r) => r.parentId === id).length,
      deleteComment: async (id) => { this.commentRows = this.commentRows.filter((r) => r.id !== id); },
      moderate: async (id, status) => { const row = this.commentRows.find((r) => r.id === id)!; row.status = status; row.updatedAt = new Date(); return row; },
    };
  }
  async transaction<T>(_storyId: string | null, _mode: 'read' | 'write', work: (tx: FeedbackTransaction) => Promise<T>): Promise<T> {
    let release!: () => void; const before = this.tail; this.tail = new Promise<void>((resolve) => { release = resolve; });
    await before;
    const snapshot = structuredClone({ ratings: this.ratingRows, comments: this.commentRows });
    try {
      this.calls++;
      if (this.failCode) throw Object.assign(new Error('PRIVATE_DATABASE_DETAIL'), { code: this.failCode });
      const result = await work(this.adapter());
      if (this.failCommits > 0) { this.failCommits--; throw new Error('PRIVATE_COMMIT_DETAIL'); }
      return result;
    } catch (e) { this.ratingRows = snapshot.ratings; this.commentRows = snapshot.comments; throw e; }
    finally { release(); }
  }
}
