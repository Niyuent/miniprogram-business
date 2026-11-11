import { Injectable, Logger } from '@nestjs/common';
import { MerchantType, PointTxnType, Prisma } from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { toCsv } from '../../common/utils/csv.util';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../auth/jwt-payload';
import { NotificationService } from '../notification/notification.service';
import { ReportKey, ReportQueryDto, TrendQueryDto } from './dto/report.dto';

/**
 * 报表中心 + 工作台（S4.3）
 *
 * 性能约定：**所有汇总一律走数据库聚合**（`aggregate` / `groupBy` / `$queryRaw` 分组），
 * 不在应用层循环累加。实测 10000 条订单下各报表均在 1 秒内返回（见 docs/06 S4.3 节）。
 *
 * 隔离约定：平台 / 主体看全平台；附属商家只看自己；店员只看本店。
 */
@Injectable()
export class ReportService {
  private readonly logger = new Logger('Report');

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // ---------------------------------------------------------------- 可见范围

  /** 数据可见范围：平台/主体=全平台；附属=本商家；店员=本店 */
  private async scope(user: JwtPayload): Promise<{ merchantId: number | null; storeId: number | null }> {
    if (user.userType === 'PLATFORM') return { merchantId: null, storeId: null };
    if (user.userType === 'STORE') return { merchantId: user.merchantId ?? null, storeId: user.storeId ?? null };
    const me = await this.prisma.merchant.findUnique({
      where: { id: user.merchantId ?? -1 },
      select: { type: true },
    });
    if (me?.type === MerchantType.MAIN) return { merchantId: null, storeId: null };
    return { merchantId: user.merchantId ?? null, storeId: null };
  }

  private range(dto: Pick<ReportQueryDto, 'from' | 'to'>) {
    return {
      ...(dto.from ? { gte: new Date(dto.from) } : {}),
      ...(dto.to ? { lte: new Date(dto.to) } : {}),
    };
  }

  private hasRange(dto: Pick<ReportQueryDto, 'from' | 'to'>) {
    return !!(dto.from || dto.to);
  }

