import { z } from "zod";
import type { RequestHandler } from "express";
import { HttpError } from "../utils/http-error";
const integer = (fallback: number, max: number) =>
  z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .refine((n) => Number.isSafeInteger(n) && n <= max)
    .optional()
    .default(fallback);
export const adminUsersQuery = z
  .strictObject({
    page: integer(1, 2147483647),
    limit: integer(20, 100),
    search: z.string().trim().min(1).max(200).optional(),
    status: z.enum(["ACTIVE", "BANNED"]).optional(),
  })
  .refine((q) => (q.page - 1) * q.limit <= 2147483647);
export const adminUserStatus = z.strictObject({
  status: z.enum(["ACTIVE", "BANNED"]),
  confirm: z.literal(true),
  expectedUpdatedAt: z.iso.datetime({ offset: true }),
});
export const validateAdminUsersQuery: RequestHandler = (req, res, next) => {
  const q = adminUsersQuery.safeParse(req.query);
  if (!q.success)
    throw new HttpError(400, "INVALID_QUERY", "Invalid user query");
  res.locals.userQuery = q.data;
  next();
};
export const validateAdminUserId: RequestHandler = (req, res, next) => {
  const id = z.uuid().safeParse(req.params.id);
  if (!id.success)
    throw new HttpError(400, "INVALID_UUID", "Invalid user UUID");
  res.locals.userId = id.data.toLowerCase();
  next();
};
export const validateAdminUserStatus: RequestHandler = (req, res, next) => {
  const body = adminUserStatus.safeParse(req.body);
  if (!body.success || Object.keys(req.query).length)
    throw new HttpError(400, "INVALID_BODY", "Invalid confirmed user status");
  res.locals.userStatus = body.data;
  next();
};
export const validateAdminEmptyQuery: RequestHandler = (req, _res, next) => {
  if (Object.keys(req.query).length)
    throw new HttpError(400, "INVALID_QUERY", "No query parameters accepted");
  next();
};
