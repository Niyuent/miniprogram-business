import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../auth/jwt-payload';
import { UserJwtPayload } from '../auth/user-jwt-payload';
import { ExchangePointsDto, QueryExchangeRecordsDto, QueryPointTransactionsDto } from '../point/dto/point.dto';
import { PointService } from '../point/point.service';
import { ExchangeAtShopDto } from './shop-exchange.dto';

/**
 * H5 / C 端业务服务（S5.1）
 *
 * 所有读写都以 **令牌里的 userId** 为准（`p.userId`），**不接受**前端传入的 userId；
 * 兑换时若请求体带了 `userId` 且与令牌不一致 → 403（防伪造）。
 *
 * 复用 S3 的 `PointService`：给其传一个「PLATFORM 视角」的合成身份 + 强制 userId，
 * 等价于「只能操作自己」的隔离（因为 userId 已被令牌锁定）。
 */
@Injectable()
export class H5Service {
  constructor(
    private readonly prisma: PrismaService,
    private readonly points: PointService,
  ) {}

  /** 把 C 端身份包装成 PointService 期望的 scope 身份（PLATFORM=不额外限制，安全性由「userId 锁定」保证） */
  private scope(p: UserJwtPayload): JwtPayload {
    return {
      sub: p.userId,
      username: `user:${p.userId}`,
      merchantId: null,
      storeId: null,
      userType: 'PLATFORM',
      roles: [],
      permissions: [],
    };
  }

