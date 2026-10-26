import type { Request, Response } from 'express';
import type { AuthLocals } from '../types/auth.types';
import type { ChapterCreateInput, ChapterLocals, ChapterUpdateInput, PageInput } from '../types/chapter.types';
import type { ChapterService } from '../services/chapter.service';

type ChapterResponse = Response<unknown, ChapterLocals & AuthLocals>;
export function createChapterController(service: ChapterService) {
  return {
    async adminRead(_req: Request, res: ChapterResponse) {
      const data = await service.adminRead(res.locals.chapterId, res.locals.auth.user.id);
      res.json({ success: true, message: 'Chapter retrieved successfully', data });
    },
    async list(_req: Request, res: ChapterResponse) {
      const result = await service.list(res.locals.storyId, res.locals.chapterQuery);
      res.json({ success: true, message: 'Chapters retrieved successfully', ...result });
    },
    async read(_req: Request, res: ChapterResponse) {
      const data = await service.read(res.locals.chapterId, res.locals.auth?.user.id);
      res.json({ success: true, message: 'Chapter retrieved successfully', data });
    },
    async adminList(_req: Request, res: ChapterResponse) {
      const result = await service.list(res.locals.storyId, res.locals.chapterQuery, res.locals.auth.user.id);
      res.json({ success: true, message: 'Chapters retrieved successfully', ...result });
    },
    async create(_req: Request, res: ChapterResponse) {
      const data = await service.create(res.locals.auth.user.id, res.locals.storyId, res.locals.chapterInput as ChapterCreateInput);
      res.status(201).json({ success: true, message: 'Chapter created', data });
    },
    async update(_req: Request, res: ChapterResponse) {
      const data = await service.update(res.locals.auth.user.id, res.locals.chapterId, res.locals.chapterInput as ChapterUpdateInput, res.locals.chapterExpectedUpdatedAt);
      res.json({ success: true, message: 'Chapter updated', data });
    },
    async pages(_req: Request, res: ChapterResponse) {
      const { pages } = res.locals.chapterInput as { pages: PageInput[] };
      const data = await service.replacePages(res.locals.auth.user.id, res.locals.chapterId, pages, res.locals.chapterExpectedUpdatedAt);
      res.json({ success: true, message: 'Chapter pages replaced', data });
    },
    async publish(_req: Request, res: ChapterResponse) {
      const data = await service.publish(res.locals.auth.user.id, res.locals.chapterId, res.locals.chapterExpectedUpdatedAt);
      res.json({ success: true, message: 'Chapter published', data });
    },
  };
}
