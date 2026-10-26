import type { Request, Response } from 'express';
import type { CommentService } from '../services/comment.service';
import type { AdminCommentService } from '../services/admin-comment.service';

export function createCommentController(service: CommentService, adminService: AdminCommentService) {
  return {
    async adminList(_req: Request, res: Response) {
      const result = await adminService.list(res.locals.auth.user.id, res.locals.adminCommentQuery);
      res.json({ success: true, message: 'Admin comments retrieved', ...result });
    },
    async list(_req: Request, res: Response) {
      const result = await service.list(res.locals.storyId, res.locals.feedbackQuery);
      res.json({ success: true, message: 'Comments retrieved', ...result });
    },
    async replies(_req: Request, res: Response) {
      const result = await service.replies(res.locals.id, res.locals.feedbackQuery);
      res.json({ success: true, message: 'Comment replies retrieved', ...result });
    },
    async create(_req: Request, res: Response) {
      const data = await service.create(res.locals.auth.user.id, res.locals.storyId, res.locals.feedbackInput);
      res.status(201).json({ success: true, message: 'Comment created', data });
    },
    async edit(_req: Request, res: Response) {
      const data = await service.edit(res.locals.auth.user.id, res.locals.id, res.locals.feedbackInput.content);
      res.json({ success: true, message: 'Comment updated', data });
    },
    async remove(_req: Request, res: Response) {
      const data = await service.remove(res.locals.auth.user.id, res.locals.id);
      res.json({ success: true, message: 'Comment removed', data });
    },
    async moderate(_req: Request, res: Response) {
      const data = await service.moderate(res.locals.auth.user.id, res.locals.id, res.locals.feedbackInput.status);
      res.json({ success: true, message: 'Comment moderation updated', data });
    },
  };
}
