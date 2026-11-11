import { Injectable } from '@nestjs/common';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../auth/jwt-payload';

/**
 * 商家端「我的联盟」。
 *
 * 产品确认的口径：
 *  1. 商家登录后只分「商家 / 会员」两类，界面不再出现主体 / 附属字样；
 *  2. 商家只看自己已加入的联盟（merchant_alliances），没加入的一律不可见；
 *  3. 每个联盟展示：成员商家与门店、本店在该联盟的经营、清分与对账；
 *  4. 权限按「联盟角色」给：在该联盟可管理（盟主 / role=MAIN）→ 看全联盟成员的数字；
 *     普通成员 → 只看本店的数字（成员名单与门店仍可见，属于联盟公开信息）。
 *
 * 与会员端 /mini/alliances 完全独立：那边返回的是会员视角的商家卡片和我的积分，
 * 这里返回的是商家视角的经营数据，旧接口一行不改，避免打破既有回归。
 */

export interface ShopStats {
  merchantId: number;
  /** 该联盟积分池里本店发出的积分合计 */
  issuedPoints: number;
  earnCount: number;
  /** 会员从本店兑换的、券归属该联盟的券数 */
  exchangeCount: number;
  exchangePoints: number;
  /** 本店核销的该联盟券数 / 面值合计 */
  redeemCount: number;
  redeemAmount: number;
  /** 本店发布的该联盟券模板数 / 已发放张数 */
  templateCount: number;
  issuedCoupons: number;
}

const emptyStats = (merchantId: number): ShopStats => ({
  merchantId,
  issuedPoints: 0,
  earnCount: 0,
  exchangeCount: 0,
  exchangePoints: 0,
  redeemCount: 0,
  redeemAmount: 0,
  templateCount: 0,
  issuedCoupons: 0,
});

const num = (value: unknown): number => {
  const n = Number(value ?? 0);
  return Number.isFinite(n) ? n : 0;
};

@Injectable()
export class MerchantAllianceService {
  constructor(private readonly prisma: PrismaService) {}

  /** 当前令牌绑定的商家 id；平台账号没有 merchantId，这里不开放平台视角。 */
  private merchantIdOf(user: JwtPayload): number {
    const id = Number(user?.merchantId ?? 0);
    if (!id) {
      throw BizException.forbidden(
        ReasonCode.FORBIDDEN_SCOPE,
        '请用商家身份查看联盟（当前账号未绑定商家）',
      );
    }
    return id;
  }

