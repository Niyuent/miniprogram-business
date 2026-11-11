import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

/** 全局异常过滤：HttpException 保留业务 reasonCode，其余收敛为 500 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Exception');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { traceId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = '服务器内部错误';
    let reasonCode: string | undefined;
    // 业务异常可以携带结构化详情（S2.3 verify：失败时也要把券信息 / 逐项校验明细带回去）
    let detail: Record<string, any> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as Record<string, any>;
        message = (b.message as string) ?? message;
        reasonCode = b.reasonCode as string | undefined;
        if (Array.isArray(message)) message = message.join('; ');
        const { code: _code, message: _message, ...rest } = b;
        if (Object.keys(rest).length) detail = rest;
      }
    }

    if (status >= 500) {
      this.logger.error(
        `${req.method} ${req.originalUrl} → ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    res.status(status).json({
      code: status,
      message,
      data: reasonCode ? (detail ?? { reasonCode }) : null,
      traceId: req.traceId ?? '',
    });
  }
}
