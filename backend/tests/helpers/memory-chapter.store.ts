import { randomUUID } from 'node:crypto';
import type { ChapterRecord, ChapterStore, ChapterTransaction } from '../../src/types/chapter.types';
import { MemoryStoryStore } from './memory-story.store';

const conflict = () => Object.assign(new Error('Simulated unique conflict'), { code: 'P2002' });

// Shares transaction queue/snapshots with Stories, so cross-module tests do not
// connect to PostgreSQL and rollback restores parent, chapters and pages.
export class MemoryChapterStore implements ChapterStore {
  failPageInsert = false;
  constructor(public stories: MemoryStoryStore) {}
  get chapters() { return this.stories.chapters; }

  transaction<T>(work: (tx: ChapterTransaction) => Promise<T>, mode: 'read' | 'write'): Promise<T> {
    return this.stories.transaction(async (storyTx) => {
      const tx: ChapterTransaction = {
        adminIsActive: storyTx.adminIsActive,
        story: async (id) => {
          const story = this.stories.stories.get(id);
          return story ? { id, type: story.type, publishStatus: story.publishStatus } : null;
        },
        chapterStoryId: async (id) => this.chapters.get(id)?.storyId ?? null,
        chapter: async (id) => structuredClone(this.chapters.get(id) ?? null),
        list: async (storyId, query, admin) => {
          const all = [...this.chapters.values()].filter((c) => c.storyId === storyId && (admin || c.publishStatus === 'PUBLISHED'))
            .sort((a, b) => a.chapterNumber - b.chapterNumber || a.id.localeCompare(b.id));
          return { total: all.length, data: all.slice((query.page - 1) * query.limit, query.page * query.limit)
            .map(({ content: _content, pages: _pages, ...metadata }) => structuredClone(metadata)) };
        },
        create: async (storyId, input) => {
          if ([...this.chapters.values()].some(c => c.storyId === storyId && c.chapterNumber === input.chapterNumber)) throw conflict();
          const row: ChapterRecord = {
            id: randomUUID(), storyId, chapterNumber: input.chapterNumber, title: input.title,
            content: input.content ?? null, isVip: input.isVip ?? false, coinPrice: input.coinPrice ?? 10, publishStatus: 'DRAFT', createdAt: new Date(), updatedAt: new Date(), pages: [],
          };
          this.chapters.set(row.id, row);
          this.stories.stories.get(storyId)!.chapterCount++;
          return structuredClone(row);
        },
        update: async (id, input, updatedAt) => {
          const current = this.chapters.get(id)!;
          if (input.chapterNumber !== undefined && [...this.chapters.values()].some(c =>
            c.id !== id && c.storyId === current.storyId && c.chapterNumber === input.chapterNumber)) throw conflict();
          Object.assign(current, input, { updatedAt: updatedAt ?? new Date() });
          return structuredClone(current);
        },
        replacePages: async (id, pages, updatedAt) => {
          const chapter = this.chapters.get(id)!;
          chapter.pages = [];
          if (this.failPageInsert) { this.failPageInsert = false; throw new Error('Simulated page insertion failure'); }
          chapter.pages = pages.map((p) => ({ ...p, id: randomUUID(), chapterId: id, storagePublicId: p.storagePublicId ?? null, createdAt: new Date() }));
          chapter.updatedAt = updatedAt ?? new Date();
          return structuredClone(chapter);
        },
        touchStory: async (id) => { this.stories.stories.get(id)!.updatedAt = new Date(); },
      };
      return work(tx);
    }, mode);
  }
}
