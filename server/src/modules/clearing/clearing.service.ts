import { Injectable, Logger } from '@nestjs/common';
import {
  MerchantClearingBillStatus,
  MerchantClearingPeriodStatus,
  MerchantType,
  Prisma,
} from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import { GenerateClearingDto, QueryClearingBillsDto, SettleClearingBillDto } from './dto/clearing.dto';

/**
 * 商家互结清分（按商家兑换 → 跨商家核销 → 月度轧差）
 *
 * 产品确认的口径：
 *  1. A（兑换进入的商家）补给 B（发券商家）。A = exchange_records.merchantId，
 *     B = coupon_templates.ownerMerchantId；核销门店 C 只做追溯，不参与资金方向。
 *  2. 只统计「已核销」且来自积分兑换的券，按 redeemedAt 归入北京时间自然月。
 *  3. 金额 = 券面值（redemption_records.faceValue 快照）。
 *  4. A === B（在自家兑自家发的券）直接排除。
 *  5. 同一商家对双向轧差，只出一条净额账单：谁补给谁、补多少。
 *  6. 账单有 UNSETTLED / SETTLED 状态，明细可下钻到每一张券。
 *
 * 与现有 SettlementService 完全独立：那边是「平台 → 单个商家」的对账单，
 * 这边是「商家 → 商家」的清分，不复用、不互相影响。
 */

interface ClearingRawRow {
  redemptionId: number | bigint;
  exchangeRecordId: number | bigint | null;
  payerMerchantId: number | bigint | null;
  receiverMerchantId: number | bigint | null;
  redeemMerchantId: number | bigint | null;
  storeId: number | bigint | null;
  userId: number | bigint;
  code: string | null;
  templateId: number | bigint;
  couponInstanceId: number | bigint;
  templateName: string | null;
  faceValue: Prisma.Decimal | number | string;
  pointsCost: number | bigint | null;
  redeemedAt: Date;
}

interface DirectionGroup {
  a: number;
  b: number;
  grossCents: number;
  count: number;
  rows: ClearingRawRow[];
}

interface NetPair {
  low: number;
  high: number;
  /** low → high 方向 */
  forward?: DirectionGroup;
  /** high → low 方向（抵扣项） */
  reverse?: DirectionGroup;
}

const n = (v: unknown): number => (v == null ? 0 : Number(v));
const centsOf = (v: ClearingRawRow['faceValue']): number => Math.round(Number(v) * 100);
const yuan = (cents: number): number => Math.round(cents) / 100;

@Injectable()
export class ClearingService {
  private readonly logger = new Logger('MerchantClearing');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- 账期工具

  /**
   * 北京时间自然月 → UTC 查询边界（左闭右开）。
   * 北京时间 YYYY-MM-01 00:00 = UTC 上月最后一日 16:00。
   * 与「按核销月份归期」一致，且不会把月初/月末的核销错分到相邻月份。
   */
  private periodBounds(periodKey: string) {
    const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(periodKey);
    if (!m) {
      throw BizException.badRequest(ReasonCode.CLEARING_PERIOD_INVALID, '账期格式应为 YYYY-MM');
    }
    const year = Number(m[1]);
    const month = Number(m[2]);
    const start = new Date(Date.UTC(year, month - 1, 1, -8));
    const end = new Date(Date.UTC(year, month, 1, -8));
    return { start, end };
  }

  private lastMonthKey(now = new Date()): string {
    // 用 UTC 视图读 +8h 后的「北京时间」，getUTCMonth() 即北京时间月份
    const sh = new Date(now.getTime() + 8 * 3600 * 1000);
    const y = sh.getUTCFullYear();
    const m = sh.getUTCMonth(); // 0-based，本月
    return m === 0 ? `${y - 1}-12` : `${y}-${String(m).padStart(2, '0')}`;
  }

  /**
   * 可见范围与管理权限。
   * 与现有 SettlementService 保持一致：平台 + 主体商家看全量并可管理账期，
   * 附属商家 / 店员只看与自己相关的账单且不能改动打款状态。
   * scope：0 = 全量，>0 = 限定该商家。
   */
  private async authority(user?: JwtPayload): Promise<{ scope: number; canManage: boolean }> {
    if (!user) return { scope: 0, canManage: true }; // 定时任务
    if (user.userType === 'PLATFORM') return { scope: 0, canManage: true };
    const mid = Number(user.merchantId ?? 0);
    if (!mid) {
      throw BizException.forbidden(
        ReasonCode.PERMISSION_DENIED,
        '当前账号没有绑定商家，无法查看商家互结账单',
      );
    }
    const me = await this.prisma.merchant.findUnique({
      where: { id: mid },
      select: { type: true },
    });
    if (me?.type === MerchantType.MAIN) return { scope: 0, canManage: true };
    return { scope: mid, canManage: false };
  }

