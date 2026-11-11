import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../auth/jwt-payload';
import { UserJwtPayload } from '../auth/user-jwt-payload';

const MERCHANT_TABS = ['workbench', 'ai', 'verify', 'profile'] as const;
/** 会员端 4 个底部入口：积分商城已取消，兑换藏进「逛商家」里每家商家的页面 */
const MEMBER_TABS = ['home', 'wallet', 'shops', 'profile'] as const;

/** 会员码票据有效期：5 分钟。截图/拍照转发超过该时长即失效。 */
const MEMBER_QR_TTL_SECONDS = 300;

export interface MiniProfile {
  name: string;
  avatar: string | null;
  phone?: string | null;
}

export interface MiniBootstrap {
  role: 'merchant' | 'member';
  profile: MiniProfile;
  merchant: { id: number; name: string; storeId: number | null } | null;
  tabs: readonly string[];
  /** true = 这个手机号在另一侧也有账号，可以「切到会员端 / 切到商家端」 */
  switchable?: boolean;
}

@Injectable()
export class MiniService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async bootstrap(user: UserJwtPayload | JwtPayload): Promise<MiniBootstrap> {
    if (this.isUser(user)) return this.bootstrapUser(user);
    return this.bootstrapAdmin(user);
  }

  private isUser(user: UserJwtPayload | JwtPayload): user is UserJwtPayload {
    return (user as UserJwtPayload).kind === 'USER';
  }

  private async bootstrapUser(user: UserJwtPayload): Promise<MiniBootstrap> {
    const account = await this.prisma.user.findUnique({ where: { id: user.userId } });
    if (!account || account.status !== 'ACTIVE') {
      throw BizException.unauthorized(ReasonCode.ACCOUNT_DISABLED, '用户不存在或已停用');
    }

    const admin = await this.findMerchantAdmin(account.phone);
    // 商家主动「切到会员端」时令牌带 view='member'，这里不能再按手机号自动升级成商家，
    // 否则点了切换也会被弹回商家端。
    if (admin && user.view !== 'member') {
      return {
        ...this.merchantBody(admin, {
          name: account.nickname || admin.realName || '微信用户',
          avatar: account.avatar,
        }),
        switchable: true,
      };
    }

    return {
      role: 'member',
      profile: {
        name: account.nickname || '微信用户',
        avatar: account.avatar,
        phone: account.phone,
      },
      merchant: null,
      tabs: MEMBER_TABS,
      switchable: !!admin,
    };
  }

  private async bootstrapAdmin(user: JwtPayload): Promise<MiniBootstrap> {
    const admin = await this.prisma.adminUser.findUnique({
      where: { id: user.sub },
      include: { merchant: { select: { id: true, name: true, status: true } } },
    });
    if (!admin || admin.status !== 'ACTIVE') {
      throw BizException.unauthorized(ReasonCode.ACCOUNT_DISABLED, '账号不存在或已停用');
    }
    if (admin.merchantId && admin.merchant?.status === 'APPROVED') {
      return {
        ...this.merchantBody(admin, {
          name: admin.realName || admin.username,
          avatar: null,
        }),
        switchable: true,
      };
    }

    return {
      role: 'member',
      profile: {
        name: admin.realName || admin.username,
        avatar: null,
        phone: admin.phone,
      },
      merchant: null,
      tabs: MEMBER_TABS,
      switchable: false,
    };
  }

  /** 手机号与后台账号一致、且后台账号挂了已通过商家时，C 端用户按商家进入。 */
  private findMerchantAdmin(phone: string | null | undefined) {
    if (!phone || phone.startsWith('wx_')) return Promise.resolve(null);
    return this.prisma.adminUser.findFirst({
      where: {
        phone,
        status: 'ACTIVE',
        merchantId: { not: null },
        merchant: { status: 'APPROVED' },
      },
      include: { merchant: { select: { id: true, name: true, status: true } } },
    });
  }

  async workbench(user: UserJwtPayload | JwtPayload) {
    const actor = await this.requireMerchant(user);
    const { start, end } = this.dayRange(0);
    const whereMerchant = actor.merchantIds ? { merchantId: { in: actor.merchantIds } } : {};
    const whereStore = actor.storeId ? { storeId: actor.storeId } : {};
    const [redemptions, pointAgg] = await Promise.all([
      this.prisma.redemptionRecord.count({
        where: { status: 'SUCCESS', redeemedAt: { gte: start, lt: end }, ...whereMerchant, ...whereStore },
      }),
      this.prisma.pointTransaction.aggregate({
        where: { type: 'EARN', createdAt: { gte: start, lt: end }, ...whereMerchant, ...whereStore },
        _sum: { amount: true },
      }),
    ]);
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: actor.merchantId },
      select: { type: true },
    });
    return {
      greeting: this.greeting(),
      bossName: this.bossName(actor.displayName),
      storeName: actor.placeName,
      storeId: actor.defaultStoreId,
      merchantId: actor.merchantId,
      merchantName: actor.merchantName,
      merchantType: merchant?.type === 'MAIN' ? 'MAIN' : 'SUB',
      today: {
        redemptions,
        pointsIssued: Math.abs(Number(pointAgg._sum.amount ?? 0)),
      },
    };
  }

  /**
   * 扫会员码后的收银台：
   * - 会员脱敏信息
   * - 该会员在本联盟/本店可用的未使用券
   * - 本店可积分兑换的已上架券模板（无券也能当场兑）
   * - 会员可用积分
   */
  /**
   * 会员码票据：5 分钟有效的短 JWT。
   * 载荷只有 { sub, typ: 'mqr' }，不带 kind，因此任何守卫都不会把它当成登录令牌；
   * 它唯一用途是让店员扫 member-desk 时反查 userId。
   */
  async issueMemberQr(user: UserJwtPayload | JwtPayload): Promise<{ ticket: string; expiresAt: string }> {
    if (!this.isUser(user)) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '仅会员可以出示会员码');
    }
    const ticket = await this.jwt.signAsync(
      { sub: user.userId, typ: 'mqr' },
      { expiresIn: MEMBER_QR_TTL_SECONDS },
    );
    return {
      ticket,
      expiresAt: new Date(Date.now() + MEMBER_QR_TTL_SECONDS * 1000).toISOString(),
    };
  }

  private async resolveTicketUserId(ticket: string): Promise<number> {
    let payload: { sub?: number; typ?: string };
    try {
      payload = await this.jwt.verifyAsync<{ sub?: number; typ?: string }>(ticket);
    } catch {
      throw BizException.unauthorized(
        ReasonCode.MEMBER_QR_EXPIRED,
        '会员码已过期或无效，请让对方刷新后再扫',
      );
    }
    if (payload?.typ !== 'mqr' || !Number.isInteger(payload.sub)) {
      throw BizException.unauthorized(
        ReasonCode.MEMBER_QR_EXPIRED,
        '会员码无效，请让对方刷新后再扫',
      );
    }
    return payload.sub as number;
  }

  async memberDesk(
    user: UserJwtPayload | JwtPayload,
    target: { userId?: number; ticket?: string },
  ) {
    const actor = await this.requireMerchant(user);
    const userId = target.ticket ? await this.resolveTicketUserId(target.ticket) : target.userId;
    if (!userId || !Number.isInteger(userId)) {
      throw BizException.badRequest('MEMBER_TARGET_REQUIRED', '缺少会员标识，请重新扫码');
    }
    const targetUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, nickname: true, phone: true, status: true },
    });
    if (!targetUser || targetUser.status !== 'ACTIVE') {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '会员不存在或已停用');
    }
    const phone = targetUser.phone || '';
    const maskedPhone =
      phone.length >= 7 && !phone.startsWith('wx_')
        ? `${phone.slice(0, 3)}****${phone.slice(-4)}`
        : phone.startsWith('wx_')
          ? '微信用户'
          : phone || '未绑定手机';
    const name =
      targetUser.nickname && !targetUser.nickname.startsWith('wx_')
        ? targetUser.nickname
        : maskedPhone === '微信用户'
          ? '微信会员'
          : `${maskedPhone.slice(0, 1)}**`;

    const self = await this.prisma.merchant.findUnique({
      where: { id: actor.merchantId },
      select: { id: true, type: true, parentId: true },
    });
    const mainId = self?.type === 'MAIN' ? self.id : self?.parentId ?? null;
    const merchantIds = actor.merchantIds || [actor.merchantId];
    const now = new Date();

    const [coupons, templates, pointRows] = await Promise.all([
      this.prisma.couponInstance.findMany({
        where: {
          userId,
          status: 'UNUSED',
          expireAt: { gt: now },
          template: {
            OR: [
              { ownerMerchantId: { in: merchantIds } },
              ...(mainId
                ? [{ ownerType: 'MAIN_COUPON' as const, ownerMerchantId: mainId }]
                : []),
            ],
          },
        },
        select: {
          id: true,
          code: true,
          expireAt: true,
          template: {
            select: {
              id: true,
              name: true,
              faceValue: true,
              thresholdAmount: true,
              pointsCost: true,
            },
          },
        },
        orderBy: { expireAt: 'asc' },
        take: 50,
      }),
      this.prisma.couponTemplate.findMany({
        where: {
          status: 'PUBLISHED',
          pointsCost: { gt: 0 },
          OR: [
            { ownerMerchantId: { in: merchantIds } },
            { creatorMerchantId: actor.merchantId },
            ...(mainId ? [{ ownerType: 'MAIN_COUPON' as const, ownerMerchantId: mainId }] : []),
          ],
        },
        select: {
          id: true,
          name: true,
          faceValue: true,
          thresholdAmount: true,
          pointsCost: true,
          totalStock: true,
          issuedCount: true,
        },
        orderBy: { id: 'asc' },
        take: 40,
      }),
      this.prisma.pointTransaction.findMany({
        where: {
          userId,
          remainingAmount: { gt: 0 },
          OR: [{ expireAt: null }, { expireAt: { gt: now } }],
        },
        select: { remainingAmount: true },
      }),
    ]);

    const pointsAvailable = pointRows.reduce((sum, row) => sum + row.remainingAmount, 0);

    return {
      member: { userId: targetUser.id, name, phone: maskedPhone },
      storeId: actor.defaultStoreId,
      storeName: actor.placeName,
      merchantId: actor.merchantId,
      pointsAvailable,
      coupons: coupons.map((row) => ({
        id: row.id,
        code: row.code,
        expireAt: row.expireAt,
        templateId: row.template.id,
        name: row.template.name,
        faceValue: Number(row.template.faceValue),
        thresholdAmount: Number(row.template.thresholdAmount),
      })),
      exchangeTemplates: templates.map((row) => ({
        id: row.id,
        name: row.name,
        faceValue: Number(row.faceValue),
        thresholdAmount: Number(row.thresholdAmount),
        pointsCost: row.pointsCost,
        remainingStock: Math.max(row.totalStock - row.issuedCount, 0),
      })),
    };
  }

  /** 发券页：联盟商家列表 + 主体/附属身份（附属只能发主体券） */
  async issueOptions(user: UserJwtPayload | JwtPayload) {
    const actor = await this.requireMerchant(user);
    const self = await this.prisma.merchant.findUnique({
      where: { id: actor.merchantId },
      select: { id: true, name: true, type: true },
    });
    if (!self) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '当前账号不是商家');
    }
    const isMain = self.type === 'MAIN';
    let merchants: Array<{ id: number; name: string; role: 'MAIN' | 'SUB' }> = [
      { id: self.id, name: self.name, role: isMain ? 'MAIN' : 'SUB' },
    ];
    if (isMain) {
      const children = await this.prisma.merchant.findMany({
        where: { parentId: self.id, status: 'APPROVED' },
        select: { id: true, name: true },
        orderBy: { id: 'asc' },
      });
      merchants = [
        { id: self.id, name: self.name, role: 'MAIN' },
        ...children.map((row) => ({ id: row.id, name: row.name, role: 'SUB' as const })),
      ];
    }
    const perms = new Set(('permissions' in user && user.permissions) || []);
    const hasIssuePerm =
      perms.has('coupon:issue-main') ||
      perms.has('coupon:issue') ||
      perms.has('coupon:create');
    let canQuickCreate = false;
    if (hasIssuePerm && isMain) {
      canQuickCreate = true;
    } else if (hasIssuePerm && !isMain) {
      const auth = await this.prisma.merchantAuthorization.findFirst({
        where: { subMerchantId: self.id, status: 'ENABLED', authType: 'ISSUE_MAIN_COUPON' },
        select: { id: true },
      });
      canQuickCreate = !!auth;
    }

    return {
      merchantType: isMain ? ('MAIN' as const) : ('SUB' as const),
      merchantId: self.id,
      merchantName: self.name,
      onlyMainCoupons: !isMain,
      /** 主体/已授权附属且具备发券权限码时可快速建券 */
      canQuickCreate,
      merchants,
    };
  }

  /**
   * 小Z 还没有可调用的财务诊断接口。
   * 这里用商盟近 30 天订单实收和核销让利算出健康分：
   * 现金支撑月数 = 实收 / 让利（没有让利时不估算）。
   * 近 30 天没有订单则 has_data=false。
   */
  async financeCheckup(user: UserJwtPayload | JwtPayload) {
    const actor = await this.requireMerchant(user);
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const whereMerchant = actor.merchantIds ? { merchantId: { in: actor.merchantIds } } : {};
    const whereStore = actor.storeId ? { storeId: actor.storeId } : {};
    const [orders, redemptions] = await Promise.all([
      this.prisma.order.aggregate({
        where: { status: 'NORMAL', consumeTime: { gte: since }, ...whereMerchant, ...whereStore },
        _sum: { payAmount: true },
        _count: { _all: true },
      }),
      this.prisma.redemptionRecord.aggregate({
        where: { status: 'SUCCESS', redeemedAt: { gte: since }, ...whereMerchant, ...whereStore },
        _sum: { discountAmount: true },
        _count: { _all: true },
      }),
    ]);
    const pay = Number(orders._sum.payAmount ?? 0);
    const orderCount = orders._count._all;
    if (orderCount <= 0 && pay <= 0) {
      return { bound: false, has_data: false, score: null, cash_months: null };
    }
    const discount = Number(redemptions._sum.discountAmount ?? 0);
    const volume = Math.min(pay / 1000, 1) * 40;
    const frequency = Math.min(orderCount / 10, 1) * 30;
    const margin = discount <= 0 ? 30 : Math.max(0, Math.min(1, (pay - discount) / Math.max(pay, 1))) * 30;
    const score = Math.max(0, Math.min(100, Math.round(volume + frequency + margin)));
    const cashMonths = discount > 0 ? Math.round((pay / discount) * 10) / 10 : null;
    return { bound: true, has_data: true, score, cash_months: cashMonths };
  }

  /** 主体：自己在中心，附属绕行。附属/店员：本店在中心，本月到店客人绕行。 */
  async merchantGalaxy(user: UserJwtPayload | JwtPayload) {
    const actor = await this.requireMerchant(user);
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: actor.merchantId },
      select: { id: true, name: true, type: true },
    });
    if (!merchant) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '当前账号不是商家');
    }
    if (merchant.type === 'MAIN') return this.mainGalaxy(merchant.id, merchant.name);
    return this.guestGalaxy(actor.merchantId, actor.storeId, actor.placeName);
  }

  /** 会员侧：去过的门店优先，其余营业中的附属门店作为可到店。 */
  async memberPlaces(user: UserJwtPayload | JwtPayload) {
    if (!this.isUser(user)) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '请用会员身份查看附近商家');
    }
    const visits = await this.prisma.order.groupBy({
      by: ['merchantId'],
      where: { userId: user.userId, status: 'NORMAL', orderType: 'CONSUME' },
      _max: { consumeTime: true },
    });
    const visited = new Set(visits.map((row) => row.merchantId));
    const stores = await this.prisma.store.findMany({
      where: { status: 'OPEN', merchant: { status: 'APPROVED' } },
      select: {
        id: true,
        name: true,
        address: true,
        district: true,
        businessHours: true,
        merchantId: true,
        merchant: { select: { name: true, parentId: true, type: true } },
      },
      orderBy: { id: 'asc' },
      take: 24,
    });
    const places = stores
      .map((store) => ({
        storeId: store.id,
        merchantId: store.merchantId,
        name: store.name,
        merchantName: store.merchant.name,
        address: [store.district, store.address].filter(Boolean).join(' '),
        hours: store.businessHours || '',
        visited: visited.has(store.merchantId),
      }))
      .sort((a, b) => Number(b.visited) - Number(a.visited));
    return { places };
  }

  /**
   * 会员侧：列出可用商家联盟，以及每个联盟里有哪些商家（主体 + 已通过附属）。
   * 暂无定位时按已审核主体联盟全量返回，便于 C 端看清「联盟有几家、分别是谁」。
   */
  async memberAlliances(user: UserJwtPayload | JwtPayload) {
    if (!this.isUser(user)) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '请用会员身份查看联盟');
    }
    type MerchantLite = {
      id: number;
      name: string;
      city?: string | null;
      district?: string | null;
      address?: string | null;
    };

    // 入口以「联盟」为准，而不是 merchants.type。
    // 主体身份是按联盟定的：城南旗舰店在联盟1 是附属、在「城南商圈」是主体，
    // 用 type='MAIN' 当筛子会让它自己的联盟整个不出现。
    const headRows = await this.prisma.alliance.findMany({
      where: { mainMerchant: { status: 'APPROVED' } },
      select: {
        id: true,
        name: true,
        mainMerchantId: true,
        mainMerchant: {
          select: { id: true, name: true, city: true, district: true, address: true },
        },
      },
      orderBy: { id: 'asc' },
      take: 20,
    });

    // 同一主体理论上只挂一个联盟，去重防止 chip 出现重复项
    const mainSeen = new Set<number>();
    const heads = headRows.filter((row) => {
      if (mainSeen.has(row.mainMerchantId)) return false;
      mainSeen.add(row.mainMerchantId);
      return true;
    });

    // 老库还没有联盟表数据时，退回按 type='MAIN' 的商家列，避免整页空白
    type AllianceHead = MerchantLite & {
      /** 联盟名：chip 与区块标题用 */
      label: string;
      /** 主体商家名：商家卡片用（联盟名和商家名常常不同，城南商圈 → 城南旗舰店） */
      merchantName: string;
    };
    const mains: AllianceHead[] = heads.length
      ? heads.map((row) => ({
          id: row.mainMerchantId,
          name: row.mainMerchant.name,
          merchantName: row.mainMerchant.name,
          label: row.name || row.mainMerchant.name,
          city: row.mainMerchant.city,
          district: row.mainMerchant.district,
          address: row.mainMerchant.address,
        }))
      : (
          await this.prisma.merchant.findMany({
            where: { type: 'MAIN', status: 'APPROVED' },
            select: { id: true, name: true, city: true, district: true, address: true },
            orderBy: { id: 'asc' },
            take: 20,
          })
        ).map((row) => ({ ...row, label: row.name, merchantName: row.name }));
    if (!mains.length) return { alliances: [], total: 0 };

    // 会员在每家商家「攒了多少分 / 还剩多少分」，一次聚合拿到，拼进商家卡片。
    // 按发分商家（point_transactions.merchantId）归集，不看门店：顾客记住的是店招牌。
    const pointRows = await this.prisma.$queryRaw<
      Array<{ merchantId: number | bigint | null; remain: number | bigint | null; earned: number | bigint | null }>
    >`
      SELECT pt.merchantId AS merchantId,
             SUM(CASE WHEN pt.remainingAmount > 0
                       AND (pt.expireAt IS NULL OR pt.expireAt > NOW(3))
                      THEN pt.remainingAmount ELSE 0 END) AS remain,
             SUM(CASE WHEN pt.type = 'EARN' THEN pt.amount ELSE 0 END) AS earned
      FROM point_transactions pt
      WHERE pt.userId = ${user.userId}
        AND pt.type IN ('EARN', 'ADJUST', 'REFUND')
      GROUP BY pt.merchantId`;
    // $queryRaw 的 SUM 走的是 BIGINT，必须转 Number 才能和 merchantId 一起用
    const pointsOf = new Map<number, { remain: number; earned: number }>();
    for (const row of pointRows) {
      if (row.merchantId == null) continue;
      pointsOf.set(Number(row.merchantId), {
        remain: Number(row.remain ?? 0),
        earned: Number(row.earned ?? 0),
      });
    }

    const mainIds = mains.map((row) => row.id);

    // 联盟成员有两个来源，取并集：
    // 1) merchant_alliances —— 多联盟模型（一家店可同时挂在几个联盟下，积分通兑按这个算）
    // 2) merchants.parentId —— 历史层级（早期入驻只记父子关系，没有联盟成员表）
    // 只认 1) 会漏掉老数据，只认 2) 会漏掉「一家店挂两个联盟」。
    const allianceRows = heads.map((row) => ({ id: row.id, mainMerchantId: row.mainMerchantId }));
    const parentSubs = await this.prisma.merchant.findMany({
      where: { parentId: { in: mainIds }, status: 'APPROVED' },
      select: {
        id: true,
        name: true,
        parentId: true,
        city: true,
        district: true,
        address: true,
      },
      orderBy: { id: 'asc' },
    });

    const members = allianceRows.length
      ? await this.prisma.merchantAlliance.findMany({
          where: { allianceId: { in: allianceRows.map((row) => row.id) } },
          select: { allianceId: true, merchantId: true },
        })
      : [];

    const mainOfAlliance = new Map(allianceRows.map((row) => [row.id, row.mainMerchantId]));
    const childIdsOf = new Map<number, Set<number>>();
    const addChild = (mainId: number, merchantId: number) => {
      if (merchantId === mainId) return; // 主体自己不算附属
      const bucket = childIdsOf.get(mainId) ?? new Set<number>();
      bucket.add(merchantId);
      childIdsOf.set(mainId, bucket);
    };
    for (const row of parentSubs) {
      if (row.parentId) addChild(row.parentId, row.id);
    }
    for (const row of members) {
      const mainId = mainOfAlliance.get(row.allianceId);
      if (mainId != null) addChild(mainId, row.merchantId);
    }

    const known = new Map<number, MerchantLite>();
    mains.forEach((row) => known.set(row.id, row));
    parentSubs.forEach((row) => known.set(row.id, row));

    // 只通过联盟挂进来的商家（不在任何 parentId 层级里）要单独补查一次档案
    const missingIds = [...new Set([...childIdsOf.values()].flatMap((set) => [...set]))].filter(
      (id) => !known.has(id),
    );
    if (missingIds.length) {
      const extra = await this.prisma.merchant.findMany({
        where: { id: { in: missingIds }, status: 'APPROVED' },
        select: { id: true, name: true, city: true, district: true, address: true },
      });
      extra.forEach((row) => known.set(row.id, row));
    }

    const allMerchantIds = [...known.keys()];
    const stores = allMerchantIds.length
      ? await this.prisma.store.findMany({
          where: { status: 'OPEN', merchantId: { in: allMerchantIds } },
          select: {
            id: true,
            name: true,
            merchantId: true,
            district: true,
            address: true,
            businessHours: true,
          },
          orderBy: { id: 'asc' },
        })
      : [];

    const storesOf = new Map<number, typeof stores>();
    stores.forEach((store) => {
      const bucket = storesOf.get(store.merchantId) || [];
      bucket.push(store);
      storesOf.set(store.merchantId, bucket);
    });

    const toPlace = (merchant: MerchantLite, role: 'MAIN' | 'SUB') => {
      const shopList = storesOf.get(merchant.id) || [];
      const primary = shopList[0];
      const address =
        (primary
          ? [primary.district, primary.address].filter(Boolean).join(' ')
          : [merchant.city, merchant.district, merchant.address].filter(Boolean).join(' ')) || '';
      const mine = pointsOf.get(merchant.id);
      return {
        id: merchant.id,
        name: merchant.name,
        role,
        storeId: primary?.id ?? null,
        storeName: primary?.name || '',
        address,
        hours: primary?.businessHours || '',
        storeCount: shopList.length,
        /** 我在这家店还剩多少可用积分 */
        myPoints: mine?.remain ?? 0,
        /** 我在这家店累计攒到多少积分（含已花掉/已过期，用来体现「常来」） */
        myEarned: mine?.earned ?? 0,
      };
    };

    const alliances = mains.map((main) => {
      const children = [...(childIdsOf.get(main.id) ?? new Set<number>())]
        .map((id) => known.get(id))
        .filter((row): row is MerchantLite => !!row)
        .sort((a, b) => a.id - b.id);
      const merchants = [
        // 主体卡片报商家名，不报联盟名，否则「城南商圈」会冒充成一家店
        toPlace({ ...main, name: main.merchantName }, 'MAIN'),
        ...children.map((row) => toPlace(row, 'SUB')),
      ];
      return {
        id: main.id,
        /** 联盟名（不是商家名），对应 alliances.name */
        name: main.label,
        city: main.city || '',
        merchantCount: merchants.length,
        merchants,
      };
    });

    return {
      total: alliances.length,
      alliances,
    };
  }

  /** 会员看到的是联盟：主体在中心，已通过的附属绕行，并带上可到店的门店。 */
  async publicGalaxy(user: UserJwtPayload | JwtPayload, merchantId: number) {
    if (!this.isUser(user)) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '请用会员身份查看星系');
    }
    const target = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true, type: true, parentId: true, status: true },
    });
    if (!target || target.status !== 'APPROVED') {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '这家商家还不能查看');
    }
    const mainId = target.type === 'MAIN' ? target.id : target.parentId;
    if (!mainId) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '这家商家还没有加入联盟');
    }
    const main = await this.prisma.merchant.findUnique({
      where: { id: mainId },
      select: { id: true, name: true, status: true },
    });
    if (!main || main.status !== 'APPROVED') {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '联盟主体还不可用');
    }
    const subs = await this.prisma.merchant.findMany({
      where: { parentId: main.id, status: 'APPROVED' },
      select: { id: true, name: true, status: true },
      orderBy: { id: 'asc' },
    });
    const ids = [main.id, ...subs.map((row) => row.id)];
    const agg = await this.monthAgg(ids);
    const stores = await this.prisma.store.findMany({
      where: { merchantId: { in: subs.length ? subs.map((row) => row.id) : [main.id] }, status: 'OPEN' },
      select: { id: true, merchantId: true, name: true, address: true, district: true, businessHours: true },
      orderBy: { id: 'asc' },
    });
    const storeOf = new Map<number, (typeof stores)[number]>();
    stores.forEach((store) => {
      if (!storeOf.has(store.merchantId)) storeOf.set(store.merchantId, store);
    });
    const planets = subs
      .map((row) => {
        const stat = agg.get(row.id);
        const store = storeOf.get(row.id);
        return {
          id: row.id,
          name: row.name,
          status: row.status,
          monthAmount: stat?.amount ?? 0,
          orderCount: stat?.count ?? 0,
          storeId: store?.id ?? null,
          storeName: store?.name ?? '',
          address: store ? [store.district, store.address].filter(Boolean).join(' ') : '',
          hours: store?.businessHours || '',
        };
      })
      .sort((a, b) => b.monthAmount - a.monthAmount)
      .slice(0, 40);
    return {
      mode: 'MAIN' as const,
      focusId: target.type === 'MAIN' ? planets[0]?.id ?? main.id : target.id,
      center: {
        id: main.id,
        name: main.name,
        monthAmount: ids.reduce((sum, id) => sum + (agg.get(id)?.amount ?? 0), 0),
        monthOrderCount: ids.reduce((sum, id) => sum + (agg.get(id)?.count ?? 0), 0),
        planetCount: subs.length,
      },
      planets,
    };
  }

  private async mainGalaxy(merchantId: number, name: string) {
    const subs = await this.prisma.merchant.findMany({
      where: { parentId: merchantId },
      select: { id: true, name: true, status: true },
      orderBy: { id: 'asc' },
    });
    const ids = [merchantId, ...subs.map((row) => row.id)];
    const agg = await this.monthAgg(ids);
    const planets = subs
      .map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        kind: 'merchant' as const,
        monthAmount: agg.get(row.id)?.amount ?? 0,
        orderCount: agg.get(row.id)?.count ?? 0,
      }))
      .sort((a, b) => b.monthAmount - a.monthAmount)
      .slice(0, 8);
    return {
      mode: 'MAIN' as const,
      center: {
        id: merchantId,
        name,
        monthAmount: ids.reduce((sum, id) => sum + (agg.get(id)?.amount ?? 0), 0),
        monthOrderCount: ids.reduce((sum, id) => sum + (agg.get(id)?.count ?? 0), 0),
        planetCount: subs.length,
      },
      planets,
    };
  }

  private async guestGalaxy(merchantId: number, storeId: number | null, placeName: string) {
    const monthStart = this.monthStart();
    const rows = await this.prisma.order.groupBy({
      by: ['userId'],
      where: {
        merchantId,
        status: 'NORMAL',
        orderType: 'CONSUME',
        consumeTime: { gte: monthStart },
        ...(storeId ? { storeId } : {}),
      },
      _sum: { payAmount: true },
      _count: { _all: true },
      orderBy: { _sum: { payAmount: 'desc' } },
      take: 8,
    });
    const users = rows.length
      ? await this.prisma.user.findMany({
          where: { id: { in: rows.map((row) => row.userId) } },
          select: { id: true, phone: true, nickname: true },
        })
      : [];
    const named = new Map(users.map((row) => [row.id, row]));
    const orderCount = rows.reduce((sum, row) => sum + row._count._all, 0);
    const monthAmount = rows.reduce((sum, row) => sum + Number(row._sum.payAmount ?? 0), 0);
    return {
      mode: 'SUB' as const,
      center: {
        id: merchantId,
        name: placeName,
        monthAmount,
        monthOrderCount: orderCount,
        planetCount: rows.length,
      },
      planets: rows.map((row) => {
        const person = named.get(row.userId);
        return {
          id: row.userId,
          name: this.maskGuest(person?.nickname, person?.phone),
          status: 'GUEST',
          kind: 'guest' as const,
          monthAmount: Number(row._sum.payAmount ?? 0),
          orderCount: row._count._all,
        };
      }),
    };
  }

  private monthStart() {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }

  private async monthAgg(merchantIds: number[]) {
    if (!merchantIds.length) return new Map<number, { amount: number; count: number }>();
    const rows = await this.prisma.order.groupBy({
      by: ['merchantId'],
      where: {
        consumeTime: { gte: this.monthStart() },
        status: 'NORMAL',
        merchantId: { in: merchantIds },
      },
      _sum: { payAmount: true },
      _count: { _all: true },
    });
    return new Map(rows.map((row) => [row.merchantId, { amount: Number(row._sum.payAmount ?? 0), count: row._count._all }]));
  }

  private maskGuest(nickname: string | null | undefined, phone: string | null | undefined) {
    if (nickname && !nickname.startsWith('wx_')) return nickname;
    if (!phone || phone.startsWith('wx_')) return '微信客人';
    return phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2');
  }

  private async requireMerchant(user: UserJwtPayload | JwtPayload) {
    const admin = this.isUser(user)
      ? await this.findMerchantAdmin((await this.prisma.user.findUnique({ where: { id: user.userId }, select: { phone: true } }))?.phone)
      : await this.prisma.adminUser.findUnique({
          where: { id: user.sub },
          include: { merchant: { select: { id: true, name: true, status: true, type: true } } },
        });
    if (!admin?.merchantId || !admin.merchant || admin.merchant.status !== 'APPROVED') {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '当前账号不是商家');
    }
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: admin.merchantId },
      select: { id: true, name: true, type: true },
    });
    let merchantIds: number[] | null = [admin.merchantId];
    if (merchant?.type === 'MAIN') {
      const children = await this.prisma.merchant.findMany({
        where: { parentId: admin.merchantId },
        select: { id: true },
      });
      merchantIds = [admin.merchantId, ...children.map((row) => row.id)];
    }
    const storeId = admin.storeId;
    const place = storeId
      ? await this.prisma.store.findUnique({ where: { id: storeId }, select: { id: true, name: true } })
      : null;
    const fallbackStore = place
      ? place
      : await this.prisma.store.findFirst({
          where: { merchantId: { in: merchantIds }, status: 'OPEN' },
          orderBy: { id: 'asc' },
          select: { id: true, name: true },
        });
    return {
      displayName: admin.realName || admin.username,
      merchantId: admin.merchantId,
      merchantName: merchant?.name || admin.merchant.name,
      merchantIds: storeId ? [admin.merchantId] : merchantIds,
      storeId,
      placeName: place?.name || merchant?.name || '当前商家',
      defaultStoreId: place?.id ?? fallbackStore?.id ?? null,
    };
  }

  private greeting() {
    const hour = Number(
      new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Asia/Shanghai' }).format(new Date()),
    );
    if (hour < 11) return '早上好';
    if (hour < 14) return '中午好';
    if (hour < 18) return '下午好';
    return '晚上好';
  }

  private bossName(name: string) {
    const surname = name.trim().charAt(0);
    return surname ? `${surname}老板` : '老板';
  }

  private dayRange(offset: number) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Shanghai',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date());
    const pick = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    const start = new Date(Date.UTC(pick('year'), pick('month') - 1, pick('day') + offset, -8, 0, 0, 0));
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
  }

  private merchantBody(
    admin: { merchantId: number | null; storeId: number | null; merchant: { id: number; name: string } | null },
    profile: MiniProfile,
  ): MiniBootstrap {
    return {
      role: 'merchant',
      profile,
      merchant: {
        id: admin.merchant?.id ?? admin.merchantId ?? 0,
        name: admin.merchant?.name ?? '',
        storeId: admin.storeId,
      },
      tabs: MERCHANT_TABS,
    };
  }
}
