import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

type TraceRequest = Request & { traceId?: string };

/** 为每个请求生成 traceId，贯穿响应与日志 */
@Injectable()
export class TraceMiddleware implements NestMiddleware {
  use(req: TraceRequest, res: Response, next: NextFunction) {
    req.traceId = (req.headers['x-trace-id'] as string) || randomUUID();
    res.setHeader('x-trace-id', req.traceId);
    next();
  }
}
