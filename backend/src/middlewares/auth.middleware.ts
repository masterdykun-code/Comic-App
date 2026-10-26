import type { RequestHandler } from 'express';
import type { UserRole } from '../generated/prisma/enums';
import { authService, type AuthService } from '../services/auth.service';
import { HttpError } from '../utils/http-error';

export function createAuthenticate(service: AuthService = authService): RequestHandler {
  return async (req, res, next) => {
    const match = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(req.headers.authorization ?? '');
    if (!match || match[1].length > 4096) {
      throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    }
    res.locals.auth = await service.authenticate(match[1]);
    next();
  };
}

export const authenticate = createAuthenticate();

// Public chapter metadata/free content accepts guests; a supplied token must be valid.
export function createOptionalAuthenticate(service: AuthService = authService): RequestHandler {
  const required=createAuthenticate(service);
  return (req,res,next)=>req.headers.authorization===undefined?next():required(req,res,next);
}

export function authorizeRole(...roles: UserRole[]): RequestHandler {
  return (_req, res, next) => {
    if (!res.locals.auth) throw new HttpError(401, 'UNAUTHORIZED', 'Authentication required');
    if (!roles.includes(res.locals.auth.user.role)) {
      throw new HttpError(403, 'FORBIDDEN', 'Insufficient permissions');
    }
    next();
  };
}