  /** 汇总一个联盟里若干商家的经营数字。所有查询都是按联盟 + 商家白名单收敛的。 */
  private async collectStats(allianceId: number, merchantIds: number[]): Promise<Map<number, ShopStats>> {
    const result = new Map<number, ShopStats>();
    if (!merchantIds.length) return result;
    merchantIds.forEach((id) => result.set(id, emptyStats(id)));

    // 券与积分都靠「券模板所属联盟」串起来：exchange_records / redemption_records
    // 本身没有 allianceId，先取该联盟的模板 id 集合再做聚合。
    const templates = await this.prisma.couponTemplate.findMany({
      where: { allianceId },
      select: { id: true },
    });
    const templateIds = templates.map((row) => row.id);

    const [earns, exchanges, redeems, issued] = await Promise.all([
      this.prisma.pointTransaction.groupBy({
        by: ['merchantId'],
        where: { allianceId, type: 'EARN', merchantId: { in: merchantIds } },
        _sum: { amount: true },
        _count: { _all: true },
      }),
      templateIds.length
        ? this.prisma.exchangeRecord.groupBy({
            by: ['merchantId'],
            where: { merchantId: { in: merchantIds }, templateId: { in: templateIds } },
            _sum: { pointsCost: true },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      templateIds.length
        ? this.prisma.redemptionRecord.groupBy({
            by: ['merchantId'],
            where: {
              merchantId: { in: merchantIds },
              templateId: { in: templateIds },
              status: 'SUCCESS',
              reversedAt: null,
            },
            _sum: { faceValue: true },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      this.prisma.couponTemplate.groupBy({
        by: ['ownerMerchantId'],
        where: { allianceId, ownerMerchantId: { in: merchantIds } },
        _sum: { issuedCount: true },
        _count: { _all: true },
      }),
    ]);

    for (const row of earns) {
      const stat = result.get(Number(row.merchantId));
      if (!stat) continue;
      stat.issuedPoints = num(row._sum.amount);
      stat.earnCount = num(row._count._all);
    }
    for (const row of exchanges as Array<{ merchantId: number | null; _sum: { pointsCost: number | null }; _count: { _all: number } }>) {
      const stat = result.get(Number(row.merchantId));
      if (!stat) continue;
      stat.exchangePoints = num(row._sum.pointsCost);
      stat.exchangeCount = num(row._count._all);
    }
    for (const row of redeems as Array<{ merchantId: number | null; _sum: { faceValue: unknown }; _count: { _all: number } }>) {
      const stat = result.get(Number(row.merchantId));
      if (!stat) continue;
      stat.redeemAmount = num(row._sum.faceValue);
      stat.redeemCount = num(row._count._all);
    }
    for (const row of issued) {
      const stat = result.get(Number(row.ownerMerchantId));
      if (!stat) continue;
      stat.issuedCoupons = num(row._sum.issuedCount);
      stat.templateCount = num(row._count._all);
    }
    return result;
  }

  /** 清分（商家互结）与平台对账。bill 表没有 allianceId，按「参与商家属于本联盟」归集。 */
  private async collectMoney(allianceId: number, merchantIds: number[]) {
    const [bills, reports] = await Promise.all([
      this.prisma.merchantClearingBill.findMany({
        where: {
          OR: [
            { payerMerchantId: { in: merchantIds } },
            { receiverMerchantId: { in: merchantIds } },
          ],
        },
        include: { period: { select: { periodKey: true } } },
        orderBy: { id: 'desc' },
        take: 50,
      }),
      this.prisma.settlementReport.findMany({
        where: { merchantId: { in: merchantIds } },
        select: {
          id: true,
          reportNo: true,
          periodStart: true,
          periodEnd: true,
          totalAmount: true,
          status: true,
        },
        orderBy: { periodEnd: 'desc' },
        take: 20,
      }),
    ]);

    const inScope = new Set(merchantIds);
    let payable = 0;
    let receivable = 0;
    for (const bill of bills) {
      const amount = num(bill.netAmount);
      if (inScope.has(bill.payerMerchantId)) payable += amount;
      if (inScope.has(bill.receiverMerchantId)) receivable += amount;
    }
    const names = await this.merchantNames([
      ...bills.flatMap((b) => [b.payerMerchantId, b.receiverMerchantId]),
    ]);
    return {
      scopeNote:
        `账单按付款方 / 收款方是否属于联盟 #${allianceId} 归集；` +
        '清分账本本身不记录联盟，跨联盟的券以商家归属为准。',
      payable: Math.round(payable * 100) / 100,
      receivable: Math.round(receivable * 100) / 100,
      net: Math.round((receivable - payable) * 100) / 100,
      billCount: bills.length,
      bills: bills.map((bill) => ({
        id: bill.id,
        periodKey: bill.period.periodKey,
        payerMerchantId: bill.payerMerchantId,
        payerMerchantName: names.get(bill.payerMerchantId) ?? `商家#${bill.payerMerchantId}`,
        receiverMerchantId: bill.receiverMerchantId,
        receiverMerchantName: names.get(bill.receiverMerchantId) ?? `商家#${bill.receiverMerchantId}`,
        netAmount: num(bill.netAmount),
        status: bill.status,
      })),
      settlement: {
        reportCount: reports.length,
        totalAmount: Math.round(reports.reduce((sum, r) => sum + num(r.totalAmount), 0) * 100) / 100,
        reports: reports.map((r) => ({
          id: r.id,
          reportNo: r.reportNo,
          periodStart: r.periodStart,
          periodEnd: r.periodEnd,
          totalAmount: num(r.totalAmount),
          status: r.status,
        })),
      },
    };
  }

  private async merchantNames(ids: number[]): Promise<Map<number, string>> {
    const unique = [...new Set(ids)];
    if (!unique.length) return new Map();
    const rows = await this.prisma.merchant.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(rows.map((r) => [r.id, r.name]));
  }

  /** 联盟成员名单 + 门店（含盟主兜底：老数据可能没写 merchant_alliances）。 */
  private async membershipOf(allianceId: number, mainMerchantId: number) {
    const rows = await this.prisma.merchantAlliance.findMany({
      where: { allianceId },
      select: { merchantId: true, role: true, createdAt: true },
      orderBy: { id: 'asc' },
    });
    const byId = new Map<number, { role: string; joinedAt: Date }>();
    rows.forEach((r) => byId.set(r.merchantId, { role: r.role, joinedAt: r.createdAt }));
    if (!byId.has(mainMerchantId)) {
      byId.set(mainMerchantId, { role: 'MAIN', joinedAt: new Date(0) });
    }
    const ids = [...byId.keys()];
    const [merchants, stores] = await Promise.all([
      this.prisma.merchant.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true, status: true, city: true, district: true, address: true },
      }),
      this.prisma.store.findMany({
        where: { merchantId: { in: ids }, status: 'OPEN' },
        select: { id: true, name: true, merchantId: true, district: true, address: true },
        orderBy: { id: 'asc' },
      }),
    ]);
    const merchantMap = new Map(merchants.map((m) => [m.id, m]));
    return { ids, byId, merchantMap, stores };
  }

  private async assertMember(allianceId: number, merchantId: number) {
    const [alliance, membership] = await Promise.all([
      this.prisma.alliance.findUnique({
        where: { id: allianceId },
        select: { id: true, name: true, mainMerchantId: true },
      }),
      this.prisma.merchantAlliance.findUnique({
        where: { merchantId_allianceId: { merchantId, allianceId } },
        select: { role: true },
      }),
    ]);
    if (!alliance) {
      throw BizException.notFound(ReasonCode.ALLIANCE_NOT_FOUND, `联盟 #${allianceId} 不存在`);
    }
    // 盟主即使没有成员行，也视为已加入该联盟
    const isMain = alliance.mainMerchantId === merchantId;
    if (!membership && !isMain) {
      throw BizException.notFound(
        ReasonCode.RESOURCE_NOT_FOUND,
        `未加入联盟「${alliance.name}」，无法查看`,
      );
    }
    return {
      alliance,
      /** 可管理 = 该联盟盟主，或在联盟内的角色是 MAIN；界面不出现主体/附属字样 */
      isManager: isMain || membership?.role === 'MAIN',
    };
  }

  /** GET /merchant-alliances/mine：我加入的联盟列表 + 每个联盟的本店概要 */
  async mine(user: JwtPayload) {
    const merchantId = this.merchantIdOf(user);
    const [me, rows] = await Promise.all([
      this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { id: true, name: true },
      }),
      this.prisma.merchantAlliance.findMany({
        where: { merchantId },
        include: { alliance: { select: { id: true, name: true, mainMerchantId: true } } },
        orderBy: { allianceId: 'asc' },
      }),
    ]);
    if (!me) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '商家档案不存在');
    }

    // 盟主自己创建的联盟也要出现（历史数据可能没插入成员行）
    const own = await this.prisma.alliance.findMany({
      where: { mainMerchantId: merchantId },
      select: { id: true, name: true, mainMerchantId: true },
    });
    const merged = new Map<number, { id: number; name: string; mainMerchantId: number; role: string }>();
    own.forEach((a) => merged.set(a.id, { ...a, role: 'MAIN' }));
    rows.forEach((r) =>
      merged.set(r.allianceId, {
        id: r.allianceId,
        name: r.alliance.name,
        mainMerchantId: r.alliance.mainMerchantId,
        role: r.role,
      }),
    );

    const list = await Promise.all(
      [...merged.values()].sort((a, b) => a.id - b.id).map(async (row) => {
        const membership = await this.membershipOf(row.id, row.mainMerchantId);
        const storeCount = membership.stores.length;
        const stats = (await this.collectStats(row.id, [merchantId])).get(merchantId) ?? emptyStats(merchantId);
        const isManager = row.mainMerchantId === merchantId || row.role === 'MAIN';
        return {
          allianceId: row.id,
          name: row.name,
          mainMerchantId: row.mainMerchantId,
          /** 可查看全联盟数字的标记，界面上叫「可管理」，不出现主体/附属 */
          isManager,
          memberCount: membership.ids.length,
          storeCount,
          myStats: stats,
        };
      }),
    );

    return { merchant: me, total: list.length, list };
  }

  /** GET /merchant-alliances/:id：成员与门店、本店/全联盟经营、清分与对账 */
  async detail(allianceId: number, user: JwtPayload) {
    const merchantId = this.merchantIdOf(user);
    const { alliance, isManager } = await this.assertMember(allianceId, merchantId);
    const membership = await this.membershipOf(allianceId, alliance.mainMerchantId);
    const [mainMerchant, viewer] = await Promise.all([
      this.prisma.merchant.findUnique({
        where: { id: alliance.mainMerchantId },
        select: { id: true, name: true },
      }),
      this.prisma.merchant.findUnique({
        where: { id: merchantId },
        select: { id: true, name: true },
      }),
    ]);

    // 可管理者看全联盟成员的经营数字；普通成员只统计自己。
    const statsIds = isManager ? membership.ids : [merchantId];
    const [statsMap, money] = await Promise.all([
      this.collectStats(allianceId, statsIds),
      this.collectMoney(allianceId, isManager ? membership.ids : [merchantId]),
    ]);

    const storesOf = new Map<number, typeof membership.stores>();
    membership.stores.forEach((store) => {
      const bucket = storesOf.get(store.merchantId) ?? [];
      bucket.push(store);
      storesOf.set(store.merchantId, bucket);
    });

    const members = membership.ids.map((id) => {
      const m = membership.merchantMap.get(id);
      const shops = storesOf.get(id) ?? [];
      const visible = statsMap.has(id);
      return {
        merchantId: id,
        name: m?.name ?? `商家#${id}`,
        status: m?.status ?? '',
        address: [m?.city, m?.district, m?.address].filter(Boolean).join(' '),
        isManager: id === alliance.mainMerchantId || membership.byId.get(id)?.role === 'MAIN',
        isSelf: id === merchantId,
        storeCount: shops.length,
        stores: shops.map((s) => ({
          id: s.id,
          name: s.name,
          address: [s.district, s.address].filter(Boolean).join(' '),
        })),
        /** 普通成员看不到别家的经营数字，字段为 null */
        stats: visible ? statsMap.get(id) ?? emptyStats(id) : null,
      };
    });

    return {
      alliance: {
        id: alliance.id,
        name: alliance.name,
        mainMerchantId: alliance.mainMerchantId,
        mainMerchantName: mainMerchant?.name ?? '',
        memberCount: members.length,
        storeCount: membership.stores.length,
      },
      viewer: {
        merchantId,
        merchantName: viewer?.name ?? '',
        isManager,
      },
      scopeNote: isManager
        ? '你可查看本联盟全部成员的经营数字'
        : '成员名单与门店可见；经营与结算数字只展示本店',
      members,
      myStats: statsMap.get(merchantId) ?? emptyStats(merchantId),
      money,
    };
  }
}
