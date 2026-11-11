import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import {
  ApplyScope,
  CouponCodeStatus,
  CouponInstanceStatus,
  CouponTemplateStatus,
  MerchantType,
  OrderSource,
  OrderStatus,
  OrderType,
  Prisma,
  RedemptionChannel,
  RedemptionStatus,
} from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import {
  CreateRedemptionDto,
  QueryRedemptionsDto,
  ReverseRedemptionDto,
  VerifyCouponDto,
} from './dto/redemption.dto';

/** 审计动作名 */
const ACTION = {
  redeem: 'redemption:create',
  reverse: 'redemption:reverse',
} as const;

/**
 * 冲正时间窗：附属商家 / 店员只能冲正 **24 小时内** 自己的核销记录。
 *
 * 理由：冲正是资金相关操作，越接近事发时刻越容易查清（监控、小票、当班店员）。
 * 隔天的记录可能已经过账、已结算，再让门店自行回滚风险太高 —— 这种情况必须走主体商家
 * （无时间窗限制，因为他掌握全平台账目）。
 */
const REVERSE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** MySQL 1213：死锁。Prisma 原始查询失败时码是 P2010，信息里带 1213；交互式事务有时是 P2034。 */
function isMysqlDeadlock(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; message?: string; meta?: { code?: string } };
  const blob = `${err.code ?? ''} ${err.message ?? ''} ${err.meta?.code ?? ''}`;
  return blob.includes('1213') || err.code === 'P2034';
}

/**
 * 是否撞在幂等键唯一索引上（P2002 且 meta.target 含 requestId）。
 * 同键并发时赢家已提交，输家应回读重放，而不是当成「券已使用」冲突。
 */
function isRequestIdRace(e: unknown): boolean {
  if (!e || typeof e !== 'object') return false;
  const err = e as { code?: string; meta?: { target?: unknown } };
  if (err.code !== 'P2002') return false;
  const target = err.meta?.target;
  const text = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return text.includes('requestId');
}

/**
 * 校验失败 → HTTP 状态映射
 *
 * 硬约束里每条失败都有明确的 HTTP 语义：券不存在 404、越权/越门店 403、状态冲突 409。
 * verify 与 redeem 共用这套映射，不存在「verify 说 200、执行时变 409」的口径差。
 */
function httpStatusFor(reasonCode: string): HttpStatus {
  switch (reasonCode) {
    case ReasonCode.CODE_NOT_FOUND:
    case ReasonCode.RESOURCE_NOT_FOUND:
      return HttpStatus.NOT_FOUND;
    case ReasonCode.STORE_NOT_IN_SCOPE:
    case ReasonCode.STORE_NOT_OWNED:
    case ReasonCode.FORBIDDEN_SCOPE:
      return HttpStatus.FORBIDDEN;
    case ReasonCode.THRESHOLD_NOT_MET:
    case ReasonCode.REQUIRE_GREATER_THAN_FACE:
    case ReasonCode.PRODUCT_NOT_IN_SCOPE:
      return HttpStatus.BAD_REQUEST;
    default:
      return HttpStatus.CONFLICT;
  }
}

/** 逐项校验结果（verify 返回给前端，前端可逐条展示「为什么不能用」） */
export interface CheckItem {
  item: string;
  passed: boolean;
  reasonCode?: string;
  message?: string;
}

/**
 * 核销（S2.3）—— 整个 S2 里资金风险最高的接口，所以每条约束都是**硬拒绝**而非软提示。
 *
 * ## 幂等：为什么一定不会出现两条 SUCCESS
 *
 * 1. 券实例状态用**条件更新**翻转：
 *    `UPDATE coupon_instances SET status='USED' WHERE id=? AND status='UNUSED'`，
 *    影响行数 0 → 按当前真实状态回报 `COUPON_ALREADY_USED` / `COUPON_FROZEN` / `COUPON_EXPIRED`。
 *    并发下两个事务被行锁串行化，第二个必然拿到 0 行，不会 500，也不会产生第二条记录。
 * 2. 数据库层再兜一道：`redemption_records` 上 `@@unique([couponInstanceId, status])`，
 *    同一张券不可能存在两条 `SUCCESS`（命中 P2002 同样翻译为 409）。
 * 3. 冲正后记录变 `REVERSED`，唯一索引的 SUCCESS 槽位被释放，所以「冲正 → 再次核销」是允许的，
 *    这也是冲正与「删除记录」的区别。
 *
 * ## 一单一券（H3）
 *
 * `orders.couponInstanceId` 是唯一索引。核销时若订单已绑定别的券 → 409 `ORDER_ALREADY_HAS_COUPON`；
 * 绑定本身也是条件更新（`WHERE couponInstanceId IS NULL`），并发下不会绑重。
 *
 * ## verify 与执行核销的关系
 *
 * 两者跑**同一套**校验流水线（`runChecks`），verify 只是不落库。这样不存在
 * 「verify 说能核销、执行时又失败」的规则漂移 —— 唯一的差异是并发窗口（别人抢先核销），
 * 这时执行阶段的条件更新会如实返回 409。
 */
