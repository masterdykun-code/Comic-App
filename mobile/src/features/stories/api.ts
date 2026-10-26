import type { AxiosInstance } from 'axios';
import { api } from '../../services/runtime';
import { ApiError } from '../../lib/errors';
import { diagnostic, failureDetails } from '../../lib/diagnostics';

export type StoryType = 'NOVEL' | 'COMIC';
export type StoryStatus = 'ONGOING' | 'COMPLETED';
export type StorySort = 'newest' | 'updated' | 'title';
export interface Genre {
  id: string;
  name: string;
  slug: string;
}
export interface Story {
  id: string;
  title: string;
  slug: string;
  type: StoryType;
  authorName: string;
  description: string;
  coverUrl: string | null;
  status: StoryStatus;
  genres: Genre[];
  createdAt: string;
  updatedAt: string;
}
export interface Chapter {
  isVip?: boolean;
  coinPrice?: number;
  id: string;
  storyId: string;
  chapterNumber: number;
  title: string;
  createdAt: string;
  updatedAt: string;
}
export interface Pagination {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}
export interface Page<T> {
  data: T[];
  pagination: Pagination;
}
export interface StoryFilters {
  type?: StoryType;
  status?: StoryStatus;
  genreId?: string;
  sort?: StorySort;
  search?: string;
  limit?: number;
}
export const isUuid = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
function invalid(): never {
  throw new ApiError(502, 'Dữ liệu phản hồi chưa hợp lệ. Vui lòng thử lại.');
}
function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : invalid();
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : invalid();
}
function id(value: unknown): string {
  return isUuid(value) ? value : invalid();
}
function integer(value: unknown, min: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min
    ? value
    : invalid();
}
function date(value: unknown): string {
  const result = text(value);
  return Number.isFinite(Date.parse(result)) ? result : invalid();
}
function published(row: Record<string, unknown>) {
  // Public responses omit publishStatus. Reject explicit private content defensively.
  if (row.publishStatus !== undefined && row.publishStatus !== 'PUBLISHED') invalid();
}
function genre(value: unknown): Genre {
  const r = record(value);
  return { id: id(r.id), name: text(r.name), slug: text(r.slug) };
}
function story(value: unknown, withGenres = true): Story {
  const r = record(value);
  published(r);
  if (
    !['NOVEL', 'COMIC'].includes(text(r.type)) ||
    !['ONGOING', 'COMPLETED'].includes(text(r.status))
  )
    invalid();
  if (withGenres && !Array.isArray(r.genres)) invalid();
  return {
    id: id(r.id),
    title: text(r.title),
    slug: text(r.slug),
    type: r.type as StoryType,
    authorName: text(r.authorName),
    description: text(r.description),
    coverUrl: r.coverUrl === null ? null : text(r.coverUrl),
    status: r.status as StoryStatus,
    genres: withGenres ? (r.genres as unknown[]).map(genre) : [],
    createdAt: date(r.createdAt),
    updatedAt: date(r.updatedAt),
  };
}
function chapter(value: unknown, storyId: string): Chapter {
  const r = record(value);
  published(r);
  if (r.storyId !== storyId) invalid();
  return {
    id: id(r.id),
    storyId: id(r.storyId),
    chapterNumber: integer(r.chapterNumber, 1),
    title: text(r.title),
    ...(r.isVip === undefined
      ? {}
      : {
          isVip: typeof r.isVip === 'boolean' ? r.isVip : invalid(),
          coinPrice: integer(r.coinPrice, 1),
        }),
    createdAt: date(r.createdAt),
    updatedAt: date(r.updatedAt),
  };
}
function envelope(value: unknown) {
  const r = record(value);
  return r.success === true ? r : invalid();
}
function page<T>(value: unknown, parse: (row: unknown) => T): Page<T> {
  const r = envelope(value);
  if (!Array.isArray(r.data)) invalid();
  const p = record(r.pagination);
  const pagination = {
    page: integer(p.page, 1),
    limit: integer(p.limit, 1),
    total: integer(p.total, 0),
    totalPages: integer(p.totalPages, 0),
  };
  if (
    pagination.totalPages !== Math.ceil(pagination.total / pagination.limit) ||
    r.data.length > pagination.limit
  )
    invalid();
  return { data: r.data.map((row) => parse(row)), pagination };
}
export function createCatalogApi(client: AxiosInstance) {
  return {
    async stories(filters: StoryFilters = {}, pageNumber = 1, signal?: AbortSignal) {
      const response = await client.get<unknown>('/stories', {
        params: { ...filters, page: pageNumber, limit: filters.limit ?? 12 },
        signal,
      });
      try {
        return page(response.data, story);
      } catch (error) {
        diagnostic('catalog.parse.fail', { url: '/stories', ...failureDetails(error) });
        throw error;
      }
    },
    async story(storyId: string, signal?: AbortSignal) {
      const result = story(
        envelope((await client.get<unknown>(`/stories/${storyId}`, { signal })).data).data,
      );
      return result.id === storyId ? result : invalid();
    },
    async chapters(storyId: string, pageNumber = 1, signal?: AbortSignal) {
      const result = page(
        (
          await client.get<unknown>(`/stories/${storyId}/chapters`, {
            params: { page: pageNumber, limit: 20 },
            signal,
          })
        ).data,
        (row) => chapter(row, storyId),
      );
      // The public contract orders chapterNumber ascending. Never guess chapter 1.
      if (
        result.data.some(
          (row, index) => index > 0 && row.chapterNumber <= result.data[index - 1].chapterNumber,
        )
      )
        invalid();
      return result;
    },
    async genres(signal?: AbortSignal) {
      const result = envelope((await client.get<unknown>('/genres', { signal })).data);
      return Array.isArray(result.data) ? result.data.map(genre) : invalid();
    },
    async genreStories(genreId: string, pageNumber = 1, type?: StoryType, signal?: AbortSignal) {
      return page(
        (
          await client.get<unknown>(`/genres/${genreId}/stories`, {
            params: { page: pageNumber, limit: 12, type },
            signal,
          })
        ).data,
        (row) => story(row, false),
      );
    },
  };
}
export const catalogApi = createCatalogApi(api);