  private async assertCanManage(user: JwtPayload) {
    const { canManage } = await this.authority(user);
    if (!canManage) {
      throw BizException.forbidden(
        ReasonCode.PERMISSION_DENIED,
        '仅平台或主体商家可生成账期 / 标记打款状态',
      );
    }
  }

  private pairScope(merchantId: number): Prisma.MerchantClearingBillWhereInput {
    return {
      OR: [{ payerMerchantId: merchantId }, { receiverMerchantId: merchantId }],
    };
  }

  /** 越权统一返回 404，不泄露账单是否存在 */
  private async assertBillVisible(
    bill: { payerMerchantId: number; receiverMerchantId: number },
    user: JwtPayload,
  ) {
    const { scope } = await this.authority(user);
    if (scope === 0) return;
    if (bill.payerMerchantId !== scope && bill.receiverMerchantId !== scope) {
      throw BizException.notFound(ReasonCode.CLEARING_BILL_NOT_FOUND, `清分账单不存在或无权查看`);
    }
  }

  private async namesOf(ids: number[]): Promise<Map<number, string>> {
    const uniq = [...new Set(ids.filter((v) => v > 0))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.merchant.findMany({
      where: { id: { in: uniq } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [Number(r.id), r.name]));
  }

  private async storeNamesOf(ids: number[]): Promise<Map<number, string>> {
    const uniq = [...new Set(ids.filter((v) => v > 0))];
    if (!uniq.length) return new Map();
    const rows = await this.prisma.store.findMany({
      where: { id: { in: uniq } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [Number(r.id), r.name]));
  }

  // ---------------------------------------------------------------- 生成 / 重算

  /**
   * 拉取某账期「可清分」的核销明细。
   *
   * 关键点：
   *  - 用 `MIN(exchange_records.id)` 保证一张券只对应一条兑换记录，避免重复放大金额；
   *  - `er.merchantId <> ct.ownerMerchantId` 同时完成「同店排除」与 NULL 排除
   *    （旧联盟商城的兑换记录 merchantId 写的就是发券商家，天然不会入账）；
   *  - `rr.status = 'SUCCESS'` 排除冲正记录，只算真正用掉的券。
   */
  private async collect(start: Date, end: Date): Promise<ClearingRawRow[]> {
    return this.prisma.$queryRaw<ClearingRawRow[]>`
      SELECT
        rr.id                AS redemptionId,
        er.id                AS exchangeRecordId,
        er.merchantId        AS payerMerchantId,
        ct.ownerMerchantId   AS receiverMerchantId,
        rr.merchantId        AS redeemMerchantId,
        rr.storeId           AS storeId,
        rr.userId            AS userId,
        rr.code              AS code,
        rr.templateId        AS templateId,
        ci.id                AS couponInstanceId,
        ct.name              AS templateName,
        rr.faceValue         AS faceValue,
        er.pointsCost        AS pointsCost,
        rr.redeemedAt        AS redeemedAt
      FROM redemption_records rr
      JOIN (
        SELECT couponInstanceId, MIN(id) AS erId
        FROM exchange_records
        WHERE couponInstanceId IS NOT NULL AND merchantId IS NOT NULL
        GROUP BY couponInstanceId
      ) em ON em.couponInstanceId = rr.couponInstanceId
      JOIN exchange_records er ON er.id = em.erId
      JOIN coupon_templates ct ON ct.id = rr.templateId
      JOIN coupon_instances ci ON ci.id = rr.couponInstanceId
      WHERE rr.status = 'SUCCESS'
        AND rr.redeemedAt >= ${start}
        AND rr.redeemedAt <  ${end}
        AND er.merchantId <> ct.ownerMerchantId
      ORDER BY rr.redeemedAt ASC, rr.id ASC
    `;
  }

  /** 按有序 (A,B) 归并，再按无序商家对轧差 */
  private netPairs(rows: ClearingRawRow[]): NetPair[] {
    const directed = new Map<string, DirectionGroup>();
    for (const row of rows) {
      const a = n(row.payerMerchantId);
      const b = n(row.receiverMerchantId);
      if (!a || !b || a === b) continue;
      const key = `${a}:${b}`;
      const g = directed.get(key) ?? { a, b, grossCents: 0, count: 0, rows: [] };
      g.grossCents += centsOf(row.faceValue);
      g.count += 1;
      g.rows.push(row);
      directed.set(key, g);
    }

    const pairs = new Map<string, NetPair>();
    for (const g of directed.values()) {
      const low = Math.min(g.a, g.b);
      const high = Math.max(g.a, g.b);
      const pair = pairs.get(`${low}:${high}`) ?? { low, high };
      if (g.a === low) pair.forward = g;
      else pair.reverse = g;
      pairs.set(`${low}:${high}`, pair);
    }
    return [...pairs.values()];
  }

  async generate(dto: GenerateClearingDto, user?: JwtPayload) {
    if (user) await this.assertCanManage(user);
    const { start, end } = this.periodBounds(dto.periodKey);

    let period = await this.prisma.merchantClearingPeriod.findUnique({
      where: { periodKey: dto.periodKey },
    });
    if (period && !dto.recalculate) {
      return { ...this.shapePeriod(period), idempotent: true };
    }
    if (period) {
      if (period.status === MerchantClearingPeriodStatus.CLOSED) {
        throw BizException.forbidden(
          ReasonCode.CLEARING_PERIOD_FROZEN,
          `账期 ${dto.periodKey} 已关闭，不能重算`,
        );
      }
      const settled = await this.prisma.merchantClearingBill.count({
        where: { periodId: period.id, status: MerchantClearingBillStatus.SETTLED },
      });
      if (settled > 0) {
        throw BizException.forbidden(
          ReasonCode.CLEARING_PERIOD_FROZEN,
          `账期 ${dto.periodKey} 已有 ${settled} 张账单标记打款，不能重算；请先撤销打款状态`,
        );
      }
    }

    const rows = await this.collect(start, end);
    const pairs = this.netPairs(rows);

    let billCount = 0;
    let itemCount = 0;
    let netTotalCents = 0;
    let regenerated = false;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          if (period) {
            const oldBills = await tx.merchantClearingBill.findMany({
              where: { periodId: period.id },
              select: { id: true },
            });
            const ids = oldBills.map((b) => b.id);
            if (ids.length) {
              await tx.merchantClearingItem.deleteMany({ where: { billId: { in: ids } } });
              await tx.merchantClearingBill.deleteMany({ where: { periodId: period!.id } });
            }
            regenerated = true;
          } else {
            period = await tx.merchantClearingPeriod.create({
              data: {
                periodKey: dto.periodKey,
                periodStart: start,
                periodEnd: end,
                generatedBy: user?.sub ?? null,
              },
            });
          }

          for (const pair of pairs) {
            const f = pair.forward?.grossCents ?? 0;
            const r = pair.reverse?.grossCents ?? 0;
            const netCents = f - r;
            // 双向刚好抵平：没有资金流动，不出账单（明细仍可追溯，见下方注释）
            if (netCents === 0) continue;

            const forwardIsNet = netCents > 0;
            const payerMerchantId = forwardIsNet ? pair.low : pair.high;
            const receiverMerchantId = forwardIsNet ? pair.high : pair.low;
            const grossForward = forwardIsNet ? f : r;
            const grossReverse = forwardIsNet ? r : f;
            const forwardCount = forwardIsNet ? (pair.forward?.count ?? 0) : (pair.reverse?.count ?? 0);
            const reverseCount = forwardIsNet ? (pair.reverse?.count ?? 0) : (pair.forward?.count ?? 0);

            const bill = await tx.merchantClearingBill.create({
              data: {
                periodId: period!.id,
                payerMerchantId,
                receiverMerchantId,
                grossForward: yuan(grossForward),
                grossReverse: yuan(grossReverse),
                netAmount: yuan(Math.abs(netCents)),
                forwardCount,
                reverseCount,
              },
            });
            billCount += 1;
            netTotalCents += Math.abs(netCents);

            const items: ClearingRawRow[] = [
              ...(pair.forward?.rows ?? []),
              ...(pair.reverse?.rows ?? []),
            ];
            if (items.length) {
              await tx.merchantClearingItem.createMany({
                data: items.map((row) => ({
                  billId: bill.id,
                  redemptionId: n(row.redemptionId),
                  exchangeRecordId: row.exchangeRecordId == null ? null : n(row.exchangeRecordId),
                  couponInstanceId: n(row.couponInstanceId),
                  templateId: n(row.templateId),
                  // 明细保留原始方向 A→B，与账单净额方向相反的行即抵扣项
                  payerMerchantId: n(row.payerMerchantId),
                  receiverMerchantId: n(row.receiverMerchantId),
                  redeemMerchantId: row.redeemMerchantId == null ? null : n(row.redeemMerchantId),
                  storeId: row.storeId == null ? null : n(row.storeId),
                  userId: n(row.userId),
                  code: row.code,
                  templateName: row.templateName,
                  faceValue: yuan(centsOf(row.faceValue)),
                  pointsCost: n(row.pointsCost),
                  redeemedAt: new Date(row.redeemedAt),
                })),
              });
              itemCount += items.length;
            }
          }

          period = await tx.merchantClearingPeriod.update({
            where: { id: period!.id },
            data: {
              billCount,
              itemCount,
              netTotal: yuan(netTotalCents),
              status: MerchantClearingPeriodStatus.GENERATED,
              generatedBy: user?.sub ?? null,
              generatedAt: new Date(),
              recalculatedAt: regenerated ? new Date() : null,
            },
          });
        },
        { timeout: 30_000 },
      );
    } catch (e) {
      // 并发重复生成：撞 periodKey 唯一键时按幂等返回已有账期
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const existing = await this.prisma.merchantClearingPeriod.findUnique({
          where: { periodKey: dto.periodKey },
        });
        if (existing) return { ...this.shapePeriod(existing), idempotent: true };
      }
      throw e;
    }

