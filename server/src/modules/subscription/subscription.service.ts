import { Injectable } from '@nestjs/common';
import {
  MerchantPlanType,
  PlanPeriod,
  Prisma,
  SubscriptionStatus,
  SubTier,
} from '@prisma/client';
import { randomInt } from 'crypto';
import {
  MAIN_MEMBER_PRICE,
  MAIN_MEMBER_TRIAL_DAYS,
  PERIOD_MONTHS,
  PERIOD_NAME,
  SUB_TIER_COLOR,
  SUB_TIER_LIMIT,
  SUB_TIER_NAME,
  SUB_TIER_PRICE,
  addDays,
  addMonths,
} from '../../common/billing/plans';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import {
  ConfirmSubscriptionDto,
  QuerySubscriptionsDto,
  SubmitSubscriptionDto,
} from './dto/subscription.dto';

/** 商家计费状态：附属档位 + 主体会员，一次查全，前端一次渲染 */
export interface MerchantBilling {
  merchantId: number;
  merchantName: string;
  subTier: {
    tier: SubTier;
    name: string;
    color: string;
    allianceLimit: number;
    allianceUsed: number;
    allianceRemaining: number;
    paid: boolean;
    expiresAt: string | null;
    price: number;
  };
  mainMember: {
    active: boolean;
    trial: boolean;
    expiresAt: string | null;
    /** 到期后联盟内发分/发券会停 */
    blocked: boolean;
  };
}

/**
 * 商家计费：附属档位（2/10 个联盟）与主体商家会员（38.8/109/209/418）。
 *
 * 设计取舍：
 * 1. **不做定时任务**。到期与否在每次读取时用 `endsAt > now` 判断，
 *    状态字段只是给后台列表筛选用，避免引入一个必须常驻的 cron。
 * 2. **金额一律服务端算**，前端传上来的只是「买哪个套餐」，不参与计价。
 * 3. **续费顺延**：确认收款时若同计划仍在有效期内，从原到期日往后加，
 *    而不是从今天重新算，避免商家续费反而损失剩余天数。
 */
