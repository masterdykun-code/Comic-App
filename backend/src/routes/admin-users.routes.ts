import { Router } from "express";
import {
  createAuthenticate,
  authorizeRole,
} from "../middlewares/auth.middleware";
import { createAuthRateLimit } from "../middlewares/auth.rate-limit";
import {
  validateAdminUsersQuery,
  validateAdminUserId,
  validateAdminUserStatus,
  validateAdminEmptyQuery,
} from "../middlewares/admin-users.validation";
import { createAdminUsersController } from "../controllers/admin-users.controller";
import { authService, type AuthService } from "../services/auth.service";
import {
  adminUsersService,
  type AdminUsersService,
} from "../services/admin-users.service";
export function createAdminUsersRouter(
  service: AdminUsersService = adminUsersService,
  auth: AuthService = authService,
) {
  const router = Router(),
    c = createAdminUsersController(service);
  router.use(
    (_req, res, next) => {
      res.setHeader("Cache-Control", "no-store");
      next();
    },
    createAuthenticate(auth),
    authorizeRole("ADMIN"),
  );
  router.get("/users", validateAdminUsersQuery, c.list);
  router.get(
    "/users/:id",
    validateAdminUserId,
    validateAdminEmptyQuery,
    c.detail,
  );
  router.patch(
    "/users/:id/status",
    createAuthRateLimit(30),
    validateAdminUserId,
    validateAdminUserStatus,
    c.status,
  );
  router.get("/dashboard", validateAdminEmptyQuery, c.stats);
  return router;
}
export default createAdminUsersRouter();