@Injectable()
export class RedemptionService {
  private readonly logger = new Logger('Redemption');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- 校验（只读）

  /**
   * 核销前置校验：只读，返回券信息 + 可否核销 + 原因 + 逐项检查明细
   */
  async verify(dto: VerifyCouponDto, user: JwtPayload) {
    const ctx = await this.resolveContext(dto, user);

    // 券码本身不存在：与「券码已存在但未发放」区分开（404 vs 409）
    if (!ctx.instance) {
      throw new BizException(
        ReasonCode.CODE_NOT_FOUND,
        `券码 ${dto.code} 不存在`,
        HttpStatus.NOT_FOUND,
        { redeemable: false, coupon: null, store: ctx.store ? { id: ctx.store.id, name: ctx.store.name } : null, checks: ctx.checks },
      );
    }

    const { failure, checks } = await this.runChecks(ctx, dto);
    const instance = ctx.instance;
    const coupon = {
      instanceId: instance.id,
      code: instance.code,
      templateId: instance.templateId,
      templateName: instance.template?.name ?? null,
      faceValue: Number(instance.template?.faceValue ?? 0),
      thresholdAmount: Number(instance.template?.thresholdAmount ?? 0),
      status: instance.status,
      userId: instance.userId,
      userName: instance.user?.nickname ?? null,
      userPhone: instance.user?.phone ?? null,
      expireAt: instance.expireAt,
      applyScope: instance.template?.applyScope ?? null,
      stores: (instance.template?.stores ?? []).map((s) => ({ id: s.store.id, name: s.store.name })),
    };
    const store = ctx.store ? { id: ctx.store.id, name: ctx.store.name } : null;

    // 失败也要返回明确 HTTP 状态（404/403/409），但把券信息与逐项明细一起带回，
    // 前端既能按 reasonCode 提示，也能展示「这张券是什么、卡在哪一步」。
    if (failure) {
      throw new BizException(failure.reasonCode, failure.message, httpStatusFor(failure.reasonCode), {
        redeemable: false,
        coupon,
        store,
        checks,
      });
    }

    return {
      redeemable: true,
      reasonCode: null,
      reason: null,
      coupon,
      store,
      discountAmount: ctx.discountAmount,
      checks,
    };
  }

  // ---------------------------------------------------------------- 执行核销

