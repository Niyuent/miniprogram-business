import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { changePct, shanghaiDay } from '../daily-report';
import {
  COUPON_TRAFFIC_WINDOW_MS,
  LOST_MEMBER_DAYS,
  POINTS_OVERISSUE_RATIO,
  TOOL_TIMEOUT_MS,
} from './ai-tools.constants';

export type CompareMode = 'prev_period' | 'prev_month';

export interface ToolsMeta {
  from?: string;
  to?: string;
  total?: number;
  truncated?: boolean;
  offset?: number;
  limit?: number;
}

export interface ToolsResult<T> {
  items: T[];
  meta: ToolsMeta;
}

function withTimeout<T>(promise: Promise<T>, ms = TOOL_TIMEOUT_MS): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`工具超时 ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

function parseYmd(ymd: string): { from: Date; to: Date } {
  const from = new Date(`${ymd}T00:00:00+08:00`);
  if (Number.isNaN(from.getTime())) throw new Error(`非法日期 ${ymd}`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { from, to };
}

function ymdOf(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

function shiftYmd(ymd: string, days: number): string {
  const base = new Date(`${ymd}T12:00:00+08:00`);
  return ymdOf(new Date(base.getTime() + days * 24 * 60 * 60 * 1000));
}

function daysBetween(fromYmd: string, toYmd: string): number {
  const a = new Date(`${fromYmd}T12:00:00+08:00`).getTime();
  const b = new Date(`${toYmd}T12:00:00+08:00`).getTime();
  return Math.max(1, Math.round((b - a) / (24 * 60 * 60 * 1000)) + 1);
}

/**
 * 只读数据聚合。唯一数据出口。
 * 方法签名强制带 merchantId，但只能由 service 层从 JWT 注入，禁止出现在工具参数/请求体/Prompt。
 */
@Injectable()
export class AiToolsService {
  constructor(private readonly prisma: PrismaService) {}

  async businessSummary(
    merchantId: number,
    fromYmd: string,
    toYmd: string,
    compare: CompareMode = 'prev_period',
  ): Promise<
    ToolsResult<{
      from: string;
      to: string;
      revenue: number;
      orders: number;
      redemptions: number;
      pointsIssued: number;
      pointsSpent: number;
      dodPct: number | null;
      momPct: number | null;
      compareFrom: string;
      compareTo: string;
      compareRevenue: number;
      compareOrders: number;
    }>
  > {
    return withTimeout(
      this.businessSummaryInner(merchantId, fromYmd, toYmd, compare),
    );
  }

  private async businessSummaryInner(
    merchantId: number,
    fromYmd: string,
    toYmd: string,
    compare: CompareMode,
  ) {
    const { from, to } = rangeInclusive(fromYmd, toYmd);
    const span = daysBetween(fromYmd, toYmd);
    let compareFrom: string;
    let compareTo: string;
    if (compare === 'prev_month') {
      compareFrom = shiftMonths(fromYmd, -1);
      compareTo = shiftMonths(toYmd, -1);
    } else {
      compareFrom = shiftYmd(fromYmd, -span);
      compareTo = shiftYmd(toYmd, -span);
    }
    const compareRange = rangeInclusive(compareFrom, compareTo);

    const [cur, prev] = await Promise.all([
      this.aggregateWindow(merchantId, from, to),
      this.aggregateWindow(merchantId, compareRange.from, compareRange.to),
    ]);

    const dodPct = changePct(cur.revenue, prev.revenue);
    const momPct =
      compare === 'prev_month' ? dodPct : changePct(cur.revenue, prev.revenue);

    return {
      items: [
        {
          from: fromYmd,
          to: toYmd,
          revenue: cur.revenue,
          orders: cur.orders,
          redemptions: cur.redemptions,
          pointsIssued: cur.pointsIssued,
          pointsSpent: cur.pointsSpent,
          dodPct,
          momPct: compare === 'prev_month' ? momPct : changePct(cur.revenue, prev.revenue),
          compareFrom,
          compareTo,
          compareRevenue: prev.revenue,
          compareOrders: prev.orders,
        },
      ],
      meta: { from: fromYmd, to: toYmd, total: 1, truncated: false },
    };
  }

  /**
   * 券表现。核销率 = 区间内核销数 / 区间内发放数（发放取 coupon_instances.obtainedAt）。
   * 「券带动客流」：核销后 24 小时内同会员产生订单计 1 次，仅统计一次，不做去重归因。
   */
  async couponPerformance(
    merchantId: number,
    days = 7,
    limit = 20,
  ): Promise<
    ToolsResult<{
      templateId: number;
      name: string;
      issued: number;
      redeemed: number;
      redeemRate: number;
      trafficDriven: number;
      faceValue: number;
    }>
  > {
    return withTimeout(this.couponPerformanceInner(merchantId, days, limit));
  }

  private async couponPerformanceInner(merchantId: number, days: number, limit: number) {
    const safeDays = Math.min(30, Math.max(1, days));
    const safeLimit = Math.min(50, Math.max(1, limit));
    const to = shanghaiDay(0);
    const from = shanghaiDay(1 - safeDays);

    const redemptions = await this.prisma.redemptionRecord.findMany({
      where: {
        merchantId,
        status: 'SUCCESS',
        redeemedAt: { gte: from.from, lt: to.to },
      },
      select: {
        templateId: true,
        userId: true,
        redeemedAt: true,
        faceValue: true,
        template: { select: { id: true, name: true, faceValue: true } },
      },
    });

    const issuedGroups = await this.prisma.couponInstance.groupBy({
      by: ['templateId'],
      where: {
        issuerMerchantId: merchantId,
        obtainedAt: { gte: from.from, lt: to.to },
      },
      _count: { _all: true },
    });
    const issuedMap = new Map(issuedGroups.map((g) => [g.templateId, g._count._all]));

    type Acc = {
      templateId: number;
      name: string;
      faceValue: number;
      redeemed: number;
      trafficDriven: number;
      issued: number;
    };
    const byTpl = new Map<number, Acc>();

    for (const row of redemptions) {
      const cur =
        byTpl.get(row.templateId) ??
        ({
          templateId: row.templateId,
          name: row.template.name,
          faceValue: Number(row.template.faceValue),
          redeemed: 0,
          trafficDriven: 0,
          issued: issuedMap.get(row.templateId) ?? 0,
        } satisfies Acc);
      cur.redeemed += 1;
      byTpl.set(row.templateId, cur);
    }

    // 券带动客流：每条核销最多计 1 次（24h 内同会员有订单）
    await Promise.all(
      [...byTpl.keys()].map(async (templateId) => {
        const rows = redemptions.filter((r) => r.templateId === templateId);
        let driven = 0;
        for (const r of rows) {
          const windowEnd = new Date(r.redeemedAt.getTime() + COUPON_TRAFFIC_WINDOW_MS);
          const hit = await this.prisma.order.findFirst({
            where: {
              merchantId,
              userId: r.userId,
              status: { not: 'CANCELED' },
              createdAt: { gt: r.redeemedAt, lte: windowEnd },
            },
            select: { id: true },
          });
          if (hit) driven += 1;
        }
        const acc = byTpl.get(templateId)!;
        acc.trafficDriven = driven;
      }),
    );

    // 补上有发放无核销的模板
    for (const [templateId, issued] of issuedMap) {
      if (byTpl.has(templateId)) continue;
      const tpl = await this.prisma.couponTemplate.findUnique({
        where: { id: templateId },
        select: { id: true, name: true, faceValue: true },
      });
      if (!tpl) continue;
      byTpl.set(templateId, {
        templateId,
        name: tpl.name,
        faceValue: Number(tpl.faceValue),
        redeemed: 0,
        trafficDriven: 0,
        issued,
      });
    }

    const all = [...byTpl.values()]
      .map((row) => ({
        ...row,
        redeemRate: row.issued > 0 ? Number(((row.redeemed / row.issued) * 100).toFixed(1)) : row.redeemed > 0 ? 100 : 0,
      }))
      .sort((a, b) => b.redeemed - a.redeemed);

    const truncated = all.length > safeLimit;
    return {
      items: all.slice(0, safeLimit),
      meta: {
        from: from.ymd,
        to: to.ymd,
        total: all.length,
        truncated,
        limit: safeLimit,
      },
    };
  }

  async lostMembers(
    merchantId: number,
    limit = 20,
    offset = 0,
  ): Promise<
    ToolsResult<{
      userId: number;
      lastVisitAt: string;
      daysSince: number;
      historicalSpend: number;
      orderCount: number;
    }>
  > {
    return withTimeout(this.lostMembersInner(merchantId, limit, offset));
  }

  private async lostMembersInner(merchantId: number, limit: number, offset: number) {
    const safeLimit = Math.min(50, Math.max(1, limit));
    const safeOffset = Math.max(0, offset);
    const cutoff = new Date(Date.now() - LOST_MEMBER_DAYS * 24 * 60 * 60 * 1000);

    const groups = await this.prisma.order.groupBy({
      by: ['userId'],
      where: { merchantId, status: { not: 'CANCELED' } },
      _count: { _all: true },
      _sum: { payAmount: true },
      _max: { createdAt: true },
    });

    const lost = groups
      .filter((g) => {
        const last = g._max.createdAt;
        return last != null && last < cutoff;
      })
      .map((g) => {
        const last = g._max.createdAt!;
        const daysSince = Math.floor((Date.now() - last.getTime()) / (24 * 60 * 60 * 1000));
        return {
          userId: g.userId,
          lastVisitAt: last.toISOString(),
          daysSince,
          historicalSpend: Number(g._sum.payAmount ?? 0),
          orderCount: g._count._all,
        };
      })
      .sort((a, b) => b.historicalSpend - a.historicalSpend);

    const page = lost.slice(safeOffset, safeOffset + safeLimit);
    return {
      items: page,
      meta: {
        total: lost.length,
        truncated: safeOffset + safeLimit < lost.length,
        offset: safeOffset,
        limit: safeLimit,
      },
    };
  }

  async cashflowHint(_merchantId: number): Promise<{ available: false; note: string }> {
    return { available: false, note: '尚未接入财务诊断' };
  }

  /**
   * 平台侧异常商家（只读）。只能由 PLATFORM 调用或巡检进程内调用。
   */
  async abnormalMerchants(
    hours = 24,
    limit = 50,
  ): Promise<
    ToolsResult<{
      merchantId: number;
      merchantName: string;
      flags: string[];
    }>
  > {
    return withTimeout(this.abnormalMerchantsInner(hours, limit));
  }

  private async abnormalMerchantsInner(hours: number, limit: number) {
    const { detectAbnormalFlags } = await import('../chat/inspection-rules');
    const safeHours = Math.min(168, Math.max(1, hours));
    const safeLimit = Math.min(50, Math.max(1, limit));
    const since = new Date(Date.now() - safeHours * 60 * 60 * 1000);

    const merchants = await this.prisma.merchant.findMany({
      where: { status: 'APPROVED' },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });

    const items: Array<{ merchantId: number; merchantName: string; flags: string[] }> = [];
    for (const m of merchants) {
      const snapshot = await this.buildInspectionSnapshot(m.id, since);
      const flags = detectAbnormalFlags(snapshot);
      if (flags.length) {
        items.push({ merchantId: m.id, merchantName: m.name, flags: flags.map((f) => f.rule) });
      }
      if (items.length >= safeLimit) break;
    }

    return {
      items,
      meta: { total: items.length, truncated: false, limit: safeLimit },
    };
  }

  async buildInspectionSnapshot(merchantId: number, _since: Date) {
    const today = shanghaiDay(0);
    const monthStart = `${today.ymd.slice(0, 8)}01`;
    const monthFrom = new Date(`${monthStart}T00:00:00+08:00`);

    const [todayOrders, todayRedeems, weekRedeems, monthRevenue, monthPointsIssued, nightRedeems] =
      await Promise.all([
        this.prisma.order.count({
          where: {
            merchantId,
            status: { not: 'CANCELED' },
            createdAt: { gte: today.from, lt: today.to },
          },
        }),
        this.prisma.redemptionRecord.count({
          where: {
            merchantId,
            status: 'SUCCESS',
            redeemedAt: { gte: today.from, lt: today.to },
          },
        }),
        this.prisma.redemptionRecord.findMany({
          where: {
            merchantId,
            status: 'SUCCESS',
            redeemedAt: {
              gte: new Date(today.from.getTime() - 7 * 24 * 60 * 60 * 1000),
              lt: today.to,
            },
          },
          select: { redeemedAt: true, userId: true },
        }),
        this.prisma.order.aggregate({
          where: {
            merchantId,
            status: { not: 'CANCELED' },
            createdAt: { gte: monthFrom, lt: today.to },
          },
          _sum: { payAmount: true },
        }),
        this.prisma.pointTransaction.aggregate({
          where: {
            merchantId,
            type: 'EARN',
            createdAt: { gte: monthFrom, lt: today.to },
          },
          _sum: { amount: true },
        }),
        this.prisma.redemptionRecord.count({
          where: {
            merchantId,
            status: 'SUCCESS',
            redeemedAt: { gte: today.from, lt: today.to },
            // 00:00–05:00 上海时区：用 hour 原始比较不稳，下面在内存里筛
          },
        }),
      ]);

    const nightCount = weekRedeems.filter((r) => {
      if (r.redeemedAt < today.from || r.redeemedAt >= today.to) return false;
      const hour = Number(
        new Intl.DateTimeFormat('en-US', {
          timeZone: 'Asia/Shanghai',
          hour: 'numeric',
          hour12: false,
        }).format(r.redeemedAt),
      );
      return hour >= 0 && hour < 5;
    }).length;

    const last7DaysRedeems = weekRedeems.filter(
      (r) => r.redeemedAt >= new Date(today.from.getTime() - 7 * 24 * 60 * 60 * 1000),
    ).length;
    const avg7 = last7DaysRedeems / 7;

    // 连续 7 天 0 单 & 前 30 天有单
    const dayCounts: number[] = [];
    for (let i = 0; i < 7; i++) {
      const d = shanghaiDay(-i);
      dayCounts.push(
        await this.prisma.order.count({
          where: {
            merchantId,
            status: { not: 'CANCELED' },
            createdAt: { gte: d.from, lt: d.to },
          },
        }),
      );
    }
    const prior30 = await this.prisma.order.count({
      where: {
        merchantId,
        status: { not: 'CANCELED' },
        createdAt: {
          gte: new Date(today.from.getTime() - 30 * 24 * 60 * 60 * 1000),
          lt: new Date(today.from.getTime() - 7 * 24 * 60 * 60 * 1000),
        },
      },
    });

    // 同一会员当日核销 ≥ 3
    const todayUserRedeems = new Map<number, number>();
    for (const r of weekRedeems) {
      if (r.redeemedAt < today.from || r.redeemedAt >= today.to) continue;
      todayUserRedeems.set(r.userId, (todayUserRedeems.get(r.userId) ?? 0) + 1);
    }
    const repeatRedeemUsers = [...todayUserRedeems.values()].filter((n) => n >= 3).length;

    void nightRedeems; // 用 nightCount 更准

    return {
      merchantId,
      todayOrders,
      todayRedeems,
      avg7DayRedeems: avg7,
      nightRedeemRatio: todayRedeems > 0 ? nightCount / todayRedeems : 0,
      zeroOrderDays7: dayCounts.every((c) => c === 0),
      prior30HadOrders: prior30 > 0,
      repeatRedeemUsers,
      monthRevenue: Number(monthRevenue._sum.payAmount ?? 0),
      monthPointsIssued: Math.abs(Number(monthPointsIssued._sum.amount ?? 0)),
      pointsOverissueRatio: POINTS_OVERISSUE_RATIO,
    };
  }

  private async aggregateWindow(merchantId: number, from: Date, to: Date) {
    const [ordersAgg, redemptions, pointsIssued, pointsSpent] = await Promise.all([
      this.prisma.order.aggregate({
        where: { merchantId, createdAt: { gte: from, lt: to }, status: { not: 'CANCELED' } },
        _count: { _all: true },
        _sum: { payAmount: true },
      }),
      this.prisma.redemptionRecord.count({
        where: { merchantId, status: 'SUCCESS', redeemedAt: { gte: from, lt: to } },
      }),
      this.prisma.pointTransaction.aggregate({
        where: { merchantId, type: 'EARN', createdAt: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
      this.prisma.pointTransaction.aggregate({
        where: { merchantId, type: 'SPEND', createdAt: { gte: from, lt: to } },
        _sum: { amount: true },
      }),
    ]);
    return {
      revenue: Number(ordersAgg._sum.payAmount ?? 0),
      orders: ordersAgg._count._all,
      redemptions,
      pointsIssued: Math.abs(Number(pointsIssued._sum.amount ?? 0)),
      pointsSpent: Math.abs(Number(pointsSpent._sum.amount ?? 0)),
    };
  }
}

function rangeInclusive(fromYmd: string, toYmd: string): { from: Date; to: Date } {
  const from = parseYmd(fromYmd).from;
  const toExclusive = parseYmd(toYmd).to;
  return { from, to: toExclusive };
}

function shiftMonths(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + delta, d));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}
