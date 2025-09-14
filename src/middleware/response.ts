import { Request, Response, NextFunction } from 'express';

export function success(data: any, meta: Record<string, any> = {}) {
  return { success: true, data, meta };
}

export function errorPayload(code: string, message: string, meta: Record<string, any> = {}) {
  return { success: false, error: { code, message }, meta };
}

export function responseWrapper(req: Request, res: Response, next: NextFunction) {
  (res as any).ok = (data: any, meta: Record<string, any> = {}) => {
    res.json(success(data, { request_id: (req as any).reqId, ...meta }));
  };
  (res as any).fail = (code: string, message: string, status = 400, meta: Record<string, any> = {}) => {
    res.status(status).json(errorPayload(code, message, { request_id: (req as any).reqId, ...meta }));
  };
  next();
}

export function errorHandler(err: any, req: Request, res: Response, _next: NextFunction) {
  const status = err.status || 500;
  const code = err.code || (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR');
  const message = err.message || 'Unexpected error';
  res.status(status).json(errorPayload(code, message, { request_id: (req as any).reqId }));
}

declare module 'express-serve-static-core' {
  interface Response {
    ok?: (data: any, meta?: Record<string, any>) => void;
    fail?: (code: string, message: string, status?: number, meta?: Record<string, any>) => void;
  }
}