  async redeem(dto: CreateRedemptionDto, user: JwtPayload, ip?: string, ua?: string) {
    const ctx = await this.resolveContext(dto, user);
    if (!ctx.instance) {
      throw BizException.notFound(ReasonCode.CODE_NOT_FOUND, `券码 ${dto.code} 不存在`);
    }

    // ① 幂等键命中 → 直接回上次核销结果（200 + idempotent:true）。
    // 必须放在 runChecks **之前**：否则重试会先被「券已使用」拦成 409，
    // 客户端就分不清「重试成功」和「真的冲突了」（与 point.service exchange 同口径）。
    if (dto.requestId) {
      const exist = await this.prisma.redemptionRecord.findFirst({
        where: {
          requestId: dto.requestId,
          userId: ctx.instance.userId,
          status: RedemptionStatus.SUCCESS,
        },
      });
      if (exist) {
        return { ...exist, idempotent: true };
      }
    }

    const { failure } = await this.runChecks(ctx, dto);
    if (failure) {
      throw new BizException(failure.reasonCode, failure.message, httpStatusFor(failure.reasonCode));
    }

    const instance = ctx.instance;
    const store = ctx.store!;
    const faceValue = Number(instance.template.faceValue);
    const totalAmount = dto.orderAmount ?? faceValue;
    const discountAmount = ctx.discountAmount;

    // 同一模板的 usedCount 行会被多笔核销一起更新。InnoDB 在券实例行和模板行之间
    // 可能报 1213 死锁。事务会整体回滚，重试不会留下半笔核销。
    for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 先锁模板行，让同一张券的并发核销排队，避免和券实例行互相等出 1213。
        await tx.$queryRaw(Prisma.sql`SELECT id FROM coupon_templates WHERE id = ${instance.templateId} FOR UPDATE`);
        // ① 一单一券：订单存在则条件绑定（并发下不会绑重），不存在则建单
        let orderId: number | null = null;
        const existing = await tx.order.findUnique({
          where: { orderNo: dto.orderNo },
          select: { id: true, userId: true, couponInstanceId: true },
        });

        if (existing) {
          if (existing.userId !== instance.userId) {
            throw BizException.conflict(
              ReasonCode.COUPON_NOT_BELONG_TO_USER,
              `订单 ${dto.orderNo} 不属于该券的持有用户`,
            );
          }
          if (existing.couponInstanceId && existing.couponInstanceId !== instance.id) {
            throw BizException.conflict(
              ReasonCode.ORDER_ALREADY_HAS_COUPON,
              `订单 ${dto.orderNo} 已使用其他代金券，同一订单只能用一张券`,
            );
          }
          const bound = await tx.$executeRaw(
            Prisma.sql`UPDATE orders SET couponInstanceId = ${instance.id}, discountAmount = ${discountAmount}, payAmount = totalAmount - ${discountAmount}, updatedAt = NOW() WHERE id = ${existing.id} AND couponInstanceId IS NULL`,
          );
          if (bound === 0 && existing.couponInstanceId !== instance.id) {
            throw BizException.conflict(
              ReasonCode.ORDER_ALREADY_HAS_COUPON,
              `订单 ${dto.orderNo} 已使用其他代金券，同一订单只能用一张券`,
            );
          }
          orderId = existing.id;
        } else {
          const created = await tx.order.create({
            data: {
              orderNo: dto.orderNo,
              userId: instance.userId,
              merchantId: store.merchantId,
              storeId: store.id,
              orderType: OrderType.CONSUME,
              totalAmount,
              discountAmount,
              payAmount: Number((totalAmount - discountAmount).toFixed(2)),
              couponInstanceId: instance.id,
              status: OrderStatus.NORMAL,
              source: (dto.orderSource as OrderSource) ?? OrderSource.WEB,
              consumeTime: new Date(),
            },
            select: { id: true },
          });
          orderId = created.id;
        }

        // ② 券实例：条件更新是幂等的核心（并发第二个事务必然拿到 0 行）
        const flipped = await tx.$executeRaw(
          Prisma.sql`UPDATE coupon_instances SET status = 'USED', usedAt = NOW(), updatedAt = NOW() WHERE id = ${instance.id} AND status = 'UNUSED'`,
        );
        if (flipped === 0) {
          const current = await tx.couponInstance.findUnique({
            where: { id: instance.id },
            select: { status: true },
          });
          const status = current?.status ?? CouponInstanceStatus.USED;
          const reasonCode =
            status === CouponInstanceStatus.FROZEN
              ? ReasonCode.COUPON_FROZEN
              : status === CouponInstanceStatus.EXPIRED
                ? ReasonCode.COUPON_EXPIRED
                : ReasonCode.COUPON_ALREADY_USED;
          throw BizException.conflict(reasonCode, `券 ${instance.code} 当前状态为 ${status}，不可核销`);
        }

        // ③ 券码 REDEEMED + 模板已核销计数（原子自增，不做「先读再写」）
        if (ctx.codeRowId) {
          await tx.$executeRaw(
            Prisma.sql`UPDATE coupon_codes SET status = 'REDEEMED' WHERE id = ${ctx.codeRowId} AND status IN ('ISSUED')`,
          );
        }
        await tx.$executeRaw(
          Prisma.sql`UPDATE coupon_templates SET usedCount = usedCount + 1, updatedAt = NOW() WHERE id = ${instance.templateId}`,
        );

        // ④ 核销记录（唯一索引 [couponInstanceId, status] 兜底：命中 P2002 → 409）
        const record = await tx.redemptionRecord.create({
          data: {
            couponInstanceId: instance.id,
            code: instance.code ?? dto.code,
            userId: instance.userId,
            storeId: store.id,
            merchantId: store.merchantId,
            operatorId: user.sub,
            templateId: instance.templateId,
            faceValue,
            discountAmount,
            orderId,
            channel: (dto.channel as RedemptionChannel) ?? RedemptionChannel.MANUAL,
            status: RedemptionStatus.SUCCESS,
            requestId: dto.requestId ?? null,
            redeemedAt: new Date(),
          },
        });

        // ⑤ 审计
        await this.audit.record(
          {
            operatorId: user.sub,
            operatorType: user.userType,
            operatorName: user.username,
            module: 'redemption',
            action: ACTION.redeem,
            targetType: 'redemption_record',
            targetId: record.id,
            before: { instanceId: instance.id, status: CouponInstanceStatus.UNUSED },
            after: {
              redemptionId: record.id,
              code: record.code,
              instanceId: instance.id,
              templateId: instance.templateId,
              userId: instance.userId,
              storeId: store.id,
              merchantId: store.merchantId,
              orderId,
              orderNo: dto.orderNo,
              faceValue,
              discountAmount,
              channel: record.channel,
              requestId: dto.requestId ?? null,
              remark: dto.remark?.trim() || null,
            },
            ip: ip ?? null,
            userAgent: ua ?? null,
          },
          tx,
        );

        return record;
      });
    } catch (e) {
      if (attempt < 2 && isMysqlDeadlock(e)) continue;
      // 同键并发（requestId 唯一索引 P2002）：赢家已提交，输家回读一次按幂等重放，
      // 不把客户端重试当成冲突拒绝。（couponInstanceId+status 索引的 P2002 仍是真冲突，走原映射）
      if (dto.requestId && isRequestIdRace(e)) {
        const exist = await this.prisma.redemptionRecord.findFirst({
          where: {
            requestId: dto.requestId,
            userId: instance.userId,
            status: RedemptionStatus.SUCCESS,
          },
        });
        if (exist) return { ...exist, idempotent: true };
      }
      throw this.translatePrismaConflict(e, instance.code ?? dto.code);
    }
    }
  }

  // ---------------------------------------------------------------- 冲正

  /**
   * 冲正（S2.3）
   *
   * **真实使用场景**（写进 docs/06 S2 收口待办的实际口径）：
   * 1. 订单取消 / 退款：用户结账前反悔，券必须退回，否则用户资产凭空消失；
   * 2. 误核销：店员扫错码、核错单，当场冲正后重新核销正确的券；
   * 3. 异常订单处理（S3）：订单被标记 ABNORMAL 并判定券不应参与结算时冲正。
   *
   * 冲正**不是删除记录** —— 记录保留为 `REVERSED` 以便对账追溯，
   * 券实例回到 `UNUSED`（可再次核销），`orders.couponInstanceId` 清空。
   */
  async reverse(id: number, dto: ReverseRedemptionDto, user: JwtPayload, ip?: string, ua?: string) {
    const record = await this.prisma.redemptionRecord.findUnique({
      where: { id },
      include: {
        couponInstance: {
          include: { template: { select: { id: true, name: true, ownerMerchantId: true, creatorMerchantId: true } } },
        },
        store: { select: { id: true, merchantId: true, name: true } },
      },
    });
    if (!record) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `核销记录 #${id} 不存在`);
    }
    this.assertRecordVisible(record, user);

    if (record.status !== RedemptionStatus.SUCCESS) {
      throw BizException.conflict(
        ReasonCode.REDEMPTION_ALREADY_REVERSED,
        `核销记录 #${id} 当前状态为 ${record.status}，只有 SUCCESS 记录可以冲正`,
      );
    }
    await this.assertReverseAllowed(record, user, id);

    const reason = dto.reason.trim();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.redemptionRecord.update({
        where: { id },
        // 记录双写：原因 + 冲正时间留在记录本体（列表页可见），审计日志再留一份全量快照
        data: { status: RedemptionStatus.REVERSED, reverseReason: reason, reversedAt: new Date() },
      });

      // 券回到未使用（条件更新：只有 USED 才回退，避免把已过期的券「复活」成 UNUSED）
      await tx.$executeRaw(
        Prisma.sql`UPDATE coupon_instances SET status = 'UNUSED', usedAt = NULL, updatedAt = NOW() WHERE id = ${record.couponInstanceId} AND status = 'USED'`,
      );
      await tx.$executeRaw(
        Prisma.sql`UPDATE coupon_codes SET status = 'ISSUED' WHERE instanceId = ${record.couponInstanceId} AND status = 'REDEEMED'`,
      );
      await tx.$executeRaw(
        Prisma.sql`UPDATE coupon_templates SET usedCount = usedCount - 1, updatedAt = NOW() WHERE id = ${record.templateId} AND usedCount >= 1`,
      );
      // 订单解绑：券退回后订单不再挂券，可重新核销别的券
      await tx.$executeRaw(
        Prisma.sql`UPDATE orders SET couponInstanceId = NULL, discountAmount = 0, payAmount = totalAmount, updatedAt = NOW() WHERE couponInstanceId = ${record.couponInstanceId}`,
      );

      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'redemption',
          action: ACTION.reverse,
          targetType: 'redemption_record',
          targetId: id,
          before: { status: record.status, code: record.code, orderId: record.orderId },
          after: { status: updated.status, reason, reversedAt: updated.reversedAt },
          ip: ip ?? null,
          userAgent: ua ?? null,
        },
        tx,
      );

      return {
        record: updated,
        couponStatus: CouponInstanceStatus.UNUSED,
        reason: updated.reverseReason,
      };
    });
  }

  // ---------------------------------------------------------------- 查询

  /**
   * 核销记录列表
   *
   * 数据隔离（H6）：平台全量；主体看「自己门店产生的 + 自己模板产生的」并按商家分组合计；
   * 附属只看自己门店；店员只看自己门店。附属传别人的 `merchantId` → 403 `FORBIDDEN_SCOPE`。
   */
  async list(query: QueryRedemptionsDto, user: JwtPayload) {
    const scope = await this.visibleWhere(user);

    if (query.merchantId && user.userType !== 'PLATFORM' && query.merchantId !== user.merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '只能查询自己商家的核销记录');
    }

    const where: Prisma.RedemptionRecordWhereInput = {
      AND: [
        scope,
        ...(query.merchantId && user.userType === 'PLATFORM' ? [{ merchantId: query.merchantId }] : []),
        ...(query.storeId ? [{ storeId: query.storeId }] : []),
        ...(query.templateId ? [{ templateId: query.templateId }] : []),
        ...(query.userId ? [{ userId: query.userId }] : []),
        ...(query.status ? [{ status: query.status as RedemptionStatus }] : []),
        ...(query.code ? [{ code: { contains: query.code } }] : []),
        ...(query.redeemedFrom || query.redeemedTo
          ? [
              {
                redeemedAt: {
                  ...(query.redeemedFrom ? { gte: new Date(query.redeemedFrom) } : {}),
                  ...(query.redeemedTo ? { lte: new Date(query.redeemedTo) } : {}),
                },
              },
            ]
          : []),
      ],
    };

    const [rows, total, grouped] = await Promise.all([
      this.prisma.redemptionRecord.findMany({
        where,
        orderBy: [{ redeemedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { id: true, nickname: true, phone: true } },
          store: { select: { id: true, name: true } },
          template: { select: { id: true, name: true } },
        },
      }),
      this.prisma.redemptionRecord.count({ where }),
      // 主体视角要「按商家维度分组合计」
      this.prisma.redemptionRecord.groupBy({
        by: ['merchantId'],
        where,
        _count: { _all: true },
        _sum: { faceValue: true, discountAmount: true },
      }),
    ]);

    // 订单号单独取一次（列表要给前台看「这笔核销挂在哪个订单上」，不加 FK 关系避免多一次迁移）
    const orderIds = [...new Set(rows.map((r) => r.orderId).filter((v): v is number => !!v))];
    const orders = orderIds.length
      ? await this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true } })
      : [];
    const orderMap = new Map(orders.map((o) => [o.id, o.orderNo]));

    const merchantIds = [...new Set(grouped.map((g) => g.merchantId).filter((v): v is number => !!v))];
    const merchants = merchantIds.length
      ? await this.prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, name: true } })
      : [];
    const nameMap = new Map(merchants.map((m) => [m.id, m.name]));

    return {
      list: rows.map((r) => ({
        id: r.id,
        code: r.code,
        instanceId: r.couponInstanceId,
        templateId: r.templateId,
        templateName: r.template?.name ?? null,
        userId: r.userId,
        userName: r.user?.nickname ?? null,
        userPhone: r.user?.phone ?? null,
        storeId: r.storeId,
        storeName: r.store?.name ?? null,
        merchantId: r.merchantId,
        merchantName: r.merchantId ? nameMap.get(r.merchantId) ?? null : null,
        faceValue: Number(r.faceValue),
        discountAmount: Number(r.discountAmount),
        orderId: r.orderId,
        orderNo: r.orderId ? orderMap.get(r.orderId) ?? null : null,
        channel: r.channel,
        status: r.status,
        reverseReason: r.reverseReason,
        reversedAt: r.reversedAt,
        redeemedAt: r.redeemedAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
      // 按商家维度分组合计（主体看全平台时用；附属视角只会有一组）
      summary: grouped.map((g) => ({
        merchantId: g.merchantId,
        merchantName: g.merchantId ? nameMap.get(g.merchantId) ?? null : null,
        count: g._count._all,
        faceValueTotal: Number(g._sum.faceValue ?? 0),
        discountTotal: Number(g._sum.discountAmount ?? 0),
      })),
    };
  }

  // ---------------------------------------------------------------- 内部：校验流水线

  /** 解析门店 + 载入券实例（门店归属是身份问题，先于业务校验，403 优先） */
  private async resolveContext(dto: VerifyCouponDto, user: JwtPayload) {
    const store = await this.resolveStore(dto.storeId, user);

    const codeRow = await this.prisma.couponCode.findUnique({
      where: { code: dto.code },
      select: { id: true, status: true, instanceId: true },
    });

    // 券码已生成但还没发给任何人 / 已作废：与「券码不存在」区分开（409 vs 404）
    if (codeRow && (!codeRow.instanceId || codeRow.status === CouponCodeStatus.UNISSUED)) {
      throw new BizException(
        ReasonCode.CODE_NOT_ISSUED,
        `券码 ${dto.code} 尚未发放（${codeRow.status}），无法核销`,
        HttpStatus.CONFLICT,
        { redeemable: false, coupon: null, store: { id: store.id, name: store.name }, checks: [
          { item: '券码存在', passed: true },
          { item: '券码已发放', passed: false, reasonCode: ReasonCode.CODE_NOT_ISSUED },
        ] },
      );
    }
    if (codeRow && codeRow.status === CouponCodeStatus.VOID) {
      throw new BizException(
        ReasonCode.CODE_NOT_ISSUED,
        `券码 ${dto.code} 已作废`,
        HttpStatus.CONFLICT,
        { redeemable: false },
      );
    }

    // 券码表里没有（例如历史数据直接写在实例上）→ 退回按实例冗余字段查
    const instance = codeRow?.instanceId
      ? await this.prisma.couponInstance.findUnique({
          where: { id: codeRow.instanceId },
          include: {
            user: { select: { id: true, nickname: true, phone: true } },
            template: {
              select: {
                id: true,
                name: true,
                faceValue: true,
                thresholdAmount: true,
                applyScope: true,
                status: true,
                ownerMerchantId: true,
                creatorMerchantId: true,
                requireGreaterThanFace: true,
                applicableScope: true,
                allianceId: true,
                stores: { select: { store: { select: { id: true, name: true } } } },
              },
            },
          },
        })
      : await this.prisma.couponInstance.findFirst({
          where: { code: dto.code },
          include: {
            user: { select: { id: true, nickname: true, phone: true } },
            template: {
              select: {
                id: true,
                name: true,
                faceValue: true,
                thresholdAmount: true,
                applyScope: true,
                status: true,
                ownerMerchantId: true,
                creatorMerchantId: true,
                requireGreaterThanFace: true,
                applicableScope: true,
                allianceId: true,
                stores: { select: { store: { select: { id: true, name: true } } } },
              },
            },
          },
        });

    const checks: CheckItem[] = [
      // 通过项不带 reasonCode，避免前端把「CODE_NOT_FOUND」显示在通过行的原因列里
      { item: '券码存在', passed: !!codeRow || !!instance, ...(codeRow || instance ? {} : { reasonCode: ReasonCode.CODE_NOT_FOUND }) },
    ];
    if (codeRow && !codeRow.instanceId) {
      checks.push({
        item: '券码已发放',
        passed: false,
        reasonCode: ReasonCode.CODE_NOT_ISSUED,
        message: `券码 ${dto.code} 尚未发放（${codeRow.status}）`,
      });
    }

    const threshold = Number(instance?.template?.thresholdAmount ?? 0);
    const faceValue = Number(instance?.template?.faceValue ?? 0);
    const discountAmount = Math.min(faceValue, dto.orderAmount ?? faceValue);

    return { store, codeRowId: codeRow?.id ?? null, codeRowStatus: codeRow?.status ?? null, instance, checks, threshold, faceValue, discountAmount };
  }

  /**
   * 校验流水线：返回失败项（第一个失败即停）与逐项明细
   *
   * verify 与 redeem **共用**，避免两处规则漂移。
   */
  private async runChecks(
    ctx: Awaited<ReturnType<RedemptionService['resolveContext']>>,
    dto: VerifyCouponDto,
  ): Promise<{ failure: { reasonCode: string; message: string } | null; checks: CheckItem[] }> {
    const checks = [...ctx.checks];
    const instance = ctx.instance!;
    const fail = (item: string, reasonCode: string, message: string) => {
      checks.push({ item, passed: false, reasonCode, message });
      return { failure: { reasonCode, message }, checks };
    };
    const pass = (item: string) => checks.push({ item, passed: true });

    if (ctx.codeRowStatus === CouponCodeStatus.UNISSUED) {
      return fail('券码已发放', ReasonCode.CODE_NOT_ISSUED, `券码 ${dto.code} 尚未发放，无法核销`);
    }
    if (ctx.codeRowStatus === CouponCodeStatus.VOID) {
      return fail('券码有效', ReasonCode.CODE_NOT_ISSUED, `券码 ${dto.code} 已作废`);
    }
    pass('券码已发放');

    // ① 券实例状态
    if (instance.status === CouponInstanceStatus.USED) {
      return fail('券未使用', ReasonCode.COUPON_ALREADY_USED, `券 ${instance.code} 已被核销（${instance.usedAt}）`);
    }
    if (instance.status === CouponInstanceStatus.FROZEN) {
      return fail('券未冻结', ReasonCode.COUPON_FROZEN, `券 ${instance.code} 已被冻结，请先解冻`);
    }
    if (instance.status === CouponInstanceStatus.EXPIRED) {
      return fail('券未过期', ReasonCode.COUPON_EXPIRED, `券 ${instance.code} 已过期（${instance.expireAt}）`);
    }
    pass('券状态为未使用');

    // ② 有效期（状态可能因批处理滞后，这里按时间再判一次）
    if (instance.expireAt.getTime() <= Date.now()) {
      return fail('券未过期', ReasonCode.COUPON_EXPIRED, `券 ${instance.code} 已于 ${instance.expireAt} 过期`);
    }
    pass('在有效期内');

    // ③ 模板未下架
    if (instance.template.status !== CouponTemplateStatus.PUBLISHED) {
      return fail(
        '券模板已上架',
        ReasonCode.TEMPLATE_NOT_AVAILABLE,
        `券模板「${instance.template.name}」当前状态为 ${instance.template.status}，不可核销`,
      );
    }
    pass('券模板已上架');

    // ④ 门店归属（403，身份问题）
    const store = ctx.store!;
    pass(`门店归属（${store.name}）`);

    // ④b 联盟校验已取消：会员端不再有联盟概念，券能不能用只看「适用范围」。
    // 只要核销门店在券的适用商家/门店范围内即可，跨联盟的券也允许核销。

    // ⑤ 适用范围
    const scope = instance.template.applyScope;
    if (scope === ApplyScope.SPECIFIED_STORES) {
      const allowed = instance.template.stores.some((s) => s.store.id === store.id);
      if (!allowed) {
        return fail(
          '门店在适用范围内',
          ReasonCode.STORE_NOT_IN_SCOPE,
          `券「${instance.template.name}」仅限 ${instance.template.stores.map((s) => s.store.name).join('、')} 使用，当前门店 ${store.name} 不在范围内`,
        );
      }
      pass('门店在适用范围内');
    } else if (scope !== ApplyScope.ALL_STORES) {
      // SPECIFIED_MERCHANTS 尚未实现（与 S2.1 一致）
      return fail('适用范围', ReasonCode.APPLY_SCOPE_UNSUPPORTED, `适用范围 ${scope} 暂未实现`);
    } else {
      pass('全部门店可用');
    }

    // ⑥ 券归属用户（H5 自助核销场景）
    if (dto.userId && dto.userId !== instance.userId) {
      return fail('券属于当前用户', ReasonCode.COUPON_NOT_BELONG_TO_USER, `券 ${instance.code} 不属于用户 #${dto.userId}`);
    }
    if (dto.userId) pass('券属于当前用户');

    // ⑦ 满减门槛
    if (dto.orderAmount !== undefined && ctx.threshold > 0 && dto.orderAmount < ctx.threshold) {
      return fail(
        '满足使用门槛',
        ReasonCode.THRESHOLD_NOT_MET,
        `订单金额 ${dto.orderAmount} 未达到门槛 ${ctx.threshold}`,
      );
    }
    if (ctx.threshold > 0) pass(`满足使用门槛（满 ${ctx.threshold}）`);

    // ⑦b 商家自选：实付必须大于面值（未开启则不拦，哪怕实付 1 元、面值 15 元）
    if (instance.template.requireGreaterThanFace) {
      const orderAmount = dto.orderAmount;
      if (orderAmount === undefined || orderAmount === null) {
        return fail(
          '实付大于面值',
          ReasonCode.REQUIRE_GREATER_THAN_FACE,
          '该券要求实际支付金额必须大于券面值，请填写订单金额',
        );
      }
      if (orderAmount <= ctx.faceValue) {
        return fail(
          '实付大于面值',
          ReasonCode.REQUIRE_GREATER_THAN_FACE,
          '该券要求实际支付金额必须大于券面值，请增加消费金额',
        );
      }
      pass(`实付 ${orderAmount} > 面值 ${ctx.faceValue}`);
    }

    // ⑦c 适用商品范围（传了 productIds 才校验；未传则跳过，兼容旧收银）
    const productScope = (instance.template.applicableScope as { productScope?: string; productIds?: string[] } | null)
      ?.productScope;
    const allowedProducts = ((instance.template.applicableScope as { productIds?: string[] } | null)?.productIds ?? []).map(
      String,
    );
    if (dto.productIds?.length) {
      if (productScope === 'SPECIFIED') {
        const hit = dto.productIds.some((id) => allowedProducts.includes(String(id)));
        if (!hit) {
          return fail(
            '商品在适用范围内',
            ReasonCode.PRODUCT_NOT_IN_SCOPE,
            `该券仅限指定商品可用（${allowedProducts.slice(0, 5).join('、') || '未配置'}），本单商品均不在范围内`,
          );
        }
        pass('商品在指定可用范围内');
      } else if (productScope === 'EXCLUDE_SALE') {
        // 约定：以 SALE- / SPECIAL- 前缀标记特价 SKU；也可由收银把特价 ID 放入 productIds 并配合此开关
        const saleHit = dto.productIds.some(
          (id) => String(id).startsWith('SALE-') || String(id).startsWith('SPECIAL-'),
        );
        if (saleHit) {
          return fail(
            '排除特价商品',
            ReasonCode.PRODUCT_NOT_IN_SCOPE,
            '该券不可用于特价商品，请调整商品后重试',
          );
        }
        pass('本单不含特价商品');
      }
    }

    // ⑧ 一单一券（verify 阶段也拦，避免用户走到确认弹窗才失败）
    if (dto.orderNo) {
      const order = await this.prisma.order.findUnique({
        where: { orderNo: dto.orderNo },
        select: { id: true, couponInstanceId: true, userId: true },
      });
      if (order?.couponInstanceId && order.couponInstanceId !== instance.id) {
        return fail(
          '订单未使用其他券',
          ReasonCode.ORDER_ALREADY_HAS_COUPON,
          `订单 ${dto.orderNo} 已使用其他代金券，同一订单只能用一张券`,
        );
      }
      if (order && order.userId !== instance.userId) {
        return fail('订单归属', ReasonCode.COUPON_NOT_BELONG_TO_USER, `订单 ${dto.orderNo} 不属于该券的持有用户`);
      }
      if (order) pass('订单未使用其他券');
    }

    return { failure: null, checks };
  }

  // ---------------------------------------------------------------- 内部：门店与作用域

  /**
   * 门店归属（H6）
   *
   * - 店员：只能用自己 JWT 上的门店，传别的门店 → 403 `STORE_NOT_OWNED`；
   * - 附属商家：门店必须属于自己；
   * - 主体商家：自己名下门店，或自己子商家（附属）的门店；
   * - 平台：任意门店。
   */
  private async resolveStore(storeId: number | undefined, user: JwtPayload) {
    if (user.userType === 'STORE') {
      const own = user.storeId;
      if (storeId && own && storeId !== own) {
        throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, `店员只能在本门店（#${own}）核销`);
      }
      const id = storeId ?? own;
      if (!id) {
        throw BizException.badRequest(ReasonCode.STORE_REQUIRED, '当前账号未绑定门店，必须指定 storeId');
      }
      return this.loadStore(id);
    }

    const id = storeId;
    if (!id) {
      throw BizException.badRequest(ReasonCode.STORE_REQUIRED, '必须指定核销门店 storeId');
    }
    const store = await this.loadStore(id);

    if (user.userType === 'PLATFORM') return store;

    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    if (store.merchantId === merchantId) return store;

    // 主体商家：子商家（附属）的门店也算自己体系内
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { type: true },
    });
    if (merchant?.type === MerchantType.MAIN) {
      const owner = await this.prisma.merchant.findUnique({
        where: { id: store.merchantId },
        select: { parentId: true },
      });
      if (owner?.parentId === merchantId) return store;
    }
    throw BizException.forbidden(
      ReasonCode.STORE_NOT_OWNED,
      `门店「${store.name}」不属于当前商家，不能在此核销`,
    );
  }

  private async loadStore(id: number) {
    const store = await this.prisma.store.findUnique({
      where: { id },
      select: { id: true, name: true, merchantId: true, status: true },
    });
    if (!store) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `门店 #${id} 不存在`);
    }
    return store;
  }

  /**
   * 冲正权限收紧（S2.4）
   *
   * - 平台 / 主体商家：无时间窗（他掌握全平台账目）；
   * - 附属商家：只能冲正**自己商家门店**的记录，且必须在核销后 **24 小时内** → 超时 403 `REVERSE_WINDOW_EXPIRED`；
   * - 店员：只能冲正**自己门店**的记录，同样受 24 小时窗限制。
   */
  private async assertReverseAllowed(
    record: { redeemedAt: Date; storeId: number | null; merchantId: number | null },
    user: JwtPayload,
    id: number,
  ) {
    if (user.userType === 'PLATFORM') return;

    if (user.userType === 'MERCHANT') {
      const merchantId = user.merchantId;
      if (!merchantId) {
        throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
      }
      const merchant = await this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { type: true },
      });
      if (merchant?.type === MerchantType.MAIN) return; // 主体：不限时间窗
      if (record.merchantId !== merchantId) {
        throw BizException.forbidden(
          ReasonCode.STORE_NOT_OWNED,
          `核销记录 #${id} 的门店不属于当前商家，跨店冲正需主体商家操作`,
        );
      }
    }

    if (user.userType === 'STORE' && record.storeId !== user.storeId) {
      throw BizException.forbidden(
        ReasonCode.STORE_NOT_OWNED,
        `核销记录 #${id} 不属于当前门店，跨店冲正需主体商家操作`,
      );
    }

    const ageHours = Math.floor((Date.now() - new Date(record.redeemedAt).getTime()) / (60 * 60 * 1000));
    if (Date.now() - new Date(record.redeemedAt).getTime() > REVERSE_WINDOW_MS) {
      throw BizException.forbidden(
        ReasonCode.REVERSE_WINDOW_EXPIRED,
        `核销记录 #${id} 核销于 ${ageHours} 小时前，已超过 24 小时冲正窗口，请联系主体商家操作`,
      );
    }
  }

  private async visibleWhere(user: JwtPayload): Promise<Prisma.RedemptionRecordWhereInput> {
    if (user.userType === 'PLATFORM') return {};
    if (user.userType === 'STORE') {
      if (!user.storeId) {
        throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定门店');
      }
      return { storeId: user.storeId };
    }

    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { type: true },
    });
    // 主体：自己门店产生的 + 自己模板产生的（代发的主体券在子门店被核销也算）
    if (merchant?.type === MerchantType.MAIN) {
      return {
        OR: [{ merchantId }, { template: { ownerMerchantId: merchantId } }],
      };
    }
    // 附属：只看自己门店
    return { merchantId };
  }

  private assertRecordVisible(
    record: { merchantId: number | null; storeId: number | null; couponInstance: { template: { ownerMerchantId: number; creatorMerchantId: number } } },
    user: JwtPayload,
  ) {
    if (user.userType === 'PLATFORM') return;
    if (user.userType === 'STORE') {
      if (record.storeId !== user.storeId) {
        throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '核销记录不存在或不在你的可见范围内');
      }
      return;
    }
    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    const visible =
      record.merchantId === merchantId ||
      record.couponInstance.template.ownerMerchantId === merchantId ||
      record.couponInstance.template.creatorMerchantId === merchantId;
    if (!visible) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '核销记录不存在或不在你的可见范围内');
    }
  }

  /** 唯一索引兜底：并发下第二条 SUCCESS 会命中 P2002，翻译成 409 而不是 500 */
  private translatePrismaConflict(e: unknown, code: string): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return BizException.conflict(
        ReasonCode.COUPON_ALREADY_USED,
        `券 ${code} 已存在成功的核销记录，不能重复核销`,
      );
    }
    return e;
  }
}
