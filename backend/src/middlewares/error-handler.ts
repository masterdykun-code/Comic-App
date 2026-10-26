import type { ErrorRequestHandler, RequestHandler } from 'express';
import { HttpError } from '../utils/http-error';

export const notFoundHandler: RequestHandler = (_req, _res, next) => {
  next(new HttpError(404, 'NOT_FOUND', 'Endpoint not found'));
};

export const errorHandler: ErrorRequestHandler = (error: unknown, _req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  if (error instanceof HttpError) {
    res.status(error.statusCode).json({
      success: false,
      message: error.message,
      error: { code: error.code },
    });
    return;
  }

  if (typeof error === 'object' && error !== null && 'type' in error &&
      (error.type === 'entity.parse.failed' || error.type === 'entity.too.large')) {
    const status = error.type === 'entity.too.large' ? 413 : 400;
    res.status(status).json({ success: false, message: 'Invalid request body', error: { code: 'INVALID_BODY' } });
    return;
  }

  // Never serialize unknown errors, driver messages, URLs or stack traces.
  res.status(500).json({
    success: false,
    message: 'Internal server error',
    error: { code: 'INTERNAL_SERVER_ERROR' },
  });
};
