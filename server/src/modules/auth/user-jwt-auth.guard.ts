import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { UserJwtPayload } from './user-jwt-payload';

/**
 * C 端 JWT 守卫（S5.1）
 *
 * 只用于 `/h5/**`（这些路由对全局 `JwtAuthGuard` 标记为 `@Public()`）：
 *  - 必须携带 **C 端**令牌（`kind === 'USER'`）；后台令牌 → 403；
 *  - 解析出的 `req.user` 即 C 端身份，后续接口一律以 `user.userId` 为准，不接受前端传入的 userId。
 */
@Injectable()
export class UserJwtAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request & { user?: UserJwtPayload }>();
    const header = (req.headers?.authorization as string) || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';

    if (!token) {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, '缺少访问令牌');
    }

    let payload: UserJwtPayload;
    try {
      payload = this.jwt.verify<UserJwtPayload>(token);
    } catch {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, '令牌无效或已过期');
    }

    if (payload.kind !== 'USER') {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '后台令牌不能访问 C 端接口');
    }

    req.user = payload;
    return true;
  }
}
