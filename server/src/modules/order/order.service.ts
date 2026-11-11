import { Injectable, Logger } from '@nestjs/common';
import { MerchantType, OrderStatus, Prisma } from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import { ConcurrentSignal, PointService } from '../point/point.service';
import { CreateOrderDto, HandleOrderDto, MarkAbnormalDto, QueryOrdersDto } from './dto/order.dto';

const MAX_RETRY = 3;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 审计动作名 */
const ACTION = {
  create: 'ORDER_CREATE',
  markAbnormal: 'ORDER_MARK_ABNORMAL',
  handle: 'ORDER_HANDLE',
} as const;

/**
 * 订单管理 + 异常订单处理（S3.4）
 *
 * 数据隔离口径（与积分 / 核销一致）：
 *  - 平台：全量；
 *  - 主体商家：自己 + 直属附属（= 全平台主体侧）；
 *  - 附属商家 / 店员：只看本店 / 本门店。
 */
@Injectable()
export class OrderService {
  private readonly logger = new Logger('Order');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly points: PointService,
  ) {}

  // ---------------------------------------------------------------- 查询

  async list(query: QueryOrdersDto, user: JwtPayload) {
    const scope = await this.orderScope(user);
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);

    const where: Prisma.OrderWhereInput = {
      AND: [
        scope,
        {
          ...(query.status ? { status: query.status as OrderStatus } : {}),
          ...(query.orderNo ? { orderNo: { contains: query.orderNo } } : {}),
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.storeId ? { storeId: query.storeId } : {}),
          ...(query.from || query.to ? { createdAt } : {}),
        },
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        orderBy: [{ id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { id: true, nickname: true, phone: true } },
          couponInstance: { select: { id: true, code: true, status: true } },
          store: { select: { id: true, name: true } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    const merchantIds = [...new Set(rows.map((r) => r.merchantId))];
    const merchants = merchantIds.length
      ? await this.prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, name: true } })
      : [];
    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));

    return {
      list: rows.map((r) => ({
        id: r.id,
        orderNo: r.orderNo,
        userId: r.userId,
        userName: r.user?.nickname ?? null,
        userPhone: r.user?.phone ?? null,
        merchantId: r.merchantId,
        merchantName: merchantMap.get(r.merchantId) ?? null,
        storeId: r.storeId,
        storeName: r.store?.name ?? null,
        orderType: r.orderType,
        totalAmount: Number(r.totalAmount),
        payAmount: Number(r.payAmount),
        pointsEarned: r.pointsEarned,
        status: r.status,
        abnormalType: r.abnormalType,
        couponInstanceId: r.couponInstanceId,
        couponCode: r.couponInstance?.code ?? null,
        couponStatus: r.couponInstance?.status ?? null,
        handleResult: r.handleResult,
        handledAt: r.handledAt,
        consumeTime: r.consumeTime,
        createdAt: r.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async detail(id: number, user: JwtPayload) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, nickname: true, phone: true } },
        store: { select: { id: true, name: true } },
        couponInstance: {
          include: { template: { select: { id: true, name: true, faceValue: true, thresholdAmount: true } } },
        },
      },
    });
    if (!order) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `订单 #${id} 不存在`);
    await this.assertOrderVisible(order, user);

    const merchant = await this.prisma.merchant.findUnique({ where: { id: order.merchantId }, select: { name: true } });
    const redemptions = await this.prisma.redemptionRecord.findMany({
      where: { OR: [{ orderId: order.id }, { couponInstanceId: order.couponInstanceId ?? -1 }] },
      orderBy: { redeemedAt: 'desc' },
    });
    const pointTxns = await this.prisma.pointTransaction.findMany({
      where: {
        OR: [
          { relatedOrderId: order.id },
          ...(order.couponInstanceId ? [{ relatedCouponInstanceId: order.couponInstanceId }] : []),
        ],
      },
      orderBy: { id: 'asc' },
    });

    return {
      order: {
        id: order.id,
        orderNo: order.orderNo,
        userId: order.userId,
        userName: order.user?.nickname ?? null,
        userPhone: order.user?.phone ?? null,
        merchantId: order.merchantId,
        merchantName: merchant?.name ?? null,
        storeId: order.storeId,
        storeName: order.store?.name ?? null,
        orderType: order.orderType,
        totalAmount: Number(order.totalAmount),
        discountAmount: Number(order.discountAmount),
        payAmount: Number(order.payAmount),
        pointsEarned: order.pointsEarned,
        status: order.status,
        abnormalType: order.abnormalType,
        abnormalRemark: order.abnormalRemark,
        handledBy: order.handledBy,
        handledAt: order.handledAt,
        handleResult: order.handleResult,
        source: order.source,
        consumeTime: order.consumeTime,
        createdAt: order.createdAt,
        couponInstance: order.couponInstance
          ? {
              id: order.couponInstance.id,
              code: order.couponInstance.code,
              status: order.couponInstance.status,
              templateName: order.couponInstance.template?.name ?? null,
              faceValue: Number(order.couponInstance.template?.faceValue ?? 0),
            }
          : null,
      },
      redemptions: redemptions.map((r) => ({
        id: r.id,
        code: r.code,
        status: r.status,
        faceValue: Number(r.faceValue),
        discountAmount: Number(r.discountAmount),
        redeemedAt: r.redeemedAt,
        reverseReason: r.reverseReason,
        reversedAt: r.reversedAt,
      })),
      pointTxns: pointTxns.map((p) => ({
        id: p.id,
        type: p.type,
        amount: p.amount,
        remainingAmount: p.remainingAmount,
        balanceAfter: p.balanceAfter,
        sourceTransactionId: p.sourceTransactionId,
        originBatchId: p.originBatchId,
        relatedOrderId: p.relatedOrderId,
        relatedCouponInstanceId: p.relatedCouponInstanceId,
        remark: p.remark,
        createdAt: p.createdAt,
      })),
    };
  }

  async listAbnormal(query: QueryOrdersDto, user: JwtPayload) {
    return this.list({ ...query, status: 'ABNORMAL' }, user);
  }

  // ---------------------------------------------------------------- 写操作

  /** 后台补录订单（消费订单，可顺带走 /points/earn 送积分） */
  async create(dto: CreateOrderDto, user: JwtPayload, ip?: string, ua?: string) {
    const { merchantId, storeId } = await this.resolveCreateScope(dto, user);

    const order = await this.prisma.order.create({
      data: {
        orderNo: dto.orderNo,
        userId: dto.userId,
        merchantId,
        storeId,
        orderType: dto.orderType ?? 'CONSUME',
        totalAmount: dto.totalAmount,
        discountAmount: dto.discountAmount ?? 0,
        payAmount: dto.payAmount ?? dto.totalAmount,
        source: dto.source ?? 'IMPORT',
      },
    });

    let points: unknown = null;
    if (dto.amount !== undefined && dto.amount > 0) {
      try {
        // 多联盟：订单录单送分默认写入该商家首个联盟；无绑定则星链商盟
        const membership = await this.prisma.merchantAlliance.findFirst({
          where: { merchantId },
          orderBy: { allianceId: 'asc' },
          select: { allianceId: true },
        });
        points = await this.points.earn(
          {
            userId: dto.userId,
            amount: dto.amount,
            allianceId: membership?.allianceId ?? 1,
            orderId: order.id,
            merchantId,
            storeId: storeId ?? undefined,
            remark: dto.remark,
          },
          user,
          ip,
          ua,
        );
      } catch (e) {
        // 送积分失败则回滚订单，避免留下「有订单没积分」的孤儿
        await this.prisma.order.delete({ where: { id: order.id } }).catch(() => undefined);
        throw e;
      }
    }

    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      module: 'order',
      action: ACTION.create,
      targetType: 'order',
      targetId: order.id,
      after: { orderNo: order.orderNo, totalAmount: dto.totalAmount, points },
      ip: ip ?? null,
      userAgent: ua ?? null,
    });

    return { order: { id: order.id, orderNo: order.orderNo, status: order.status }, points };
  }

  /** 标记异常：NORMAL → ABNORMAL，记录异常类型与说明 + 审计 */
  async markAbnormal(id: number, dto: MarkAbnormalDto, user: JwtPayload, ip?: string, ua?: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `订单 #${id} 不存在`);
    await this.assertOrderVisible(order, user);

    const updated = await this.prisma.$transaction(async (tx) => {
      const affected = await tx.$executeRaw(
        Prisma.sql`UPDATE orders SET status = 'ABNORMAL', abnormalType = ${dto.abnormalType}, abnormalRemark = ${dto.abnormalRemark}, updatedAt = NOW() WHERE id = ${id} AND status = 'NORMAL'`,
      );
      if (affected === 0) {
        throw BizException.conflict(ReasonCode.ORDER_NOT_ABNORMAL, '只有 NORMAL 订单才能标记异常（可能已处理或已是异常）');
      }
      return tx.order.findUnique({ where: { id } });
    });

    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      module: 'order',
      action: ACTION.markAbnormal,
      targetType: 'order',
      targetId: id,
      before: { status: order.status },
      after: { status: updated?.status, abnormalType: dto.abnormalType, abnormalRemark: dto.abnormalRemark },
      ip: ip ?? null,
      userAgent: ua ?? null,
    });

    return {
      id,
      status: updated?.status,
      abnormalType: dto.abnormalType,
      abnormalRemark: dto.abnormalRemark,
    };
  }

  /**
   * 异常订单处理（三种场景，全部单事务；并发下只有 1 个 admin 能抢到）。
   *
   * - CANCEL（订单取消）：券回 UNUSED + 积分回原批次（REFUND）+ 订单 couponInstanceId 清空 → status=CANCELED；
   * - AMOUNT_ERROR（金额录入错误）：冲正积分（ADJUST 负流水）→ status=NORMAL；
   * - DISPUTE（核销争议）：冲正核销记录 + 券回 UNUSED + 积分回退 + couponInstanceId 清空 → status=REFUNDED。
   */
  async handle(id: number, dto: HandleOrderDto, user: JwtPayload, ip?: string, ua?: string) {
    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `订单 #${id} 不存在`);
    await this.assertOrderVisible(order, user);
    // 边界：异常处理权归主体，附属只能标记异常
    await this.assertHandleAllowed(user);
    if (order.status !== OrderStatus.ABNORMAL) {
      throw BizException.conflict(ReasonCode.ORDER_NOT_ABNORMAL, '只有异常订单才能处理');
    }

    const now = new Date();
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // ① 抢占：条件更新，只有第一个事务能把它从 ABNORMAL 领走（并发第二个 → 409 ORDER_ALREADY_HANDLED）
          const claimed = await tx.$executeRaw(
            Prisma.sql`UPDATE orders SET handledBy = ${user.sub}, handledAt = ${now} WHERE id = ${id} AND status = 'ABNORMAL' AND handledBy IS NULL`,
          );
          if (claimed === 0) {
            throw BizException.conflict(ReasonCode.ORDER_ALREADY_HANDLED, '该异常订单已被处理');
          }

          let finalStatus: OrderStatus;
          let refundInfo: { total: number; details: Array<{ sourceTxnId: number; amount: number }> } | null = null;

          if (dto.handleType === 'CANCEL' || dto.handleType === 'DISPUTE') {
            finalStatus = dto.handleType === 'CANCEL' ? OrderStatus.CANCELED : OrderStatus.REFUNDED;
            if (order.couponInstanceId) {
              // 冲正核销记录（若有 SUCCESS）
              await tx.$executeRaw(
                Prisma.sql`UPDATE redemption_records SET status = 'REVERSED', reverseReason = ${dto.result ?? '异常订单处理'}, reversedAt = ${now} WHERE couponInstanceId = ${order.couponInstanceId} AND status = 'SUCCESS'`,
              );
              // 券回到 UNUSED（条件更新：只有 USED 才回退，不复活已过期/已冻结的券）
              await tx.$executeRaw(
                Prisma.sql`UPDATE coupon_instances SET status = 'UNUSED', usedAt = NULL, updatedAt = NOW() WHERE id = ${order.couponInstanceId} AND status = 'USED'`,
              );
              // 积分回原批次
              refundInfo = await this.points.refundExchangePoints(tx, order.couponInstanceId, user.sub);
              await tx.order.update({ where: { id }, data: { couponInstanceId: null } });
            }
          } else {
            // AMOUNT_ERROR：冲正 pointsEarned（ADJUST 负流水，走 FIFO）
            finalStatus = OrderStatus.NORMAL;
            if (order.pointsEarned > 0) {
              await this.points.adjustInTx(tx, order.userId, -order.pointsEarned, user.sub, `订单 #${order.id} 金额录入错误冲正 ${order.pointsEarned} 分`);
            }
          }

          const result = dto.result ?? this.defaultResult(dto.handleType, refundInfo, order);
          const updated = await tx.order.update({
            where: { id },
            data: { status: finalStatus, handleResult: result },
          });

          await this.audit.record(
            {
              operatorId: user.sub,
              operatorType: user.userType,
              module: 'order',
              action: ACTION.handle,
              targetType: 'order',
              targetId: id,
              before: { status: order.status, abnormalType: order.abnormalType, couponInstanceId: order.couponInstanceId },
              after: {
                status: updated.status,
                handleType: dto.handleType,
                handleResult: result,
                refundTotal: refundInfo?.total ?? 0,
              },
              ip: ip ?? null,
              userAgent: ua ?? null,
            },
            tx,
          );

          return {
            id,
            status: updated.status,
            handleType: dto.handleType,
            handleResult: result,
            refund: refundInfo,
          };
        });
      } catch (e) {
        lastErr = e;
        if (e instanceof ConcurrentSignal) {
          if (attempt === MAX_RETRY) break;
          await sleep(20 * attempt + Math.floor(Math.random() * 20));
          continue;
        }
        throw e;
      }
    }
    throw BizException.conflict(ReasonCode.CONCURRENT_UPDATE, `订单并发处理冲突，已重试 ${MAX_RETRY} 次，请稍后重试`);
  }

  // ---------------------------------------------------------------- 内部工具

  private defaultResult(handleType: string, refund: { total: number; details: unknown[] } | null, order: { pointsEarned: number }) {
    if (handleType === 'CANCEL') return `订单取消：券已退回，积分回退 ${refund?.total ?? 0} 分`;
    if (handleType === 'DISPUTE') return `核销争议冲正：核销已冲正，积分回退 ${refund?.total ?? 0} 分`;
    return `金额录入错误：冲正 ${order.pointsEarned} 分`;
  }

  /** 补录订单的归属解析（平台指定 / 商家 JWT / 店员本店），不信任入参 */
  private async resolveCreateScope(dto: CreateOrderDto, user: JwtPayload) {
    if (user.userType === 'PLATFORM') {
      if (!dto.merchantId) {
        throw BizException.badRequest(ReasonCode.MERCHANT_ID_REQUIRED, '平台管理员补录订单必须指定 merchantId');
      }
      if (dto.storeId) {
        const store = await this.prisma.store.findUnique({ where: { id: dto.storeId }, select: { merchantId: true } });
        if (!store || store.merchantId !== dto.merchantId) {
          throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, `门店 #${dto.storeId} 不属于商家 #${dto.merchantId}`);
        }
      }
      return { merchantId: dto.merchantId, storeId: dto.storeId ?? null };
    }
    if (user.userType === 'STORE') {
      const store = await this.prisma.store.findUnique({ where: { id: user.storeId ?? -1 }, select: { id: true, merchantId: true } });
      if (!store) throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '店员账号未绑定门店');
      if (dto.merchantId && dto.merchantId !== store.merchantId) {
        throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权为其他商家补录订单');
      }
      return { merchantId: store.merchantId, storeId: store.id };
    }
    const merchantId = user.merchantId;
    if (!merchantId) throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '账号未关联商家');
    if (dto.merchantId && dto.merchantId !== merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权为其他商家补录订单');
    }
    return { merchantId, storeId: dto.storeId ?? null };
  }

  /** 订单可见范围：平台全量 / 主体=自己+直属附属 / 附属&店员=本店 */
  private async orderScope(user: JwtPayload): Promise<Prisma.OrderWhereInput> {
    if (user.userType === 'PLATFORM') return {};
    if (user.userType === 'STORE') {
      if (!user.storeId) return { id: -1 };
      return { storeId: user.storeId };
    }
    const merchantId = user.merchantId;
    if (!merchantId) return { id: -1 };
    const merchants = await this.prisma.merchant.findMany({
      where: { OR: [{ id: merchantId }, { parentId: merchantId }] },
      select: { id: true },
    });
    return { merchantId: { in: merchants.map((m) => m.id) } };
  }

  /** 单条订单的可见性校验：越权 → 403 STORE_NOT_OWNED（不泄露订单是否存在） */
  private async assertOrderVisible(order: { merchantId: number; storeId: number | null }, user: JwtPayload) {
    if (user.userType === 'PLATFORM') return;
    if (user.userType === 'STORE') {
      if (order.storeId !== user.storeId) {
        throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, '无权查看/处理别家门店的订单');
      }
      return;
    }
    const merchantId = user.merchantId;
    if (!merchantId) throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '账号未关联商家');
    const merchants = await this.prisma.merchant.findMany({
      where: { OR: [{ id: merchantId }, { parentId: merchantId }] },
      select: { id: true },
    });
    if (!merchants.some((m) => m.id === order.merchantId)) {
      throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, '无权处理别家商家的订单');
    }
  }

  /** 异常处理权归主体：附属商家只能标记异常，不能处理（双保险，权限码已不给附属 order:handle） */
  private async assertHandleAllowed(user: JwtPayload) {
    if (user.userType === 'PLATFORM') return;
    if (user.userType === 'STORE') {
      throw BizException.forbidden(ReasonCode.ORDER_HANDLE_FORBIDDEN, '异常订单处理权归主体商家');
    }
    const self = await this.prisma.merchant.findUnique({ where: { id: user.merchantId ?? -1 }, select: { type: true } });
    if (!self || self.type !== MerchantType.MAIN) {
      throw BizException.forbidden(ReasonCode.ORDER_HANDLE_FORBIDDEN, '异常订单处理权归主体商家，附属商家只能标记异常');
    }
  }
}