  async me(p: UserJwtPayload) {
    const user = await this.prisma.user.findUnique({
      where: { id: p.userId },
      select: { id: true, nickname: true, phone: true, avatar: true, openid: true, unionid: true, status: true, registeredAt: true },
    });
    if (!user) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '用户不存在');
    return user;
  }

  /** 我的积分账户（余额 + 批次明细 + 可用/临期） */
  async account(p: UserJwtPayload) {
    return this.points.accountDetail(p.userId, this.scope(p));
  }

  /** 我的积分流水 */
  async transactions(p: UserJwtPayload, query: QueryPointTransactionsDto) {
    return this.points.listTransactions({ ...query, userId: p.userId, merchantId: undefined, storeId: undefined }, this.scope(p));
  }

  /**
   * 可兑商品清单（C 端兑换商城首屏）
   *
   * 只查自己的分；`merchantId` 是「当前在哪家店逛」的上下文，
   * 传了附属商家时只会看到主体商家的券（附属积分只能兑主体商品）。
   */
  async exchangeOptions(p: UserJwtPayload, allianceId?: number, merchantId?: number) {
    return this.points.exchangeOptions(
      { userId: p.userId, allianceId, merchantId },
      this.scope(p),
    );
  }

  /** 我的兑换记录 */
  async exchangeRecords(p: UserJwtPayload, query: QueryExchangeRecordsDto) {
    return this.points.listExchangeRecords({ ...query, userId: p.userId }, this.scope(p));
  }

  /** 可兑换券（已上架 + 设了兑换积分 + 有库存），按联盟过滤后分页。 */
  async couponTemplates(allianceId: number, page = 1, pageSize = 10) {
    if (!allianceId || allianceId < 1) {
      throw BizException.badRequest(ReasonCode.ALLIANCE_ID_REQUIRED, '查询券列表必须指定 allianceId');
    }
    const all = (await this.templates(allianceId)).list;
    const size = Math.min(Math.max(pageSize, 1), 20);
    const current = Math.max(page, 1);
    const start = (current - 1) * size;
    return { list: all.slice(start, start + size), total: all.length, page: current, pageSize: size };
  }

  /** 我的卡包。未使用只含未过期；已过期含状态过期和未使用但已过有效期。可按联盟筛选。 */
  async myCoupons(p: UserJwtPayload, status: string, page = 1, pageSize = 10, allianceId?: number) {
    const size = Math.min(Math.max(pageSize, 1), 20);
    const current = Math.max(page, 1);
    const now = new Date();
    const allianceFilter = allianceId && allianceId > 0 ? { template: { allianceId } } : {};
    const where =
      status === 'USED'
        ? { userId: p.userId, status: 'USED' as const, ...allianceFilter }
        : status === 'EXPIRED'
          ? {
              userId: p.userId,
              OR: [{ status: 'EXPIRED' as const }, { status: 'UNUSED' as const, expireAt: { lte: now } }],
              ...allianceFilter,
            }
          : { userId: p.userId, status: 'UNUSED' as const, expireAt: { gt: now }, ...allianceFilter };
    const [rows, total] = await Promise.all([
      this.prisma.couponInstance.findMany({
        where,
        include: {
          template: {
            select: {
              name: true,
              faceValue: true,
              subtitle: true,
              allianceId: true,
              alliance: { select: { name: true } },
              applyScope: true,
              ownerMerchant: { select: { name: true } },
              stores: { select: { store: { select: { name: true } } } },
            },
          },
        },
        orderBy: { id: 'desc' },
        skip: (current - 1) * size,
        take: size,
      }),
      this.prisma.couponInstance.count({ where }),
    ]);
    // 核销已取消联盟限制，卡包改按「适用范围」告诉用户这张券能去哪用
    const scopeText = (t: (typeof rows)[number]['template']) => {
      if (!t) return '';
      if (t.applyScope === 'SPECIFIED_STORES' && t.stores.length) {
        const names = t.stores.map((s) => s.store.name).filter(Boolean);
        if (names.length) {
          return `仅限 ${names.slice(0, 2).join('、')}${names.length > 2 ? ' 等' : ''} 使用`;
        }
        return '指定门店可用';
      }
      if (t.applyScope === 'ALL_STORES') return '全部门店可用';
      return t.ownerMerchant?.name ? `${t.ownerMerchant.name} 提供` : '';
    };
    return {
      list: rows.map((row) => ({
        id: row.id,
        code: row.code,
        status: row.status,
        name: row.template?.name ?? '代金券',
        subtitle: row.template?.subtitle ?? '',
        faceValue: Number(row.template?.faceValue ?? 0),
        /** 兼容字段：卡包已取消联盟筛选，旧前端仍可能读它 */
        allianceId: row.template?.allianceId ?? 0,
        allianceName: row.template?.alliance?.name ?? '',
        scopeText: scopeText(row.template),
        expireAt: row.expireAt,
        usedAt: row.usedAt,
      })),
      total,
      page: current,
      pageSize: size,
    };
  }

  /**
   * 可兑换券（已上架 + 设了兑换积分 + 有库存）。
   * 传 allianceId 时只返回该联盟；C 端不传时收敛到「该会员已加入的联盟」，
   * 避免一个公开接口把全部联盟的券一次性混出来（内部调用不传 userId 时不受限）。
   */
  async templates(allianceId?: number, userId?: number) {
    let allowedAllianceIds: number[] | undefined;
    if (!allianceId && userId) {
      const accounts = await this.prisma.pointAccount.findMany({
        where: { userId },
        select: { allianceId: true },
      });
      allowedAllianceIds = [...new Set(accounts.map((a) => a.allianceId))];
    }
    const rows = await this.prisma.couponTemplate.findMany({
      where: {
        status: 'PUBLISHED',
        pointsCost: { gt: 0 },
        // 商家可以单独关掉兑换；兑换接口会拒绝，商城也必须同步下架，
        // 否则用户看到「一键兑换」却总被 TEMPLATE_NOT_EXCHANGEABLE 打回
        exchangeEnabled: true,
        ...(allianceId && allianceId > 0 ? { allianceId } : {}),
        ...(!allianceId && userId
          ? { allianceId: { in: allowedAllianceIds?.length ? allowedAllianceIds : [-1] } }
          : {}),
      },
      orderBy: { id: 'asc' },
    });
    return {
      list: rows
        .filter((t) => t.totalStock - t.issuedCount > 0)
        .map((t) => ({
          id: t.id,
          name: t.name,
          subtitle: t.subtitle,
          status: t.status,
          ownerType: t.ownerType,
          allianceId: t.allianceId,
          faceValue: Number(t.faceValue),
          thresholdAmount: Number(t.thresholdAmount),
          pointsCost: t.pointsCost,
          perUserLimit: t.perUserLimit,
          totalStock: t.totalStock,
          remainingStock: t.totalStock - t.issuedCount,
          /** 前端极简提示：附属券需主体积分，不暴露「主体券/附属券」字眼 */
          requiresMainPoints: t.ownerType === 'SUB_COUPON',
        })),
    };
  }

  /** 积分兑换（userId 锁定为令牌用户；伪造 userId → 403） */
  async exchange(p: UserJwtPayload, dto: ExchangePointsDto) {
    const forged = (dto as { userId?: number }).userId;
    if (forged && forged !== p.userId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '不能为其它用户兑换积分');
    }
    if (!dto.allianceId || dto.allianceId < 1) {
      throw BizException.badRequest(ReasonCode.ALLIANCE_ID_REQUIRED, '兑换必须指定 allianceId');
    }
    return this.points.exchange(
      {
        userId: p.userId,
        allianceId: dto.allianceId,
        templateId: dto.templateId,
        requestId: dto.requestId,
        channel: dto.channel ?? 'H5',
        remark: dto.remark,
      },
      this.scope(p),
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // 「逛商家」：积分兑换不再有独立商城，而是藏进每一家商家的页面里。
  // 会员端不再出现联盟概念：
  //   · 可见券 = 本店可用券（自己发的 / 适用门店含本店的 / 全店通用的），不按联盟过滤；
  //   · 可扣分 = 本店攒的分（point_transactions.merchantId = 当前商家）；
  //   · 券列表、余额、兑换入口三者口径完全一致，核销也只认适用门店。
  // ─────────────────────────────────────────────────────────────────────────

  /** 半正矢公式算两点距离（米） */
  private distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number) {
    const rad = (v: number) => (v * Math.PI) / 180;
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    return Math.round(6371000 * 2 * Math.asin(Math.min(1, Math.sqrt(a))));
  }

  /** 我在这家店可用积分：该商家发的、未过期且没花完的批次之和（与兑换扣分同口径） */
  private async shopAvailablePoints(userId: number, merchantId: number) {
    const rows = await this.prisma.$queryRaw<Array<{ remain: bigint | number | null }>>`
      SELECT COALESCE(SUM(pt.remainingAmount), 0) AS remain
      FROM point_transactions pt
      WHERE pt.userId = ${userId}
        AND pt.merchantId = ${merchantId}
        AND pt.type IN ('EARN', 'ADJUST', 'REFUND')
        AND pt.remainingAmount > 0
        AND (pt.expireAt IS NULL OR pt.expireAt > NOW(3))`;
    return Number(rows[0]?.remain ?? 0);
  }

  /** 附近商家：已加入联盟的商家，按手机定位由近到远；没坐标/未授权的排在后面。 */
  async nearbyMerchants(p: UserJwtPayload, lng?: number, lat?: number) {
    const hasLocation =
      Number.isFinite(lng) &&
      Number.isFinite(lat) &&
      (lng as number) >= -180 &&
      (lng as number) <= 180 &&
      (lat as number) >= -90 &&
      (lat as number) <= 90;

    const [memberships, alliances] = await Promise.all([
      this.prisma.merchantAlliance.findMany({ select: { merchantId: true } }),
      this.prisma.alliance.findMany({ select: { mainMerchantId: true } }),
    ]);
    const joined = new Set<number>([
      ...memberships.map((row) => row.merchantId),
      ...alliances.map((row) => row.mainMerchantId),
    ]);
    if (!joined.size) return { located: hasLocation, total: 0, list: [] };

    const merchants = await this.prisma.merchant.findMany({
      where: { id: { in: [...joined] }, status: 'APPROVED' },
      select: { id: true, name: true, city: true, district: true, address: true },
      orderBy: { id: 'asc' },
    });
    const ids = merchants.map((row) => row.id);
    const [stores, pointRows] = await Promise.all([
      this.prisma.store.findMany({
        where: { status: 'OPEN', merchantId: { in: ids } },
        select: {
          id: true,
          name: true,
          merchantId: true,
          district: true,
          address: true,
          businessHours: true,
          lng: true,
          lat: true,
        },
        orderBy: { id: 'asc' },
      }),
      this.prisma.$queryRaw<
        Array<{
          merchantId: number | bigint | null;
          remain: bigint | number | null;
          earned: bigint | number | null;
        }>
      >`
        SELECT pt.merchantId AS merchantId,
               SUM(CASE WHEN pt.remainingAmount > 0
                         AND (pt.expireAt IS NULL OR pt.expireAt > NOW(3))
                        THEN pt.remainingAmount ELSE 0 END) AS remain,
               SUM(CASE WHEN pt.type = 'EARN' THEN pt.amount ELSE 0 END) AS earned
        FROM point_transactions pt
        WHERE pt.userId = ${p.userId}
          AND pt.type IN ('EARN', 'ADJUST', 'REFUND')
        GROUP BY pt.merchantId`,
    ]);

    const pointsOf = new Map<number, { remain: number; earned: number }>();
    for (const row of pointRows) {
      if (row.merchantId == null) continue;
      pointsOf.set(Number(row.merchantId), {
        remain: Number(row.remain ?? 0),
        earned: Number(row.earned ?? 0),
      });
    }
    const storesOf = new Map<number, typeof stores>();
    stores.forEach((store) => {
      const bucket = storesOf.get(store.merchantId) || [];
      bucket.push(store);
      storesOf.set(store.merchantId, bucket);
    });

    const list = merchants.map((merchant) => {
      const shopStores = storesOf.get(merchant.id) || [];
      let primary = shopStores[0];
      let meters: number | null = null;
      if (hasLocation) {
        for (const store of shopStores) {
          if (store.lat == null || store.lng == null) continue;
          const d = this.distanceMeters(
            lat as number,
            lng as number,
            Number(store.lat),
            Number(store.lng),
          );
          if (meters == null || d < meters) {
            meters = d;
            primary = store;
          }
        }
      }
      const address = primary
        ? [primary.district, primary.address].filter(Boolean).join(' ')
        : [merchant.city, merchant.district, merchant.address].filter(Boolean).join(' ');
      const mine = pointsOf.get(merchant.id);
      let distanceText = '';
      if (meters != null) {
        distanceText = meters < 1000 ? `${meters} m` : `${(meters / 1000).toFixed(1)} km`;
      }
      return {
        merchantId: merchant.id,
        name: merchant.name,
        address: address || '地址待完善',
        hours: primary?.businessHours || '',
        storeId: primary?.id ?? null,
        storeName: primary?.name || '',
        distanceMeters: meters,
        distanceText,
        availablePoints: mine?.remain ?? 0,
        earnedPoints: mine?.earned ?? 0,
      };
    });

    list.sort((a, b) => {
      if (a.distanceMeters != null && b.distanceMeters != null) {
        return a.distanceMeters - b.distanceMeters || a.merchantId - b.merchantId;
      }
      if (a.distanceMeters != null) return -1;
      if (b.distanceMeters != null) return 1;
      return b.availablePoints - a.availablePoints || a.merchantId - b.merchantId;
    });
    return { located: hasLocation, total: list.length, list };
  }

  /** 某家商家的积分兑换区：本店可用券 + 在这家店可用积分（不按联盟过滤） */
  async shopExchangeTemplates(p: UserJwtPayload, merchantId: number) {
    if (!merchantId || merchantId < 1) {
      throw BizException.badRequest(ReasonCode.MERCHANT_ID_REQUIRED, '请先选择一家商家');
    }
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true, status: true, city: true, district: true, address: true },
    });
    if (!merchant || merchant.status !== 'APPROVED') {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '这家商家还不能兑换');
    }
    const shopStores = await this.prisma.store.findMany({
      where: { status: 'OPEN', merchantId },
      select: { id: true, district: true, address: true, businessHours: true },
      orderBy: { id: 'asc' },
    });
    const storeIds = shopStores.map((store) => store.id);

    // 与核销口径保持一致：只列真能用的范围。SPECIFIED_MERCHANTS 核销侧尚未实现，
    // 列出来只会让用户兑到一张用不了的券。
    const scopeOr: Prisma.CouponTemplateWhereInput[] = [
      { ownerMerchantId: merchantId },
      { applyScope: 'ALL_STORES' },
    ];
    if (storeIds.length) {
      scopeOr.push({ stores: { some: { storeId: { in: storeIds } } } });
    }

    const [rows, availablePoints, ownedRows] = await Promise.all([
      this.prisma.couponTemplate.findMany({
        where: {
          status: 'PUBLISHED',
          pointsCost: { gt: 0 },
          exchangeEnabled: true,
          applyScope: { in: ['ALL_STORES', 'SPECIFIED_STORES'] },
          OR: scopeOr,
        },
        include: { ownerMerchant: { select: { name: true } } },
        orderBy: { id: 'asc' },
      }),
      this.shopAvailablePoints(p.userId, merchantId),
      this.prisma.couponInstance.findMany({
        where: { userId: p.userId },
        select: { templateId: true },
      }),
    ]);

    const ownedCount = new Map<number, number>();
    for (const row of ownedRows) {
      const id = Number(row.templateId ?? 0);
      if (id) ownedCount.set(id, (ownedCount.get(id) ?? 0) + 1);
    }

    const list = rows
      .filter((row) => row.totalStock - row.issuedCount > 0)
      .map((row) => {
        const owned = ownedCount.get(row.id) ?? 0;
        return {
          id: row.id,
          name: row.name,
          subtitle: row.subtitle,
          faceValue: Number(row.faceValue),
          thresholdAmount: Number(row.thresholdAmount),
          pointsCost: row.pointsCost,
          remainingStock: row.totalStock - row.issuedCount,
          perUserLimit: row.perUserLimit,
          ownerMerchantId: row.ownerMerchantId,
          ownerMerchantName: row.ownerMerchant?.name ?? merchant.name,
          scopeText: row.applyScope === 'ALL_STORES' ? '全店通用' : '指定门店可用',
          affordable: availablePoints >= row.pointsCost,
          ownedCount: owned,
          limitReached: row.perUserLimit > 0 && owned >= row.perUserLimit,
        };
      });

    const primary = shopStores[0];
    return {
      merchant: {
        id: merchant.id,
        name: merchant.name,
        address: primary
          ? [primary.district, primary.address].filter(Boolean).join(' ')
          : [merchant.city, merchant.district, merchant.address].filter(Boolean).join(''),
        hours: primary?.businessHours || '',
      },
      availablePoints,
      list,
    };
  }

  /** 按商家兑换：只扣这家店攒的分，且不看券所属联盟（前端完全不传联盟） */
  async exchangeAtShop(p: UserJwtPayload, merchantId: number, dto: ExchangeAtShopDto) {
    const view = await this.shopExchangeTemplates(p, merchantId);
    const item = view.list.find((row) => row.id === dto.templateId);
    if (!item) {
      throw BizException.badRequest(
        ReasonCode.TEMPLATE_NOT_AVAILABLE,
        `这张券不在「${view.merchant.name}」的兑换区（可能已下架或兑完了）`,
      );
    }
    if (item.limitReached) {
      throw BizException.conflict(
        ReasonCode.PER_USER_LIMIT_EXCEEDED,
        `「${item.name}」每人限兑 ${item.perUserLimit} 张，您已兑过 ${item.ownedCount} 张`,
      );
    }
    const template = await this.prisma.couponTemplate.findUnique({
      where: { id: dto.templateId },
      select: { allianceId: true },
    });
    return this.points.exchange(
      {
        userId: p.userId,
        allianceId: template?.allianceId || 1,
        templateId: dto.templateId,
        requestId: dto.requestId,
        channel: 'H5' as const,
      },
      this.scope(p),
      undefined,
      undefined,
      { merchantId },
    );
  }
}