  /** 商家 id → 名称（groupBy 拿不到关联字段，统一用一次查表补全，避免 N+1） */
  private async merchantNames(ids: number[]) {
    if (!ids.length) return new Map<number, string>();
    const rows = await this.prisma.merchant.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  // ---------------------------------------------------------------- 1. 商户入驻

  async merchantOnboarding(dto: ReportQueryDto, user: JwtPayload) {
    const { merchantId } = await this.scope(user);
    const where: Prisma.MerchantWhereInput = {
      ...(merchantId ? { id: merchantId } : {}),
      ...(this.hasRange(dto) ? { createdAt: this.range(dto) } : {}),
    };

    // 按月新增：DATE_FORMAT 直接返回字符串，避免 DATE() 在 raw 下被转成 Date 引发时区歧义
    const conds: Prisma.Sql[] = [Prisma.sql`1=1`];
    if (merchantId) conds.push(Prisma.sql`AND id = ${merchantId}`);
    if (dto.from) conds.push(Prisma.sql`AND createdAt >= ${new Date(dto.from)}`);
    if (dto.to) conds.push(Prisma.sql`AND createdAt <= ${new Date(dto.to)}`);

    const [byStatus, total, monthly] = await Promise.all([
      this.prisma.merchant.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.merchant.count({ where }),
      this.prisma.$queryRaw<Array<{ ym: string; cnt: bigint }>>(
        Prisma.sql`SELECT DATE_FORMAT(createdAt, '%Y-%m') AS ym, COUNT(*) AS cnt
                   FROM merchants WHERE ${Prisma.join(conds, ' ')}
                   GROUP BY ym ORDER BY ym`,
      ),
    ]);

    const summary: Record<string, number> = { total, PENDING: 0, APPROVED: 0, SUSPENDED: 0, REJECTED: 0 };
    for (const r of byStatus) summary[String(r.status)] = r._count._all;

    return {
      summary,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      monthly: monthly.map((r) => ({ month: r.ym, count: Number(r.cnt) })),
    };
  }

  // ---------------------------------------------------------------- 2. 全平台订单

  async ordersSummary(dto: ReportQueryDto, user: JwtPayload) {
    const { merchantId, storeId } = await this.scope(user);
    const where: Prisma.OrderWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(storeId ? { storeId } : {}),
      ...(this.hasRange(dto) ? { consumeTime: this.range(dto) } : {}),
    };

    const conds: Prisma.Sql[] = [Prisma.sql`1=1`];
    if (merchantId) conds.push(Prisma.sql`AND merchantId = ${merchantId}`);
    if (storeId) conds.push(Prisma.sql`AND storeId = ${storeId}`);
    if (dto.from) conds.push(Prisma.sql`AND consumeTime >= ${new Date(dto.from)}`);
    if (dto.to) conds.push(Prisma.sql`AND consumeTime <= ${new Date(dto.to)}`);

    const [agg, byStatus, byMerchant, daily] = await Promise.all([
      this.prisma.order.aggregate({
        where,
        _count: true,
        _sum: { totalAmount: true, payAmount: true, discountAmount: true },
      }),
      this.prisma.order.groupBy({ by: ['status'], where, _count: { _all: true }, _sum: { payAmount: true } }),
      this.prisma.order.groupBy({
        by: ['merchantId'],
        where,
        _count: { _all: true },
        _sum: { payAmount: true },
        orderBy: { _sum: { payAmount: 'desc' } },
      }),
      this.prisma.$queryRaw<Array<{ d: string; cnt: bigint; amt: Prisma.Decimal | null }>>(
        Prisma.sql`SELECT DATE_FORMAT(consumeTime, '%Y-%m-%d') AS d, COUNT(*) AS cnt, COALESCE(SUM(payAmount),0) AS amt
                   FROM orders WHERE ${Prisma.join(conds, ' ')}
                   GROUP BY d ORDER BY d`,
      ),
    ]);

    const names = await this.merchantNames(byMerchant.map((r) => r.merchantId));

    return {
      summary: {
        count: agg._count,
        totalAmount: Number(agg._sum.totalAmount ?? 0),
        payAmount: Number(agg._sum.payAmount ?? 0),
        discountAmount: Number(agg._sum.discountAmount ?? 0),
      },
      byStatus: byStatus.map((r) => ({
        status: r.status,
        count: r._count._all,
        payAmount: Number(r._sum.payAmount ?? 0),
      })),
      byMerchant: byMerchant.map((r) => ({
        merchantId: r.merchantId,
        merchantName: names.get(r.merchantId) ?? `#${r.merchantId}`,
        count: r._count._all,
        payAmount: Number(r._sum.payAmount ?? 0),
      })),
      daily: daily.map((r) => ({ date: r.d, count: Number(r.cnt), payAmount: Number(r.amt ?? 0) })),
    };
  }

  // ---------------------------------------------------------------- 3. 代金券汇总

  async couponSummary(dto: ReportQueryDto, user: JwtPayload) {
    const { merchantId } = await this.scope(user);
    const where: Prisma.CouponInstanceWhereInput = {
      ...(merchantId ? { issuerMerchantId: merchantId } : {}),
      ...(this.hasRange(dto) ? { obtainedAt: this.range(dto) } : {}),
    };

    const [byStatus, byTemplate, total] = await Promise.all([
      this.prisma.couponInstance.groupBy({ by: ['status'], where, _count: { _all: true } }),
      this.prisma.couponInstance.groupBy({ by: ['templateId'], where, _count: { _all: true } }),
      this.prisma.couponInstance.count({ where }),
    ]);

    const tids = byTemplate.map((r) => r.templateId);
    let tplNames = new Map<number, string>();
    if (tids.length) {
      const tpls = await this.prisma.couponTemplate.findMany({
        where: { id: { in: tids } },
        select: { id: true, name: true },
      });
      tplNames = new Map(tpls.map((t) => [t.id, t.name]));
    }
    const usedCount = byStatus.find((r) => String(r.status) === 'USED')?._count._all ?? 0;

    return {
      summary: {
        total,
        used: usedCount,
        unused: byStatus.find((r) => String(r.status) === 'UNUSED')?._count._all ?? 0,
        frozen: byStatus.find((r) => String(r.status) === 'FROZEN')?._count._all ?? 0,
        expired: byStatus.find((r) => String(r.status) === 'EXPIRED')?._count._all ?? 0,
        usedRate: total ? Number(((usedCount / total) * 100).toFixed(2)) : 0,
      },
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      byTemplate: byTemplate.map((r) => ({
        templateId: r.templateId,
        templateName: tplNames.get(r.templateId) ?? `#${r.templateId}`,
        count: r._count._all,
      })),
    };
  }

