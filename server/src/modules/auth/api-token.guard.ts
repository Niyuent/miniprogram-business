import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { BizException } from '../../common/exceptions/biz.exception';

/**
 * 静态令牌守卫：仅用于「外部系统对接」与运维端点
 * 取值顺序：x-api-token 头 → query.token → body.token
 * 未配置 API_TOKEN 时一律拒绝（避免生产裸奔）
 */
@Injectable()
export class ApiTokenGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const expected = process.env.API_TOKEN;
    if (!expected) {
      throw BizException.forbidden('API_TOKEN_NOT_CONFIGURED', '服务端未配置 API_TOKEN');
    }
    const req = context.switchToHttp().getRequest<Request & { body?: Record<string, unknown> }>();
    const provided =
      (req.headers?.['x-api-token'] as string) ||
      (req.query?.token as string) ||
      (req.body?.token as string);

    if (provided !== expected) {
      throw BizException.forbidden('INVALID_API_TOKEN', '无效的 API_TOKEN');
    }
    return true;
  }
}
