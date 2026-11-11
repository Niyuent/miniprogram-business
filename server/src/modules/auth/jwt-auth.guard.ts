import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { RequestScope } from '../../common/guards/merchant-scope.guard';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { ALLOW_PASSWORD_CHANGE_REQUIRED_KEY } from '../../common/decorators/allow-password-change.decorator';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from './jwt-payload';

/**
 * JWT 校验守卫
 *
 * 在 `app.module.ts` 中以 APP_GUARD 注册为**全站默认守卫**：
 * 除显式打 `@Public()` 的接口外一律要求登录。
 * 取 token 顺序：Authorization: Bearer <jwt> → query.token
 *
 * **每次请求都会回表查一次状态**，因此以下变更对已签发的 token **立即生效**：
 *  - 账号停用（`status != ACTIVE`）→ 401
 *  - 所属商家非 APPROVED（停用 / 驳回 / 待审核）→ 401
 *  - 系统生成账号未改密（`must_change_password=true`）→ 仅放行改密接口，其余 403
 *
 * JWT 里带着签发那一刻的角色与归属，但**它只是快照**；真正的准入以上面这次回表结果为准。
 * 代价是每个请求多一次主键查询（走索引），换来停用即时生效，值得。
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const req = context.switchToHttp().getRequest<
      Request & { user?: JwtPayload; scope?: RequestScope }
    >();
    const header = (req.headers?.authorization as string) || '';
    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : ((req.query?.token as string) ?? '');

    if (!token) {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, '缺少访问令牌');
    }

    let payload: JwtPayload;
    try {
      payload = this.jwt.verify<JwtPayload>(token);
    } catch {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, '令牌无效或已过期');
    }

    // S5.1：C 端令牌（kind='USER'）不得访问后台接口（C 端只走 /h5/**，由 UserJwtAuthGuard 处理）
    if ((payload as unknown as { kind?: string }).kind === 'USER') {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, 'C 端令牌不能访问后台接口');
    }

    // 验签通过后回表确认账号当前是否仍然可用
    const account = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub },
      select: {
        status: true,
        mustChangePassword: true,
        merchant: { select: { status: true } },
      },
    });

    if (!account) {
      throw BizException.unauthorized(
        ReasonCode.INVALID_CREDENTIALS,
        '账号不存在或已被删除',
      );
    }
    if (account.status !== 'ACTIVE') {
      throw BizException.unauthorized(ReasonCode.ACCOUNT_DISABLED, '账号已停用');
    }
    if (account.merchant && account.merchant.status !== 'APPROVED') {
      throw BizException.unauthorized(
        ReasonCode.MERCHANT_SUSPENDED,
        `所属商家状态为 ${account.merchant.status}，暂不可登录`,
      );
    }

    // 系统生成的初始账号：未改密前只能调改密接口
    if (account.mustChangePassword) {
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_PASSWORD_CHANGE_REQUIRED_KEY,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw BizException.forbidden(
          ReasonCode.PASSWORD_CHANGE_REQUIRED,
          '首次登录请先修改密码（PUT /api/v1/auth/password）',
        );
      }
    }

    req.user = payload;
    return true;
  }
}
