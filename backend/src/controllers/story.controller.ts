import type { Request, Response } from 'express';
import type { AuthLocals } from '../types/auth.types';
import type { StoryCreateInput, StoryLocals } from '../types/story.types';
import type { StoryService } from '../services/story.service';

type StoryResponse = Response<unknown, StoryLocals & AuthLocals>;

export function createStoryController(service: StoryService) {
  return {
    async adminDetail(_req: Request, res: StoryResponse) {
      const data = await service.adminDetail(res.locals.storyId, res.locals.auth.user.id);
      res.json({ success: true, message: 'Story retrieved successfully', data });
    },
    async list(_req: Request, res: StoryResponse) {
      const result = await service.list(res.locals.storyQuery);
      res.json({ success: true, message: 'Stories retrieved successfully', ...result });
    },
    async detail(_req: Request, res: StoryResponse) {
      const data = await service.detail(res.locals.storyId);
      res.json({ success: true, message: 'Story retrieved successfully', data });
    },
    async create(_req: Request, res: StoryResponse) {
      const data = await service.create(res.locals.auth.user.id, res.locals.storyInput as StoryCreateInput);
      res.status(201).json({ success: true, message: 'Story created', data });
    },
    async update(_req: Request, res: StoryResponse) {
      const data = await service.update(res.locals.auth.user.id, res.locals.storyId, res.locals.storyInput);
      res.json({ success: true, message: 'Story updated', data });
    },
    async publish(_req: Request, res: StoryResponse) {
      const data = await service.publish(res.locals.auth.user.id, res.locals.storyId);
      res.json({ success: true, message: 'Story published', data });
    },
    async unpublish(_req: Request, res: StoryResponse) {
      const data = await service.unpublish(res.locals.auth.user.id, res.locals.storyId);
      res.json({ success: true, message: 'Story hidden', data });
    },
    async remove(_req: Request, res: StoryResponse) {
      const data = await service.remove(res.locals.auth.user.id, res.locals.storyId, res.locals.storyDeleteInput);
      res.json({ success: true, message: 'Story permanently deleted; storage images retained', data });
    },
    async adminList(_req: Request, res: StoryResponse) {
      const result = await service.list(res.locals.storyQuery, res.locals.auth.user.id);
      res.json({ success: true, message: 'Stories retrieved successfully', ...result });
    },
  };
}