  // ---------------------------------------------------------------- 4. 积分流水

  async pointsSummary(dto: ReportQueryDto, user: JwtPayload) {
    const { merchantId, storeId } = await this.scope(user);
    const where: Prisma.PointTransactionWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(storeId ? { storeId } : {}),
      ...(this.hasRange(dto) ? { createdAt: this.range(dto) } : {}),
    };

    const [byType, agg] = await Promise.all([
      this.prisma.pointTransaction.groupBy({ by: ['type'], where, _count: { _all: true }, _sum: { amount: true } }),
      this.prisma.pointTransaction.aggregate({ where, _count: true, _sum: { amount: true } }),
    ]);

    const pick = (t: string) => byType.find((r) => String(r.type) === t)?._sum.amount ?? 0;

    return {
      summary: {
        count: agg._count,
        net: Number(agg._sum.amount ?? 0),
        earned: Number(pick('EARN')),
        spent: Number(pick('SPEND')),
        expired: Number(pick('EXPIRE')),
        refunded: Number(pick('REFUND')),
        adjusted: Number(pick('ADJUST')),
      },
      byType: byType.map((r) => ({
        type: r.type,
        count: r._count._all,
        amount: Number(r._sum.amount ?? 0),
      })),
    };
  }

  // ---------------------------------------------------------------- 5. 采购核销对账

  async storeSettlement(dto: ReportQueryDto, user: JwtPayload) {
    const { merchantId, storeId } = await this.scope(user);
    const purchaseWhere: Prisma.PurchaseRecordWhereInput = {
      ...(merchantId ? { subMerchantId: merchantId } : {}),
      ...(this.hasRange(dto) ? { purchasedAt: this.range(dto) } : {}),
    };
    const redemptionWhere: Prisma.RedemptionRecordWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(storeId ? { storeId } : {}),
      status: 'SUCCESS',
      ...(this.hasRange(dto) ? { redeemedAt: this.range(dto) } : {}),
    };

    const [pAgg, pBySub, pBySettle, rAgg, rByMerchant] = await Promise.all([
      this.prisma.purchaseRecord.aggregate({ where: purchaseWhere, _count: true, _sum: { totalAmount: true } }),
      this.prisma.purchaseRecord.groupBy({
        by: ['subMerchantId'],
        where: purchaseWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.purchaseRecord.groupBy({
        by: ['settleStatus'],
        where: purchaseWhere,
        _count: { _all: true },
        _sum: { totalAmount: true },
      }),
      this.prisma.redemptionRecord.aggregate({
        where: redemptionWhere,
        _count: true,
        _sum: { faceValue: true },
      }),
      this.prisma.redemptionRecord.groupBy({
        by: ['merchantId'],
        where: redemptionWhere,
        _count: { _all: true },
        _sum: { faceValue: true },
      }),
    ]);

    // 按商家合并「采购额 vs 核销额」，差额即待与商家结算的口径
    const merged = new Map<number, { purchaseAmount: number; purchaseCount: number; redemptionAmount: number; redemptionCount: number }>();
    for (const p of pBySub) {
      merged.set(p.subMerchantId, {
        purchaseAmount: Number(p._sum.totalAmount ?? 0),
        purchaseCount: p._count._all,
        redemptionAmount: 0,
        redemptionCount: 0,
      });
    }
    for (const r of rByMerchant) {
      const cur = merged.get(r.merchantId) ?? {
        purchaseAmount: 0,
        purchaseCount: 0,
        redemptionAmount: 0,
        redemptionCount: 0,
      };
      cur.redemptionAmount = Number(r._sum.faceValue ?? 0);
      cur.redemptionCount = r._count._all;
      merged.set(r.merchantId, cur);
    }
    const names = await this.merchantNames([...merged.keys()]);

    return {
      summary: {
        purchaseCount: pAgg._count,
        purchaseAmount: Number(pAgg._sum.totalAmount ?? 0),
        redemptionCount: rAgg._count,
        redemptionAmount: Number(rAgg._sum.faceValue ?? 0),
      },
      bySettleStatus: pBySettle.map((r) => ({
        settleStatus: r.settleStatus,
        count: r._count._all,
        totalAmount: Number(r._sum.totalAmount ?? 0),
      })),
      byMerchant: [...merged.entries()].map(([id, v]) => ({
        merchantId: id,
        merchantName: names.get(id) ?? `#${id}`,
        ...v,
        diffAmount: Number((v.purchaseAmount - v.redemptionAmount).toFixed(2)),
      })),
    };
  }

  // ---------------------------------------------------------------- 6. 授权记录

  async authorizationLogs(dto: ReportQueryDto, user: JwtPayload) {
    const { merchantId } = await this.scope(user);
    const where: Prisma.MerchantAuthorizationWhereInput = {
      ...(merchantId ? { OR: [{ mainMerchantId: merchantId }, { subMerchantId: merchantId }] } : {}),
      ...(this.hasRange(dto) ? { grantedAt: this.range(dto) } : {}),
    };

    const [rows, total, byStatus] = await Promise.all([
      this.prisma.merchantAuthorization.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (dto.page - 1) * dto.pageSize,
        take: dto.pageSize,
        include: { templates: { select: { templateId: true } } },
      }),
      this.prisma.merchantAuthorization.count({ where }),
      this.prisma.merchantAuthorization.groupBy({ by: ['status'], where, _count: { _all: true } }),
    ]);

    const ids = [...new Set(rows.flatMap((r) => [r.mainMerchantId, r.subMerchantId]))];
    const names = await this.merchantNames(ids);
    const tids = [...new Set(rows.flatMap((r) => r.templates.map((t) => t.templateId)))];
    let tplNames = new Map<number, string>();
    if (tids.length) {
      const tpls = await this.prisma.couponTemplate.findMany({
        where: { id: { in: tids } },
        select: { id: true, name: true },
      });
      tplNames = new Map(tpls.map((t) => [t.id, t.name]));
    }

    return {
      total,
      page: dto.page,
      pageSize: dto.pageSize,
      byStatus: byStatus.map((r) => ({ status: r.status, count: r._count._all })),
      list: rows.map((r) => ({
        id: r.id,
        mainMerchantId: r.mainMerchantId,
        mainMerchantName: names.get(r.mainMerchantId) ?? `#${r.mainMerchantId}`,
        subMerchantId: r.subMerchantId,
        subMerchantName: names.get(r.subMerchantId) ?? `#${r.subMerchantId}`,
        status: r.status,
        templateScope: r.templateScope,
        templateNames: r.templates.map((t) => tplNames.get(t.templateId) ?? `#${t.templateId}`),
        grantedAt: r.grantedAt,
        revokedAt: r.revokedAt,
        revokeReason: r.revokeReason,
      })),
    };
  }

  // ---------------------------------------------------------------- 导出（统一 CSV）

  async exportCsv(key: ReportKey, dto: ReportQueryDto, user: JwtPayload): Promise<string> {
    switch (key) {
      case 'merchant-onboarding': {
        const r = await this.merchantOnboarding(dto, user);
        return toCsv(
          ['月份', '新增商家数'],
          r.monthly.map((m) => [m.month, m.count]),
        );
      }
      case 'orders-summary': {
        const r = await this.ordersSummary(dto, user);
        return toCsv(
          ['商家', '订单数', '实付金额'],
          r.byMerchant.map((m) => [m.merchantName, m.count, m.payAmount]),
        );
      }
      case 'coupon-summary': {
        const r = await this.couponSummary(dto, user);
        return toCsv(
          ['券模板', '发放张数'],
          r.byTemplate.map((t) => [t.templateName, t.count]),
        );
      }
      case 'points-summary': {
        const r = await this.pointsSummary(dto, user);
        return toCsv(
          ['流水类型', '笔数', '积分变动'],
          r.byType.map((t) => [t.type, t.count, t.amount]),
        );
      }
      case 'store-settlement': {
        const r = await this.storeSettlement(dto, user);
        return toCsv(
          ['商家', '采购笔数', '采购金额', '核销笔数', '核销金额', '差额'],
          r.byMerchant.map((m) => [
            m.merchantName,
            m.purchaseCount,
            m.purchaseAmount,
            m.redemptionCount,
            m.redemptionAmount,
            m.diffAmount,
          ]),
        );
      }
      case 'authorization-logs': {
        const r = await this.authorizationLogs({ ...dto, pageSize: 200 }, user);
        return toCsv(
          ['授权id', '主体商家', '附属商家', '状态', '范围', '券模板', '授权时间', '撤销时间', '撤销原因'],
          r.list.map((a) => [
            a.id,
            a.mainMerchantName,
            a.subMerchantName,
            a.status,
            a.templateScope,
            a.templateNames.join(' / '),
            a.grantedAt,
            a.revokedAt ?? '',
            a.revokeReason ?? '',
          ]),
        );
      }
      default:
        return toCsv(['错误'], [[`未知的报表 key：${key}`]]);
    }
  }

  // ---------------------------------------------------------------- 工作台

  /** 本地日期 YYYY-MM-DD（与 MySQL DATE_FORMAT 的会话时区口径保持一致） */
  private ymd(d: Date) {
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  private async statsCards(user: JwtPayload) {
    const { merchantId, storeId } = await this.scope(user);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const orderWhere: Prisma.OrderWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(storeId ? { storeId } : {}),
    };
    const redeemWhere: Prisma.RedemptionRecordWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(storeId ? { storeId } : {}),
      status: 'SUCCESS',
    };
    const couponWhere: Prisma.CouponInstanceWhereInput = {
      ...(merchantId ? { issuerMerchantId: merchantId } : {}),
    };

    const win = (w: Record<string, unknown>, from: Date, to: Date) => ({ ...w, createdAt: { gte: from, lt: to } });
    const redeemWin = (from: Date, to: Date) => ({ ...redeemWhere, redeemedAt: { gte: from, lt: to } });

    const ptAgg = (type: PointTxnType, from: Date, to: Date) =>
      this.prisma.pointTransaction.aggregate({
        where: {
          ...(merchantId ? { merchantId } : {}),
          ...(storeId ? { storeId } : {}),
          type,
          createdAt: { gte: from, lt: to },
        },
        _sum: { amount: true },
      });
    const sumPt = async (type: PointTxnType, from: Date, to: Date) =>
      Math.abs(Number((await ptAgg(type, from, to))._sum.amount ?? 0));

    const [
      ordersToday, ordersYest,
      redeemToday, redeemYest,
      exchangeToday, exchangeYest,
      couponToday, couponYest,
      pointIssuedToday, pointIssuedYest,
      pointConsumedToday, pointConsumedYest,
    ] = await Promise.all([
      this.prisma.order.count({ where: win(orderWhere, today, tomorrow) }),
      this.prisma.order.count({ where: win(orderWhere, yesterday, today) }),
      this.prisma.redemptionRecord.count({ where: redeemWin(today, tomorrow) }),
      this.prisma.redemptionRecord.count({ where: redeemWin(yesterday, today) }),
      this.prisma.exchangeRecord.count({ where: { createdAt: { gte: today, lt: tomorrow } } }),
      this.prisma.exchangeRecord.count({ where: { createdAt: { gte: yesterday, lt: today } } }),
      this.prisma.couponInstance.count({ where: win(couponWhere, today, tomorrow) }),
      this.prisma.couponInstance.count({ where: win(couponWhere, yesterday, today) }),
      sumPt('EARN', today, tomorrow),
      sumPt('EARN', yesterday, today),
      sumPt('SPEND', today, tomorrow),
      sumPt('SPEND', yesterday, today),
    ]);

    /** 环比：昨日为 0 时给 100%（从无到有），否则按百分比 */
    const trend = (today_: number, yest: number) =>
      yest === 0 ? (today_ === 0 ? 0 : 100) : Number((((today_ - yest) / yest) * 100).toFixed(1));

    return [
      { key: 'orders', label: '今日订单', value: ordersToday, unit: '单', trend: trend(ordersToday, ordersYest) },
      { key: 'redemptions', label: '今日核销', value: redeemToday, unit: '笔', trend: trend(redeemToday, redeemYest) },
      { key: 'exchanges', label: '今日兑换', value: exchangeToday, unit: '笔', trend: trend(exchangeToday, exchangeYest) },
      { key: 'coupons', label: '今日发券', value: couponToday, unit: '张', trend: trend(couponToday, couponYest) },
      { key: 'pointIssued', label: '今日积分发行', value: pointIssuedToday, unit: '分', trend: trend(pointIssuedToday, pointIssuedYest) },
      { key: 'pointConsumed', label: '今日积分消耗', value: pointConsumedToday, unit: '分', trend: trend(pointConsumedToday, pointConsumedYest) },
    ];
  }

  async stats(user: JwtPayload) {
    const [cards, todo] = await Promise.all([this.statsCards(user), this.todo(user)]);
    return { cards, todo };
  }

  async todo(user: JwtPayload) {
    const { merchantId } = await this.scope(user);
    const pendingWhere: Prisma.MerchantWhereInput = {
      status: 'PENDING',
      ...(merchantId ? { id: merchantId } : {}),
    };
    const abnormalWhere: Prisma.OrderWhereInput = {
      status: 'ABNORMAL',
      ...(merchantId ? { merchantId } : {}),
    };

    // 未读数统一走 NotificationService（S5.4-B1）：口径 = 接收范围 ∩ 无「我的」阅读记录，
    // 保证「工作台未读数 === 通知列表未读数」，此处不再重复实现（旧实现只看 receiverId，会串号）。
    const [pendingMerchants, abnormalOrders, unreadNotifications] = await Promise.all([
      this.prisma.merchant.count({ where: pendingWhere }),
      this.prisma.order.count({ where: abnormalWhere }),
      this.notifications.getUnreadCount(user),
    ]);

    return { pendingMerchants, abnormalOrders, unreadNotifications };
  }

  /** 近 N 天趋势：订单 / 核销 / 兑换（三条线，DB 分组聚合后前端补齐空日期） */
  async trend(dto: TrendQueryDto, user: JwtPayload) {
    const { merchantId, storeId } = await this.scope(user);
    const days = dto.days ?? 7;

    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    const dates: string[] = [];
    for (let i = 0; i < days; i++) {
      const d = new Date(start);
      d.setDate(start.getDate() + i);
      dates.push(this.ymd(d));
    }
    const from = start;
    const to = new Date(start);
    to.setDate(to.getDate() + days);

    const ordConds: Prisma.Sql[] = [Prisma.sql`createdAt >= ${from} AND createdAt < ${to}`];
    if (merchantId) ordConds.push(Prisma.sql`AND merchantId = ${merchantId}`);
    if (storeId) ordConds.push(Prisma.sql`AND storeId = ${storeId}`);

    const redConds: Prisma.Sql[] = [Prisma.sql`redeemedAt >= ${from} AND redeemedAt < ${to} AND status = 'SUCCESS'`];
    if (merchantId) redConds.push(Prisma.sql`AND merchantId = ${merchantId}`);
    if (storeId) redConds.push(Prisma.sql`AND storeId = ${storeId}`);

    const [orderRows, redeemRows, exchangeRows] = await Promise.all([
      this.prisma.$queryRaw<Array<{ d: string; cnt: bigint }>>(
        Prisma.sql`SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS d, COUNT(*) AS cnt
                   FROM orders WHERE ${Prisma.join(ordConds, ' ')} GROUP BY d`,
      ),
      this.prisma.$queryRaw<Array<{ d: string; cnt: bigint }>>(
        Prisma.sql`SELECT DATE_FORMAT(redeemedAt, '%Y-%m-%d') AS d, COUNT(*) AS cnt
                   FROM redemption_records WHERE ${Prisma.join(redConds, ' ')} GROUP BY d`,
      ),
      this.prisma.$queryRaw<Array<{ d: string; cnt: bigint }>>(
        Prisma.sql`SELECT DATE_FORMAT(createdAt, '%Y-%m-%d') AS d, COUNT(*) AS cnt
                   FROM exchange_records WHERE createdAt >= ${from} AND createdAt < ${to} GROUP BY d`,
      ),
    ]);

    const fill = (rows: Array<{ d: string; cnt: bigint }>) => {
      const m = new Map(rows.map((r) => [r.d, Number(r.cnt)]));
      return dates.map((d) => m.get(d) ?? 0);
    };

    return {
      dates,
      orders: fill(orderRows),
      redemptions: fill(redeemRows),
      exchanges: fill(exchangeRows),
    };
  }

  /** 分布：券类型分布（按实例数） + 积分来源分布（按变动量绝对值），隔离到角色视角 */
  async distribution(user: JwtPayload) {
    const { merchantId, storeId } = await this.scope(user);
    const couponWhere: Prisma.CouponInstanceWhereInput = {
      ...(merchantId ? { issuerMerchantId: merchantId } : {}),
    };
    const ptWhere: Prisma.PointTransactionWhereInput = {
      ...(merchantId ? { merchantId } : {}),
      ...(storeId ? { storeId } : {}),
    };
    const [couponRows, ptRows] = await Promise.all([
      // CouponInstance 无 type 字段，券类型在关联模板的 couponType 上，故按 templateId 分组后映射
      this.prisma.couponInstance.groupBy({ by: ['templateId'], where: couponWhere, _count: { _all: true } }),
      this.prisma.pointTransaction.groupBy({ by: ['type'], where: ptWhere, _sum: { amount: true } }),
    ]);
    const templateIds = couponRows.map((r) => r.templateId);
    const templates = templateIds.length
      ? await this.prisma.couponTemplate.findMany({
          where: { id: { in: templateIds } },
          select: { id: true, ownerType: true },
        })
      : [];
    // 「券类型分布」口径 = 券归属类型（主体券 MAIN_COUPON / 附属商家券 SUB_COUPON），
    // 与 S4.3.1 coupon-summary 同源（coupon_instances + coupon_templates + 同一 scope 隔离），仅聚合维度不同。
    const ownerTypeOf = new Map(templates.map((t) => [t.id, t.ownerType]));
    // 按 ownerType 聚合（同一归属类型的多个模板合并为一条），避免饼图出现多个「主体券」切片
    const couponCount = new Map<string, number>();
    for (const r of couponRows) {
      const ot = ownerTypeOf.get(r.templateId) ?? 'UNKNOWN';
      couponCount.set(ot, (couponCount.get(ot) ?? 0) + r._count._all);
    }
    const couponTypes = Array.from(couponCount.entries()).map(([type, count]) => ({ type, count }));
    const pointSources = ptRows.map((r) => ({
      type: r.type,
      value: Math.abs(Number(r._sum.amount ?? 0)),
    }));
    return { couponTypes, pointSources };
  }

  /** Top5 商家：按订单交易额（payAmount）聚合，仅平台/主体可见；附属/店员返回空 */
  async topMerchants(user: JwtPayload): Promise<Array<{ merchantId: number; name: string; amount: number }>> {
    const { merchantId } = await this.scope(user);
    if (merchantId) return []; // 非平台/主体视角，「全平台 Top5」无意义
    const rows = await this.prisma.$queryRaw<
      Array<{ merchantId: number; name: string; amount: unknown }>
    >(
      Prisma.sql`SELECT o.merchantId, m.name, SUM(o.payAmount) AS amount
                 FROM orders o JOIN merchants m ON m.id = o.merchantId
                 GROUP BY o.merchantId, m.name
                 ORDER BY amount DESC
                 LIMIT 5`,
    );
    // mysql 驱动对 SUM(DECIMAL) / 关联 merchantId 可能返回 BigInt，响应前统一转 number，否则 JSON 序列化报错
    return rows.map((r) => ({
      merchantId: Number(r.merchantId),
      name: String(r.name),
      amount: Number(r.amount),
    }));
  }

  // ---------------------------------------------------------------- 7. 星系视图

  /**
   * 星系视图（`GET /dashboard/galaxy`）
   *
   * - **平台 / 主体**：全平台星系 —— 中心 = 平台 / 主体商家，行星 = 附属商家
   *   （`symbolSize` ∝ 本月交易额，颜色 = 商家状态）；
   * - **附属 / 店员**：**403**（没有全平台视角），前端据此自动降级为数据视图。
   *
   * `flows` = 「中心 → 行星」的交易额边，为第二期粒子流动画预留数据，本版不渲染动画。
   * 聚合一律走 DB（`groupBy` / `aggregate`），不在应用层循环。
   */
  async galaxy(user: JwtPayload) {
    const { merchantId } = await this.scope(user);
    if (merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '星系视图仅主体/平台可用');
    }

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const isPlatform = user.userType === 'PLATFORM';

    const centerMerchant = isPlatform
      ? null
      : await this.prisma.merchant.findUnique({
          where: { id: user.merchantId ?? -1 },
          select: { id: true, name: true, status: true },
        });
    const centerId = centerMerchant?.id ?? 0;

    const planets = await this.prisma.merchant.findMany({
      where: isPlatform ? { type: MerchantType.SUB } : { parentId: centerId || -1 },
      select: { id: true, name: true, code: true, status: true },
      orderBy: { id: 'asc' },
    });

    // 本月各行星交易额 / 订单数（一次 groupBy）
    const rows = await this.prisma.order.groupBy({
      by: ['merchantId'],
      where: {
        consumeTime: { gte: monthStart },
        merchantId: { in: planets.length ? planets.map((p) => p.id) : [-1] },
      },
      _sum: { payAmount: true },
      _count: { _all: true },
    });
    const agg = new Map(rows.map((r) => [r.merchantId, { amount: Number(r._sum.payAmount ?? 0), count: r._count._all }]));

    // 中心指标 = 整个星系（中心 + 所有行星）的汇总：
    //   平台 = 全部订单；主体 = 自己 + 直属附属（与行星集合一致）。
    // 若只统计主体自身订单，代金券场景下主体几乎没有消费订单，指标会长期接近 0。
    const centerScope = isPlatform ? {} : { merchantId: { in: [centerId, ...planets.map((p) => p.id)] } };
    const [centerMonth, centerToday] = await Promise.all([
      this.prisma.order.aggregate({
        where: { consumeTime: { gte: monthStart }, ...centerScope },
        _sum: { payAmount: true },
        _count: { _all: true },
      }),
      this.prisma.order.aggregate({
        where: { consumeTime: { gte: dayStart }, ...centerScope },
        _sum: { payAmount: true },
      }),
    ]);

    return {
      center: {
        id: centerId,
        name: centerMerchant?.name ?? '平台',
        type: isPlatform ? 'PLATFORM' : 'MAIN',
        status: centerMerchant?.status ?? null,
        monthAmount: Number(centerMonth._sum.payAmount ?? 0),
        todayAmount: Number(centerToday._sum.payAmount ?? 0),
        monthOrderCount: centerMonth._count._all,
        planetCount: planets.length,
      },
      planets: planets.map((p) => ({
        id: p.id,
        name: p.name,
        code: p.code,
        status: p.status,
        monthAmount: agg.get(p.id)?.amount ?? 0,
        orderCount: agg.get(p.id)?.count ?? 0,
      })),
      flows: planets.map((p) => ({ source: centerId, target: p.id, value: agg.get(p.id)?.amount ?? 0 })),
    };
  }
}
