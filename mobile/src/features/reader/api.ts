import type { AxiosInstance } from 'axios';
import { api } from '../../services/runtime';
import { ApiError } from '../../lib/errors';
import { isUuid } from '../stories/api';

export interface ComicPage {
  pageNumber: number;
  imageUrl: string;
}
interface ChapterBase {
  id: string;
  storyId: string;
  chapterNumber: number;
  title: string;
  updatedAt: string;
}
export type ReaderChapter = ChapterBase &
  ({ type: 'NOVEL'; content: string } | { type: 'COMIC'; pages: ComicPage[] });
export interface Position {
  chapterId: string;
  textOffset: number | null;
  pageNumber: number | null;
  scrollOffset: number | null;
  progressPercent: number;
}
export interface SavedProgress extends Position {
  storyId: string;
}
export interface ProgressSnapshot {
  data: SavedProgress | null;
  version: string | null;
}
function bad(): never {
  throw new ApiError(502, 'Dữ liệu trình đọc chưa hợp lệ. Vui lòng thử lại.');
}
function object(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : bad();
}
function string(value: unknown) {
  return typeof value === 'string' ? value : bad();
}
function uuid(value: unknown) {
  return isUuid(value) ? value : bad();
}
function int(value: unknown, min = 0): number {
  return typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= min &&
    value <= 2_147_483_647
    ? value
    : bad();
}
function offset(value: unknown, min = 0) {
  return value === null ? null : int(value, min);
}
function timestamp(value: unknown): string {
  const s = string(value);
  return Number.isFinite(Date.parse(s)) ? s : bad();
}
function envelope(value: unknown) {
  const r = object(value);
  return r.success === true ? r : bad();
}
function snapshot(value: unknown, storyId: string): ProgressSnapshot {
  const r = envelope(value);
  const version = r.version === null ? null : timestamp(r.version);
  if (r.data === null) return { data: null, version };
  const d = object(r.data);
  if (d.storyId !== storyId || version === null) bad();
  const percent = d.progressPercent;
  // Prisma Decimal is serialized as a string; accept a finite numeric decimal too.
  const progressPercent =
    typeof percent === 'number'
      ? percent
      : typeof percent === 'string' && /^\d+(\.\d{1,2})?$/.test(percent)
        ? Number(percent)
        : bad();
  if (!Number.isFinite(progressPercent) || progressPercent < 0 || progressPercent > 100) bad();
  return {
    version,
    data: {
      storyId,
      chapterId: uuid(d.chapterId),
      textOffset: offset(d.textOffset),
      pageNumber: offset(d.pageNumber, 1),
      scrollOffset: offset(d.scrollOffset),
      progressPercent,
    },
  };
}
export function createReaderApi(client: AxiosInstance) {
  return {
    async chapter(
      chapterId: string,
      storyId: string,
      signal?: AbortSignal,
    ): Promise<ReaderChapter> {
      const d = object(
        envelope((await client.get<unknown>(`/chapters/${chapterId}`, { signal })).data).data,
      );
      if (
        d.id !== chapterId ||
        d.storyId !== storyId ||
        (d.publishStatus !== undefined && d.publishStatus !== 'PUBLISHED')
      )
        bad();
      const base: ChapterBase = {
        id: uuid(d.id),
        storyId: uuid(d.storyId),
        chapterNumber: int(d.chapterNumber, 1),
        title: string(d.title),
        updatedAt: timestamp(d.updatedAt),
      };
      if (d.type === 'NOVEL') {
        const content = string(d.content);
        if (!content.trim() || content.length > 200_000) bad();
        return { ...base, type: 'NOVEL', content };
      }
      if (
        d.type !== 'COMIC' ||
        !Array.isArray(d.pages) ||
        d.pages.length === 0 ||
        d.pages.length > 200
      )
        bad();
      const pages = d.pages
        .map((raw) => {
          const p = object(raw);
          const imageUrl = string(p.imageUrl);
          let url: URL;
          try {
            url = new URL(imageUrl);
          } catch {
            return bad();
          }
          if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) bad();
          return { pageNumber: int(p.pageNumber, 1), imageUrl };
        })
        .sort((a, b) => a.pageNumber - b.pageNumber);
      if (new Set(pages.map((p) => p.pageNumber)).size !== pages.length) bad();
      return { ...base, type: 'COMIC', pages };
    },
    async progress(storyId: string, signal?: AbortSignal): Promise<ProgressSnapshot> {
      return snapshot(
        (await client.get<unknown>(`/me/reading-progress/${storyId}`, { signal })).data,
        storyId,
      );
    },
    async save(
      storyId: string,
      position: Position,
      expectedUpdatedAt: string | null,
      signal?: AbortSignal,
    ): Promise<ProgressSnapshot> {
      return snapshot(
        (
          await client.put<unknown>(
            `/me/reading-progress/${storyId}`,
            {
              ...position,
              expectedUpdatedAt,
            },
            { signal },
          )
        ).data,
        storyId,
      );
    },
    async history(storyId: string, chapterId: string, signal?: AbortSignal) {
      const response = envelope(
        (await client.post<unknown>('/me/reading-history', { storyId, chapterId }, { signal }))
          .data,
      );
      if (typeof response.recorded !== 'boolean') bad();
    },
  };
}
export const readerApi = createReaderApi(api);
