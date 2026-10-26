import type { Request, Response } from "express";
import type { AdminUsersService } from "../services/admin-users.service";
export function createAdminUsersController(service: AdminUsersService) {
  return {
    async list(_req: Request, res: Response) {
      res.json({
        success: true,
        ...(await service.list(res.locals.auth.user.id, res.locals.userQuery)),
      });
    },
    async detail(_req: Request, res: Response) {
      res.json({
        success: true,
        data: await service.detail(res.locals.auth.user.id, res.locals.userId),
      });
    },
    async status(_req: Request, res: Response) {
      res.json({
        success: true,
        message: "User status updated",
        data: await service.status(
          res.locals.auth.user.id,
          res.locals.userId,
          res.locals.userStatus,
        ),
      });
    },
    async stats(_req: Request, res: Response) {
      res.json({
        success: true,
        data: await service.stats(res.locals.auth.user.id),
      });
    },
  };
}
