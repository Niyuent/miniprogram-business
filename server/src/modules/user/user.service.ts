import { Injectable } from '@nestjs/common';
import { MerchantType, Prisma, UserStatus } from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import { BindPhoneDto, QueryUsersDto, UpdateUserStatusDto } from './dto/user.dto';

interface Scope {
  merchantId: number | null;
  storeId: number | null;
}

/**
 * 用户管理（S5.2，主体后台）
 *
 * 数据隔离（**不信任前端传参**，一律由 JWT 推导）：
 *  - 平台 / 主体：全部用户；
 *  - 附属 / 店员：仅「在本商家（店员：本门店）消费过」的用户（`orders.some` 过滤）。
 */
@Injectable()
export class UserService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 可见范围：平台/主体=全量；附属=本商家；店员=本店 */
  private async scope(user: JwtPayload): Promise<Scope> {
    if (user.userType === 'PLATFORM') return { merchantId: null, storeId: null };
    if (user.userType === 'STORE') return { merchantId: user.merchantId ?? null, storeId: user.storeId ?? null };
    const me = await this.prisma.merchant.findUnique({
      where: { id: user.merchantId ?? -1 },
      select: { type: true },
    });
    if (me?.type === MerchantType.MAIN) return { merchantId: null, storeId: null };
    return { merchantId: user.merchantId ?? null, storeId: null };
  }

  /** 附属/店员 → 只保留「在本商家/门店有订单」的用户 */
  private scopeUserFilter(scope: Scope): Prisma.UserWhereInput {
    if (scope.merchantId === null) return {};
    return {
      orders: {
        some: {
          merchantId: scope.merchantId,
          ...(scope.storeId !== null ? { storeId: scope.storeId } : {}),
        },
      },
    };
  }

  /** 商家扫会员码后看脱敏信息；不要求该用户曾在本店消费过。 */
  async maskedInfo(id: number, user: JwtPayload) {
    if (user.userType !== 'PLATFORM' && !user.merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '当前账号不能查看会员信息');
    }
    const target = await this.prisma.user.findUnique({
      where: { id },
      select: { id: true, nickname: true, phone: true, status: true },
    });
    if (!target || target.status !== UserStatus.ACTIVE) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '会员不存在或已停用');
    }
    const phone = target.phone || '';
    const maskedPhone =
      phone.length >= 7 && !phone.startsWith('wx_')
        ? `${phone.slice(0, 3)}****${phone.slice(-4)}`
        : phone.startsWith('wx_')
          ? '微信用户'
          : phone || '未绑定手机';
    const name =
      target.nickname && !target.nickname.startsWith('wx_')
        ? target.nickname
        : maskedPhone === '微信用户'
          ? '微信会员'
          : maskedPhone.slice(0, 1) + '**';
    return { name, phone: maskedPhone, userId: target.id };
  }

  async list(query: QueryUsersDto, user: JwtPayload) {
    const scope = await this.scope(user);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.UserWhereInput = {
      AND: [
        this.scopeUserFilter(scope),
        query.phone ? { phone: { contains: query.phone } } : {},
        query.keyword
          ? { OR: [{ phone: { contains: query.keyword } }, { nickname: { contains: query.keyword } }] }
          : {},
        query.status ? { status: query.status } : {},
        query.registeredFrom || query.registeredTo
          ? {
              registeredAt: {
                ...(query.registeredFrom ? { gte: new Date(query.registeredFrom) } : {}),
                ...(query.registeredTo ? { lte: new Date(query.registeredTo) } : {}),
              },
            }
          : {},
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          phone: true,
          nickname: true,
          avatar: true,
          status: true,
          registeredAt: true,
          openid: true,
          unionid: true,
          inviter: { select: { id: true, nickname: true, phone: true } },
          pointAccounts: {
            select: { balance: true, totalEarned: true, totalSpent: true, allianceId: true },
            orderBy: { allianceId: 'asc' },
          },
          _count: { select: { orders: true, couponInstances: true, redemptions: true } },
        },
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      list: rows.map((u) => {
        const primary = u.pointAccounts[0];
        const balance = u.pointAccounts.reduce((s, a) => s + a.balance, 0);
        const totalEarned = u.pointAccounts.reduce((s, a) => s + a.totalEarned, 0);
        const totalSpent = u.pointAccounts.reduce((s, a) => s + a.totalSpent, 0);
        return {
          id: u.id,
          phone: u.phone,
          nickname: u.nickname,
          avatar: u.avatar,
          status: u.status,
          registeredAt: u.registeredAt,
          bound: !!u.openid, // 是否已绑定微信（C 端登录过）
          balance,
          totalEarned,
          totalSpent,
          primaryAllianceId: primary?.allianceId ?? null,
          inviterId: u.inviter?.id ?? null,
          inviterName: u.inviter?.nickname || u.inviter?.phone || null,
          orderCount: u._count.orders,
          couponCount: u._count.couponInstances,
          redemptionCount: u._count.redemptions,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  async detail(id: number, user: JwtPayload) {
    const scope = await this.scope(user);
    const visible = await this.prisma.user.findFirst({
      where: { AND: [{ id }, this.scopeUserFilter(scope)] },
      select: { id: true },
    });
    if (!visible) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '用户不存在或不在可见范围内');

    // 附属/店员视角下，明细记录也按范围收敛（避免看到别家的消费/核销/券）
    const orderWhere: Prisma.OrderWhereInput = {
      userId: id,
      ...(scope.merchantId !== null ? { merchantId: scope.merchantId } : {}),
      ...(scope.storeId !== null ? { storeId: scope.storeId } : {}),
    };
    const couponWhere: Prisma.CouponInstanceWhereInput = {
      userId: id,
      ...(scope.merchantId !== null ? { issuerMerchantId: scope.merchantId } : {}),
    };

    const [profile, account, orders, coupons, redemptions] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id },
        select: { id: true, phone: true, nickname: true, avatar: true, status: true, openid: true, unionid: true, registeredAt: true, createdAt: true },
      }),
      this.prisma.pointAccount.findMany({
        where: { userId: id },
        orderBy: { allianceId: 'asc' },
        select: { balance: true, totalEarned: true, totalSpent: true, allianceId: true },
      }),
      this.prisma.order.findMany({
        where: orderWhere,
        orderBy: { id: 'desc' },
        take: 50,
        select: { id: true, orderNo: true, payAmount: true, status: true, consumeTime: true, merchantId: true, storeId: true },
      }),
      this.prisma.couponInstance.findMany({
        where: couponWhere,
        orderBy: { id: 'desc' },
        take: 50,
        select: { id: true, code: true, status: true, templateId: true, obtainedAt: true, expireAt: true, issuerMerchantId: true },
      }),
      this.prisma.redemptionRecord.findMany({
        where: {
          userId: id,
          ...(scope.merchantId !== null ? { merchantId: scope.merchantId } : {}),
          ...(scope.storeId !== null ? { storeId: scope.storeId } : {}),
        },
        orderBy: { id: 'desc' },
        take: 50,
        select: { id: true, code: true, status: true, redeemedAt: true, merchantId: true, storeId: true },
      }),
    ]);

    // 来源商家（该用户在本范围内的消费商家去重）
    const sourceIds = Array.from(new Set(orders.map((o) => o.merchantId)));
    const merchants = sourceIds.length
      ? await this.prisma.merchant.findMany({ where: { id: { in: sourceIds } }, select: { id: true, name: true, type: true } })
      : [];

    const accounts = account;
    const aggregated = {
      balance: accounts.reduce((s, a) => s + a.balance, 0),
      totalEarned: accounts.reduce((s, a) => s + a.totalEarned, 0),
      totalSpent: accounts.reduce((s, a) => s + a.totalSpent, 0),
      byAlliance: accounts,
    };

    return {
      profile,
      account: aggregated,
      coupons,
      orders,
      redemptions,
      sourceMerchants: merchants,
    };
  }

  async updateStatus(id: number, user: JwtPayload, dto: UpdateUserStatusDto, ip?: string, ua?: string) {
    const scope = await this.scope(user);
    const target = await this.prisma.user.findFirst({
      where: { AND: [{ id }, this.scopeUserFilter(scope)] },
      select: { id: true, status: true },
    });
    if (!target) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '用户不存在或不在可见范围内');
    if (target.status === dto.status) {
      return { id, status: dto.status, unchanged: true };
    }

    const updated = await this.prisma.user.update({ where: { id }, data: { status: dto.status } });
    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      operatorName: user.username,
      module: 'user',
      action: dto.status === UserStatus.DISABLED ? 'user:disable' : 'user:enable',
      targetType: 'user',
      targetId: id,
      before: { status: target.status },
      after: { status: updated.status },
      ip,
      userAgent: ua,
    });
    return { id, status: updated.status, unchanged: false };
  }

  async bindPhone(id: number, user: JwtPayload, dto: BindPhoneDto, ip?: string, ua?: string) {
    const scope = await this.scope(user);
    const target = await this.prisma.user.findFirst({
      where: { AND: [{ id }, this.scopeUserFilter(scope)] },
      select: { id: true, phone: true },
    });
    if (!target) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '用户不存在或不在可见范围内');

    const occupied = await this.prisma.user.findUnique({ where: { phone: dto.phone }, select: { id: true } });
    if (occupied && occupied.id !== id) {
      throw BizException.conflict(ReasonCode.USER_PHONE_EXISTS, '该手机号已被其它用户占用');
    }
    if (target.phone === dto.phone) {
      return { id, phone: dto.phone, unchanged: true };
    }

    const updated = await this.prisma.user.update({ where: { id }, data: { phone: dto.phone } });
    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      operatorName: user.username,
      module: 'user',
      action: 'user:bind-phone',
      targetType: 'user',
      targetId: id,
      before: { phone: target.phone },
      after: { phone: updated.phone },
      ip,
      userAgent: ua,
    });
    return { id, phone: updated.phone, unchanged: false };
  }
}
