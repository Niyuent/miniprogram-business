import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, map } from 'rxjs';

export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T | null;
  traceId: string;
}

/** 统一响应包装：{ code, message, data, traceId } */
@Injectable()
export class ResponseInterceptor<T = unknown> implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const req = http.getRequest<{ traceId?: string } & Record<string, any>>();
    const res = http.getResponse<{ statusCode: number; getHeader: (n: string) => string | undefined }>();

    return next.handle().pipe(
      map((data) => {
        // 导出类接口：handler 已显式设置非 JSON Content-Type（如 text/csv）→ 放行原始内容，不套 envelope
        const ct = res.getHeader('content-type') as string | undefined;
        if (ct && !ct.includes('application/json')) {
          return data;
        }
        return {
          code: res.statusCode,
          message: 'success',
          data: data ?? null,
          traceId: req.traceId ?? '',
        } as ApiResponse<T>;
      }),
    );
  }
}