@Injectable()
export class SubscriptionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 价格目录（小程序充值页、后台都用这一份） */
  catalog() {
    return {
      currency: 'CNY',
      subTier: {
        items: [
          {
            tier: SubTier.PRIMARY,
            name: SUB_TIER_NAME.PRIMARY,
            color: SUB_TIER_COLOR.PRIMARY,
            price: 0,
            period: PlanPeriod.MONTH,
            allianceLimit: SUB_TIER_LIMIT.PRIMARY,
            desc: `默认档位，最多加入 ${SUB_TIER_LIMIT.PRIMARY} 个联盟`,
          },
          {
            tier: SubTier.ADVANCED,
            name: SUB_TIER_NAME.ADVANCED,
            color: SUB_TIER_COLOR.ADVANCED,
            price: SUB_TIER_PRICE,
            period: PlanPeriod.MONTH,
            allianceLimit: SUB_TIER_LIMIT.ADVANCED,
            desc: `${SUB_TIER_PRICE} 元/月，最多加入 ${SUB_TIER_LIMIT.ADVANCED} 个联盟，到期回落至 ${SUB_TIER_LIMIT.PRIMARY} 个`,
          },
        ],
      },
      mainMember: {
        trialDays: MAIN_MEMBER_TRIAL_DAYS,
        items: (Object.keys(PERIOD_MONTHS) as PlanPeriod[]).map((period) => ({
          period,
          name: PERIOD_NAME[period],
          months: PERIOD_MONTHS[period],
          price: MAIN_MEMBER_PRICE[period],
        })),
      },
    };
  }

  /** 附属档位现状：当前档位、上限、已用联盟数、到期时间 */
  async subTierStatus(merchantId: number) {
    const now = new Date();
    const active = await this.prisma.merchantSubscription.findFirst({
      where: {
        merchantId,
        planType: MerchantPlanType.SUB_TIER,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'desc' },
      select: { tier: true, endsAt: true },
    });

    const tier = active?.tier ?? SubTier.PRIMARY;
    const used = await this.prisma.merchantAlliance.count({
      where: { merchantId, role: 'SUB' },
    });
    const limit = SUB_TIER_LIMIT[tier];
    return {
      tier,
      name: SUB_TIER_NAME[tier],
      color: SUB_TIER_COLOR[tier],
      allianceLimit: limit,
      allianceUsed: used,
      allianceRemaining: Math.max(0, limit - used),
      paid: Boolean(active),
      expiresAt: active?.endsAt ?? null,
      price: tier === SubTier.ADVANCED ? SUB_TIER_PRICE : 0,
    };
  }

  /**
   * 主体商家会员状态。
   *
   * 三层判断，顺序不能换：
   * 1. 有生效订阅 → 正常；
   * 2. 从未买过（无任何 MAIN_MEMBER 记录）→ 从商家创建时间起算试用期，
   *    这条兜底是为了让历史商家和种子数据不会在上线当天集体停发；
   * 3. 买过但已过期 → 停发。
   */
  async mainMemberStatus(merchantId: number) {
    const now = new Date();
    const active = await this.prisma.merchantSubscription.findFirst({
      where: {
        merchantId,
        planType: MerchantPlanType.MAIN_MEMBER,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
      },
      orderBy: { endsAt: 'desc' },
      select: { endsAt: true },
    });
    if (active?.endsAt) {
      return { active: true, trial: false, expiresAt: active.endsAt, blocked: false };
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { createdAt: true },
    });
    if (!merchant) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `商家 #${merchantId} 不存在`);
    }

    const everBought = await this.prisma.merchantSubscription.findFirst({
      where: { merchantId, planType: MerchantPlanType.MAIN_MEMBER },
      orderBy: { endsAt: 'desc' },
      select: { endsAt: true },
    });

    if (!everBought) {
      const trialEnd = addDays(merchant.createdAt, MAIN_MEMBER_TRIAL_DAYS);
      if (now < trialEnd) {
        return { active: true, trial: true, expiresAt: trialEnd, blocked: false };
      }
      return { active: false, trial: true, expiresAt: trialEnd, blocked: true };
    }

    return {
      active: false,
      trial: false,
      expiresAt: everBought.endsAt ?? null,
      blocked: true,
    };
  }

  /**
   * 停服闸门：发分 / 发券前调用。
   *
   * 联盟是盟主的资产，盟主欠费时整个联盟停发——包括联盟内的附属商家。
   * 查询、核销、兑换不受影响（已发出去的分和券必须能花完）。
   */
  async assertMainMemberActive(merchantId: number, action = '发分') {
    const status = await this.mainMemberStatus(merchantId);
    if (status.blocked) {
      const until = status.expiresAt
        ? new Date(status.expiresAt).toISOString().slice(0, 10)
        : '未开通';
      throw BizException.forbidden(
        ReasonCode.MAIN_MEMBER_EXPIRED,
        `盟主会员已到期（${until}），本联盟${action}已暂停，请联系盟主续费`,
      );
    }
    return status;
  }

  /** 商家计费总览 */
  async billing(merchantId: number): Promise<MerchantBilling> {
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true },
    });
    if (!merchant) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `商家 #${merchantId} 不存在`);
    }
    const [subTier, mainMember] = await Promise.all([
      this.subTierStatus(merchantId),
      this.mainMemberStatus(merchantId),
    ]);
    return {
      merchantId,
      merchantName: merchant.name,
      subTier: {
        ...subTier,
        expiresAt: subTier.expiresAt ? subTier.expiresAt.toISOString() : null,
      },
      mainMember: {
        active: mainMember.active,
        trial: mainMember.trial,
        blocked: mainMember.blocked,
        expiresAt: mainMember.expiresAt ? new Date(mainMember.expiresAt).toISOString() : null,
      },
    };
  }

  /** 提交充值申请（PENDING，等后台确认到账） */
  async submit(dto: SubmitSubscriptionDto, user: JwtPayload) {
    const merchantId = user.merchantId ?? dto.merchantId;
    if (!merchantId) {
      throw BizException.badRequest(ReasonCode.RESOURCE_NOT_FOUND, '缺少 merchantId');
    }
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true },
    });
    if (!merchant) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `商家 #${merchantId} 不存在`);
    }

    const planType = dto.planType as MerchantPlanType;
    let period: PlanPeriod;
    let tier: SubTier | null = null;
    let amount: number;

    if (planType === MerchantPlanType.SUB_TIER) {
      // 附属档位只有一个月付档；初级是默认态，不需要下单
      if (dto.tier !== SubTier.ADVANCED) {
        throw BizException.badRequest(
          ReasonCode.SUBSCRIPTION_NOT_FOUND,
          '初级合作商为默认档位，无需充值；请选择高级合作商',
        );
      }
      tier = SubTier.ADVANCED;
      period = PlanPeriod.MONTH;
      amount = SUB_TIER_PRICE;
    } else {
      if (!dto.period || !(dto.period in MAIN_MEMBER_PRICE)) {
        throw BizException.badRequest(ReasonCode.SUBSCRIPTION_NOT_FOUND, '主体会员必须选择周期');
      }
      period = dto.period as PlanPeriod;
      amount = MAIN_MEMBER_PRICE[period];
    }

    // 同计划已有待确认单 → 直接返回那张，避免商家连点生成一堆待办
    const pending = await this.prisma.merchantSubscription.findFirst({
      where: {
        merchantId,
        planType,
        tier,
        status: SubscriptionStatus.PENDING,
      },
      orderBy: { id: 'desc' },
    });
    if (pending) {
      return this.toView(pending, { reused: true });
    }

    const record = await this.prisma.merchantSubscription.create({
      data: {
        merchantId,
        planType,
        tier,
        period,
        amount: new Prisma.Decimal(amount.toFixed(2)),
        orderNo: await this.nextOrderNo(),
        status: SubscriptionStatus.PENDING,
        remark: dto.remark ?? null,
      },
    });

    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      module: 'subscription',
      action: 'SUBSCRIPTION_SUBMIT',
      targetType: 'merchant_subscription',
      targetId: record.id,
      after: { merchantId, planType, tier, period, amount },
    });

    return this.toView(record);
  }

  /** 后台确认收款 → 立即生效（续费顺延） */
  async confirm(id: number, dto: ConfirmSubscriptionDto, user: JwtPayload) {
    const sub = await this.prisma.merchantSubscription.findUnique({ where: { id } });
    if (!sub) {
      throw BizException.notFound(ReasonCode.SUBSCRIPTION_NOT_FOUND, `订阅单 #${id} 不存在`);
    }
    if (sub.status !== SubscriptionStatus.PENDING) {
      throw BizException.conflict(
        ReasonCode.SUBSCRIPTION_NOT_PENDING,
        `订阅单 #${id} 当前状态为 ${sub.status}，只有待确认的单可以确认收款`,
      );
    }

    const now = new Date();
    const current = await this.prisma.merchantSubscription.findFirst({
      where: {
        merchantId: sub.merchantId,
        planType: sub.planType,
        status: SubscriptionStatus.ACTIVE,
        endsAt: { gt: now },
        id: { not: sub.id },
      },
      orderBy: { endsAt: 'desc' },
      select: { endsAt: true },
    });

    // 顺延：从原到期日往后加，不从今天重算
    const base = current?.endsAt && current.endsAt > now ? current.endsAt : now;
    const endsAt = addMonths(base, PERIOD_MONTHS[sub.period]);

    const updated = await this.prisma.merchantSubscription.update({
      where: { id },
      data: {
        status: SubscriptionStatus.ACTIVE,
        startsAt: base,
        endsAt,
        confirmedById: user.sub,
        confirmedAt: now,
        payRemark: dto.payRemark ?? sub.payRemark,
      },
    });

    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      module: 'subscription',
      action: 'SUBSCRIPTION_CONFIRM',
      targetType: 'merchant_subscription',
      targetId: id,
      before: { status: sub.status },
      after: {
        status: updated.status,
        startsAt: updated.startsAt,
        endsAt: updated.endsAt,
        renewedFrom: current?.endsAt ?? null,
        amount: Number(updated.amount),
      },
    });

    return this.toView(updated);
  }

  /** 驳回 / 取消待确认单 */
  async cancel(id: number, user: JwtPayload) {
    const sub = await this.prisma.merchantSubscription.findUnique({ where: { id } });
    if (!sub) {
      throw BizException.notFound(ReasonCode.SUBSCRIPTION_NOT_FOUND, `订阅单 #${id} 不存在`);
    }
    if (sub.status !== SubscriptionStatus.PENDING) {
      throw BizException.conflict(
        ReasonCode.SUBSCRIPTION_NOT_PENDING,
        `订阅单 #${id} 当前状态为 ${sub.status}，只有待确认的单可以取消`,
      );
    }
    const updated = await this.prisma.merchantSubscription.update({
      where: { id },
      data: { status: SubscriptionStatus.CANCELLED, cancelledAt: new Date() },
    });
    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      module: 'subscription',
      action: 'SUBSCRIPTION_CANCEL',
      targetType: 'merchant_subscription',
      targetId: id,
      after: { status: updated.status },
    });
    return this.toView(updated);
  }

  /** 订单列表：商家只看自己；平台可看全部 */
  async list(query: QuerySubscriptionsDto, user: JwtPayload) {
    const where: Prisma.MerchantSubscriptionWhereInput = {};
    if (user.userType !== 'PLATFORM') {
      where.merchantId = user.merchantId ?? -1;
    } else if (query.merchantId) {
      where.merchantId = query.merchantId;
    }
    if (query.planType) where.planType = query.planType as MerchantPlanType;
    if (query.status) where.status = query.status as SubscriptionStatus;

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.merchantSubscription.count({ where }),
      this.prisma.merchantSubscription.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { merchant: { select: { id: true, name: true, code: true } } },
      }),
    ]);

    return {
      total,
      page: query.page,
      pageSize: query.pageSize,
      items: rows.map((row) => ({
        ...this.toView(row),
        merchantName: row.merchant?.name ?? null,
        merchantCode: row.merchant?.code ?? null,
      })),
    };
  }

  private toView(
    row: {
      id: number;
      merchantId: number;
      planType: MerchantPlanType;
      tier: SubTier | null;
      period: PlanPeriod;
      amount: Prisma.Decimal;
      startsAt: Date | null;
      endsAt: Date | null;
      status: SubscriptionStatus;
      orderNo: string;
      payChannel: string;
      payRemark: string | null;
      remark: string | null;
      createdAt: Date;
    },
    extra: Record<string, unknown> = {},
  ) {
    return {
      id: row.id,
      merchantId: row.merchantId,
      planType: row.planType,
      tier: row.tier,
      tierName: row.tier ? SUB_TIER_NAME[row.tier] : null,
      tierColor: row.tier ? SUB_TIER_COLOR[row.tier] : null,
      period: row.period,
      periodName: PERIOD_NAME[row.period],
      months: PERIOD_MONTHS[row.period],
      amount: Number(row.amount),
      startsAt: row.startsAt ? row.startsAt.toISOString() : null,
      endsAt: row.endsAt ? row.endsAt.toISOString() : null,
      status: row.status,
      orderNo: row.orderNo,
      payChannel: row.payChannel,
      payRemark: row.payRemark,
      remark: row.remark,
      createdAt: row.createdAt.toISOString(),
      ...extra,
    };
  }

  /** 订阅单号 MS-YYMMDD-XXXXXX */
  private async nextOrderNo(): Promise<string> {
    const ymd = new Date().toISOString().slice(2, 10).replace(/-/g, '');
    for (let i = 0; i < 10; i++) {
      const no = `MS-${ymd}-${randomInt(100000, 999999)}`;
      const exists = await this.prisma.merchantSubscription.findUnique({
        where: { orderNo: no },
        select: { id: true },
      });
      if (!exists) return no;
    }
    throw BizException.conflict(ReasonCode.CONCURRENT_UPDATE, '生成订阅单号失败，请重试');
  }
}
