import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { BizException, ReasonCode } from '../exceptions/biz.exception';
import { JwtPayload } from '../../modules/auth/jwt-payload';
import { PERMISSIONS_KEY, ROLES_KEY } from '../decorators/roles.decorator';

/**
 * 角色 / 权限码守卫
 *
 * 必须挂在 JwtAuthGuard **之后**（Nest 按数组顺序执行），依赖 `req.user`。
 * 未打 `@Roles()` / `@Permissions()` 的接口直接放行，避免误伤。
 *
 * 注意：本守卫只解决「能不能进这个接口」，
 * 解决不了「能不能看这条数据」—— 后者必须由 MerchantScopeGuard 兜底。
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const requiredPerms = this.reflector.getAllAndOverride<string[] | undefined>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles?.length && !requiredPerms?.length) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request & { user?: JwtPayload }>();
    const user = req.user;
    if (!user) {
      throw new UnauthorizedException('缺少登录身份');
    }

    if (requiredRoles?.length) {
      const owned = new Set(user.roles ?? []);
      if (!requiredRoles.some((code) => owned.has(code))) {
        throw BizException.forbidden(
          ReasonCode.ROLE_NOT_ALLOWED,
          `需要角色：${requiredRoles.join(' / ')}`,
        );
      }
    }

    if (requiredPerms?.length) {
      const owned = new Set(user.permissions ?? []);
      if (!requiredPerms.some((code) => owned.has(code))) {
        throw BizException.forbidden(
          ReasonCode.PERMISSION_DENIED,
          `缺少权限码：${requiredPerms.join(' / ')}`,
        );
      }
    }

    return true;
  }
}
