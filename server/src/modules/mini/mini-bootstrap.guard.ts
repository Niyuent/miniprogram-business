import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../auth/jwt-payload';
import { UserJwtAuthGuard } from '../auth/user-jwt-auth.guard';
import { UserJwtPayload } from '../auth/user-jwt-payload';

/**
 * 小程序 bootstrap 同时接受两种令牌：
 * - C 端令牌交给 UserJwtAuthGuard（kind === 'USER'）
 * - 后台账号令牌走与 JwtAuthGuard 相同的回表校验
 *
 * 全局 JwtAuthGuard 对这两种令牌是互斥的，所以本接口标 @Public()，改由这里分流。
 */
@Injectable()
export class MiniBootstrapGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly userGuard: UserJwtAuthGuard,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request & { user?: UserJwtPayload | JwtPayload }>();
    const header = (req.headers?.authorization as string) || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (!token) {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, '缺少访问令牌');
    }

    let payload: { kind?: string };
    try {
      payload = this.jwt.verify(token);
    } catch {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, '令牌无效或已过期');
    }

    if (payload.kind === 'USER') {
      return this.userGuard.canActivate(context);
    }

    const adminPayload = payload as JwtPayload;
    const account = await this.prisma.adminUser.findUnique({
      where: { id: adminPayload.sub },
      select: {
        status: true,
        mustChangePassword: true,
        merchant: { select: { status: true } },
      },
    });
    if (!account) {
      throw BizException.unauthorized(ReasonCode.INVALID_CREDENTIALS, '账号不存在或已被删除');
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
    if (account.mustChangePassword) {
      throw BizException.forbidden(ReasonCode.PASSWORD_CHANGE_REQUIRED, '首次登录请先修改密码');
    }

    req.user = adminPayload;
    return true;
  }
}