    await this.audit.record({
      operatorId: user?.sub ?? null,
      operatorType: user?.userType,
      module: 'clearing',
      action: regenerated ? 'CLEARING_REGENERATE' : 'CLEARING_GENERATE',
      targetType: 'merchant_clearing_period',
      targetId: period!.id,
      after: { periodKey: dto.periodKey, billCount, itemCount, netTotal: yuan(netTotalCents) },
    });
    this.logger.log(
      `账期 ${dto.periodKey} 清分完成：核销明细 ${rows.length} 笔 → 净额账单 ${billCount} 张 / 入账明细 ${itemCount} 条，净额合计 ¥${yuan(netTotalCents)}`,
    );
    return { ...this.shapePeriod(period!), idempotent: false, regenerated, rawCount: rows.length };
  }

  /** 定时任务：每月 1 日生成上月（北京时间自然月），幂等 */
  async generateLastMonth() {
    const periodKey = this.lastMonthKey();
    return this.generate({ periodKey });
  }

  // ---------------------------------------------------------------- 查询

  private shapePeriod(p: {
    id: number;
    periodKey: string;
    periodStart: Date;
    periodEnd: Date;
    billCount: number;
    itemCount: number;
    netTotal: Prisma.Decimal;
    status: MerchantClearingPeriodStatus;
    generatedAt: Date;
    recalculatedAt: Date | null;
  }) {
    return {
      id: p.id,
      periodKey: p.periodKey,
      periodStart: p.periodStart.toISOString(),
      periodEnd: p.periodEnd.toISOString(),
      billCount: p.billCount,
      itemCount: p.itemCount,
      netTotal: Number(p.netTotal),
      status: p.status,
      generatedAt: p.generatedAt.toISOString(),
      recalculatedAt: p.recalculatedAt?.toISOString() ?? null,
    };
  }

  private async shapeBill(b: {
    id: number;
    periodId: number;
    payerMerchantId: number;
    receiverMerchantId: number;
    grossForward: Prisma.Decimal;
    grossReverse: Prisma.Decimal;
    netAmount: Prisma.Decimal;
    forwardCount: number;
    reverseCount: number;
    status: MerchantClearingBillStatus;
    settledAt: Date | null;
    settledBy: number | null;
    settleRemark: string | null;
    createdAt: Date;
    period?: { periodKey: string } | null;
  }, names: Map<number, string>) {
    return {
      id: b.id,
      periodId: b.periodId,
      periodKey: b.period?.periodKey ?? '',
      payerMerchantId: b.payerMerchantId,
      payerMerchantName: names.get(b.payerMerchantId) ?? `商家#${b.payerMerchantId}`,
      receiverMerchantId: b.receiverMerchantId,
      receiverMerchantName: names.get(b.receiverMerchantId) ?? `商家#${b.receiverMerchantId}`,
      grossForward: Number(b.grossForward),
      grossReverse: Number(b.grossReverse),
      netAmount: Number(b.netAmount),
      forwardCount: b.forwardCount,
      reverseCount: b.reverseCount,
      status: b.status,
      settledAt: b.settledAt?.toISOString() ?? null,
      settledBy: b.settledBy,
      settleRemark: b.settleRemark,
      createdAt: b.createdAt.toISOString(),
    };
  }

  async periods(user: JwtPayload) {
    const { scope } = await this.authority(user);
    const where: Prisma.MerchantClearingPeriodWhereInput =
      scope === 0 ? {} : { bills: { some: this.pairScope(scope) } };
    const rows = await this.prisma.merchantClearingPeriod.findMany({
      where,
      orderBy: { periodKey: 'desc' },
      take: 36,
    });
    return { list: rows.map((p) => this.shapePeriod(p)) };
  }

  async bills(query: QueryClearingBillsDto, user: JwtPayload) {
    const { scope } = await this.authority(user);
    const merchantId = scope === 0 ? query.merchantId ?? 0 : scope;
    const where: Prisma.MerchantClearingBillWhereInput = {
      AND: [
        merchantId ? this.pairScope(merchantId) : {},
        query.periodKey ? { period: { periodKey: query.periodKey } } : {},
        query.status ? { status: query.status } : {},
      ],
    };
    const [rows, total] = await Promise.all([
      this.prisma.merchantClearingBill.findMany({
        where,
        include: { period: { select: { periodKey: true } } },
        orderBy: [{ id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.merchantClearingBill.count({ where }),
    ]);
    const names = await this.namesOf(
      rows.flatMap((r) => [r.payerMerchantId, r.receiverMerchantId]),
    );
    const list = await Promise.all(rows.map((r) => this.shapeBill(r, names)));
    return { list, total, page: query.page, pageSize: query.pageSize };
  }

  async billDetail(id: number, user: JwtPayload) {
    const bill = await this.prisma.merchantClearingBill.findUnique({
      where: { id },
      include: { period: { select: { periodKey: true } } },
    });
    if (!bill) {
      throw BizException.notFound(ReasonCode.CLEARING_BILL_NOT_FOUND, `清分账单 #${id} 不存在`);
    }
    await this.assertBillVisible(bill, user);

    const items = await this.prisma.merchantClearingItem.findMany({
      where: { billId: id },
      orderBy: [{ redeemedAt: 'asc' }, { id: 'asc' }],
    });
    const names = await this.namesOf([
      bill.payerMerchantId,
      bill.receiverMerchantId,
      ...items.flatMap((i) => [i.payerMerchantId, i.receiverMerchantId, i.redeemMerchantId ?? 0]),
    ]);
    const storeNames = await this.storeNamesOf(items.map((i) => i.storeId ?? 0));
    const summary = await this.shapeBill(bill, names);

    return {
      ...summary,
      items: items.map((i) => {
        const sameDirection =
          i.payerMerchantId === bill.payerMerchantId &&
          i.receiverMerchantId === bill.receiverMerchantId;
        return {
          id: i.id,
          redemptionId: i.redemptionId,
          exchangeRecordId: i.exchangeRecordId,
          couponInstanceId: i.couponInstanceId,
          templateId: i.templateId,
          templateName: i.templateName,
          code: i.code,
          faceValue: Number(i.faceValue),
          pointsCost: i.pointsCost,
          /** 相对本账单净额方向：ADD = 计入应付，OFFSET = 抵扣项 */
          effect: sameDirection ? 'ADD' : 'OFFSET',
          payerMerchantId: i.payerMerchantId,
          payerMerchantName: names.get(i.payerMerchantId) ?? `商家#${i.payerMerchantId}`,
          receiverMerchantId: i.receiverMerchantId,
          receiverMerchantName: names.get(i.receiverMerchantId) ?? `商家#${i.receiverMerchantId}`,
          redeemMerchantId: i.redeemMerchantId,
          redeemMerchantName: i.redeemMerchantId
            ? names.get(i.redeemMerchantId) ?? `商家#${i.redeemMerchantId}`
            : '',
          storeId: i.storeId,
          storeName: i.storeId ? storeNames.get(i.storeId) ?? `门店#${i.storeId}` : '',
          userId: i.userId,
          redeemedAt: i.redeemedAt.toISOString(),
        };
      }),
    };
  }

  /**
   * 商家端聚合：只看与自己相关的应付 / 应收，按账期给出汇总。
   * 平台账号调用时返回自己 merchantId=0 的空视图（平台应看 bills 全量接口）。
   */
  async my(user: JwtPayload) {
    // 先校验身份（会员端 H5 令牌没有绑定商家，会被拒绝），再按绑定商家算自己的账
    await this.authority(user);
    const me = Number(user.merchantId ?? 0);
    if (me === 0) {
      return {
        merchantId: 0,
        merchantName: '平台',
        current: null,
        totals: { payable: 0, receivable: 0, net: 0, pendingCount: 0, settledCount: 0 },
        periods: [],
        bills: [],
      };
    }
    const [merchant, periods] = await Promise.all([
      this.prisma.merchant.findUnique({ where: { id: me }, select: { name: true } }),
      this.prisma.merchantClearingPeriod.findMany({
        where: { bills: { some: this.pairScope(me) } },
        orderBy: { periodKey: 'desc' },
        take: 12,
      }),
    ]);
    const rows = await this.prisma.merchantClearingBill.findMany({
      where: { periodId: { in: periods.map((p) => p.id) }, ...this.pairScope(me) },
      include: { period: { select: { periodKey: true } } },
      orderBy: [{ id: 'desc' }],
    });
    const names = await this.namesOf(rows.flatMap((r) => [r.payerMerchantId, r.receiverMerchantId]));
    const shaped = await Promise.all(rows.map((r) => this.shapeBill(r, names)));

    const sum = (list: typeof shaped) => ({
      payable: Math.round(list.filter((b) => b.payerMerchantId === me).reduce((s, b) => s + b.netAmount, 0) * 100) / 100,
      receivable: Math.round(list.filter((b) => b.receiverMerchantId === me).reduce((s, b) => s + b.netAmount, 0) * 100) / 100,
    });
    const periodRows = periods.map((p) => {
      const sub = shaped.filter((b) => b.periodKey === p.periodKey);
      const s = sum(sub);
      return {
        periodKey: p.periodKey,
        payable: s.payable,
        receivable: s.receivable,
        net: Math.round((s.receivable - s.payable) * 100) / 100,
        billCount: sub.length,
      };
    });
    const all = sum(shaped);
    return {
      merchantId: me,
      merchantName: merchant?.name ?? `商家#${me}`,
      current: periodRows[0] ?? null,
      totals: {
        ...all,
        net: Math.round((all.receivable - all.payable) * 100) / 100,
        pendingCount: shaped.filter((b) => b.status === MerchantClearingBillStatus.UNSETTLED).length,
        settledCount: shaped.filter((b) => b.status === MerchantClearingBillStatus.SETTLED).length,
      },
      periods: periodRows,
      bills: shaped.slice(0, 20),
    };
  }

  // ---------------------------------------------------------------- 打款状态

  async settle(id: number, dto: SettleClearingBillDto, user: JwtPayload) {
    await this.assertCanManage(user);
    const bill = await this.prisma.merchantClearingBill.findUnique({ where: { id } });
    if (!bill) {
      throw BizException.notFound(ReasonCode.CLEARING_BILL_NOT_FOUND, `清分账单 #${id} 不存在`);
    }
    const next = dto.settled
      ? MerchantClearingBillStatus.SETTLED
      : MerchantClearingBillStatus.UNSETTLED;
    if (bill.status === next) {
      return { id, status: next, idempotent: true };
    }
    const updated = await this.prisma.merchantClearingBill.update({
      where: { id },
      data: {
        status: next,
        settledAt: dto.settled ? new Date() : null,
        settledBy: dto.settled ? user.sub : null,
        settleRemark: dto.settled ? dto.remark ?? null : null,
      },
    });

    // 账期状态跟随账单：全部已结算 → CLOSED（禁止重算）；有未结算 → GENERATED
    const pending = await this.prisma.merchantClearingBill.count({
      where: { periodId: bill.periodId, status: MerchantClearingBillStatus.UNSETTLED },
    });
    await this.prisma.merchantClearingPeriod.update({
      where: { id: bill.periodId },
      data: {
        status: pending === 0
          ? MerchantClearingPeriodStatus.CLOSED
          : MerchantClearingPeriodStatus.GENERATED,
      },
    });

    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      module: 'clearing',
      action: dto.settled ? 'CLEARING_SETTLE' : 'CLEARING_UNSETTLE',
      targetType: 'merchant_clearing_bill',
      targetId: id,
      before: { status: bill.status },
      after: { status: next, netAmount: Number(bill.netAmount), remark: dto.remark ?? null },
    });
    return { id, status: updated.status, settledAt: updated.settledAt, idempotent: false };
  }
}
