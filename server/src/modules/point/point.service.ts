import { Injectable, Logger } from '@nestjs/common';
import {
  AllianceRole,
  CouponOwnerType,
  CouponSource,
  CouponTemplateStatus,
  ExpireMode,
  MerchantType,
  OrderSource,
  OrderStatus,
  OrderType,
  PointTxnType,
  Prisma,
} from '@prisma/client';

/** 历史数据默认挂靠的星链商盟；新用户开户兜底 */
const DEFAULT_ALLIANCE_ID = 1;
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import { SubscriptionService } from '../subscription/subscription.service';
import {
  AdjustPointsDto,
  EarnPointsDto,
  ExchangePointsDto,
  QueryExchangeOptionsDto,
  QueryExchangeRecordsDto,
  QueryPointAccountsDto,
  QueryPointTransactionsDto,
  UpdatePointRuleDto,
} from './dto/point.dto';

/** 审计动作名 */
const ACTION = {
  earn: 'point:earn',
  adjust: 'point:adjust',
  exchange: 'point:exchange',
  ruleUpdate: 'point:rule:update',
  expire: 'POINTS_EXPIRE',
} as const;

/** 乐观锁重试上限：3 次都撞不上就报冲突，绝不无限重试把请求挂死 */
const MAX_RETRY = 3;

/** 临期判定窗口（天）：账户详情里「即将过期」的口径 */
const EXPIRING_SOON_DAYS = 30;

/**
 * 内部信号：账户版本被别人抢先改了，需要**整事务重跑**。
 * 刻意不继承 BizException——它不该被异常过滤器翻译成 HTTP 响应，只在重试循环里被识别。
 */
export class ConcurrentSignal extends Error {
  constructor() {
    super('CONCURRENT_ACCOUNT_UPDATE');
  }
}

/** FIFO 扣减结果：每一笔从哪个批次扣了多少，S3.2 兑换与 S3.4 退款回退都要用它 */
export interface FifoDeduction {
  txnId: number;
  amount: number;
  expireAt: Date | null;
  sourceRole?: AllianceRole | null;
}

/** 兑换扣减策略：附属券只吃 MAIN；主体券优先吃 SUB 再吃 MAIN */
type ExchangeConsumePolicy = 'MAIN_ONLY' | 'SUB_FIRST';

/** S3.3：积分过期清零（手动触发 / 定时任务共用）的入参 */
export interface PointsExpireOptions {
  operatorId?: number | null;
  operatorType?: string | null;
  ip?: string | null;
  userAgent?: string | null;
  triggeredBy?: 'manual' | 'cron';
}

/** S3.3：积分过期清零结果 */
export interface PointsExpireResult {
  processed: number;
  expiredAmount: number;
  startedAt: Date;
  finishedAt: Date;
  skipped: boolean;
  message?: string;
}

/**
 * 积分账户 / 积分流水 / 消费录单送积分 / 人工调整（S3.1）
 *
 * ## 为什么积分账户要用乐观锁
 *
 * 积分是**金额类资产**：并发写冲突一旦处理错，就是「用户白得一笔」或「用户积分凭空消失」，
 * 比券的超发更难在事后对账（券有券码可追溯，积分只有数字）。所以：
 *
 * 1. **账户更新走版本号**：`UPDATE point_accounts SET ... WHERE userId=? AND version=?`，
 *    影响行数 0 说明有人抢先改了 → **整事务重跑**（最多 3 次），超过 → 409 `CONCURRENT_UPDATE`。
 *    刻意不用 `SELECT ... FOR UPDATE`：积分写入是多批次 + 账户多字段，行锁会拉长事务；
 *    乐观锁在「冲突不频繁」的真实场景下更快，且冲突是可观测的（重试次数 / 409 数量）。
 * 2. **批次扣减走条件更新**：`UPDATE point_transactions SET remainingAmount = remainingAmount - N
 *    WHERE id=? AND remainingAmount >= N`，影响行数 0 → 409 `BALANCE_NOT_ENOUGH`。
 *    这一步与账户更新在同一个事务里，不会出现「批次扣了、账户没扣」。
 * 3. **同一订单只送一次积分**：唯一索引 `(relatedOrderId, type)` 兜底，
 *    并发重复录单时其中一个请求撞 P2002 → 409 `ORDER_POINTS_ALREADY_EARNED` 且整事务回滚。
 *
 * ## FIFO 的口径
 *
 * 消耗按 `expireAt` 升序，先吃掉最快过期的批次（用户视角最公平，也减少平台负债）。
 * **过期批次不可用**：`expireAt <= now` 的批次即便 remainingAmount>0 也不参与扣减——
 * 这是 S3.2 那句「余额看着够、但能花的不够」的根源，错误码统一 `BALANCE_NOT_ENOUGH`。
 */
@Injectable()
export class PointService {
  private readonly logger = new Logger('Point');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly subs: SubscriptionService,
  ) {}

  // ---------------------------------------------------------------- 账户查询

  /** 积分账户列表：平台全量；商家 / 店员只看「在自己体系内产生过积分流水」的用户 */
  async listAccounts(query: QueryPointAccountsDto, user: JwtPayload) {
    const scope = await this.scopeFilter(user);
    // 账户表本身没有商家字段，可见用户 = 在可见范围内产生过流水的人
    let visibleUserIds: number[] | null = null;
    if (Object.keys(scope).length > 0) {
      const rows = await this.prisma.pointTransaction.findMany({
        where: scope,
        distinct: ['userId'],
        select: { userId: true },
      });
      visibleUserIds = rows.map((r) => r.userId);
    }

    const userFilter: Prisma.UserWhereInput = query.keyword
      ? { OR: [{ nickname: { contains: query.keyword } }, { phone: { contains: query.keyword } }] }
      : {};

    const where: Prisma.PointAccountWhereInput = {
      ...(visibleUserIds ? { userId: { in: visibleUserIds } } : {}),
      ...(query.minBalance !== undefined ? { balance: { gte: query.minBalance } } : {}),
      ...(query.keyword ? { user: userFilter } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.pointAccount.findMany({
        where,
        orderBy: [{ balance: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { user: { select: { id: true, nickname: true, phone: true, status: true } } },
      }),
      this.prisma.pointAccount.count({ where }),
    ]);

    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 3600 * 1000);
    // 临期积分（30 天内过期且未消耗完的批次）——列表页要能筛出「该提醒用户了」的人
    const expiring = await this.prisma.pointTransaction.groupBy({
      by: ['userId'],
      where: {
        userId: { in: rows.map((r) => r.userId) },
        remainingAmount: { gt: 0 },
        expireAt: { gt: now, lte: soon },
      },
      _sum: { remainingAmount: true },
    });
    const expiringMap = new Map(expiring.map((e) => [e.userId, e._sum.remainingAmount ?? 0]));

    let list = rows.map((r) => ({
      id: r.id,
      userId: r.userId,
      userName: r.user?.nickname ?? null,
      userPhone: r.user?.phone ?? null,
      balance: r.balance,
      totalEarned: r.totalEarned,
      totalSpent: r.totalSpent,
      totalExpired: r.totalExpired,
      expiringSoon: expiringMap.get(r.userId) ?? 0,
      version: r.version,
      updatedAt: r.updatedAt,
    }));
    if (query.expiringSoon) list = list.filter((x) => x.expiringSoon > 0);

    return { list, total: query.expiringSoon ? list.length : total, page: query.page, pageSize: query.pageSize };
  }

  /**
   * 积分账户详情：余额 + **批次明细**（未过期且未用完，按 expireAt 升序 = FIFO 视角）+ 临期汇总。
   * 把批次摊开给前端看，是为了让「余额够但花不掉」这种问题一眼可解释（S3.2 的错误码来源）。
   */
  async accountDetail(userId: number, user: JwtPayload) {
    await this.assertUserVisible(userId, user);

    const allAccounts = await this.prisma.pointAccount.findMany({
      where: { userId },
      orderBy: { allianceId: 'asc' },
      include: {
        user: { select: { id: true, nickname: true, phone: true, status: true } },
        alliance: { select: { id: true, name: true } },
      },
    });
    if (!allAccounts.length) {
      throw BizException.notFound(ReasonCode.POINT_ACCOUNT_NOT_FOUND, `用户 #${userId} 还没有积分账户`);
    }

    // 兼容旧前端：主账户优先星链商盟，否则取第一个
    const account =
      allAccounts.find((a) => a.allianceId === DEFAULT_ALLIANCE_ID) ?? allAccounts[0];

    const now = new Date();
    const soon = new Date(now.getTime() + EXPIRING_SOON_DAYS * 24 * 3600 * 1000);
    const batches = await this.prisma.pointTransaction.findMany({
      where: { userId, remainingAmount: { gt: 0 } },
      orderBy: [{ expireAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        type: true,
        amount: true,
        remainingAmount: true,
        expireAt: true,
        merchantId: true,
        storeId: true,
        createdAt: true,
        remark: true,
        allianceId: true,
        sourceRole: true,
      },
    });

    const merchantIds = [...new Set(batches.map((b) => b.merchantId).filter((v): v is number => !!v))];
    const merchants = merchantIds.length
      ? await this.prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, name: true } })
      : [];
    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));

    const alive = batches.filter((b) => !b.expireAt || b.expireAt > now);
    const expired = batches.filter((b) => b.expireAt && b.expireAt <= now);
    const totalBalance = allAccounts.reduce((s, a) => s + a.balance, 0);

    // 桥店口径：发分商家同时属于多个联盟时，那几批分在每个联盟都能花。
    // 一次性把「商家 → 所属联盟」取出来，避免在账户循环里反复查库。
    const memberships = merchantIds.length
      ? await this.prisma.merchantAlliance.findMany({
          where: { merchantId: { in: merchantIds } },
          select: { merchantId: true, allianceId: true, role: true },
        })
      : [];
    const merchantAllianceMap = new Map<number, Set<number>>();
    const merchantRoleMap = new Map<number, Map<number, AllianceRole>>();
    for (const m of memberships) {
      const set = merchantAllianceMap.get(m.merchantId) ?? new Set<number>();
      set.add(m.allianceId);
      merchantAllianceMap.set(m.merchantId, set);

      const roleMap = merchantRoleMap.get(m.merchantId) ?? new Map<number, AllianceRole>();
      roleMap.set(m.allianceId, m.role);
      merchantRoleMap.set(m.merchantId, roleMap);
    }
    /** 某个联盟口径下真正可兑的积分（本联盟批次 + 桥店批次） */
    const spendableOf = (allianceIdValue: number) =>
      alive
        .filter(
          (b) =>
            b.allianceId === allianceIdValue ||
            (b.merchantId != null && merchantAllianceMap.get(b.merchantId)?.has(allianceIdValue)),
        )
        .reduce((s, b) => s + b.remainingAmount, 0);
    /** 主体发分（含历史 sourceRole 为空）→ 通用积分；附属发分 → 专属积分 */
    const roleOf = (role: AllianceRole | null | undefined) =>
      role === AllianceRole.SUB ? 'SUB' : 'MAIN';
    const sumByRole = (rows: typeof alive, role: 'MAIN' | 'SUB') =>
      rows.filter((b) => roleOf(b.sourceRole) === role).reduce((s, b) => s + b.remainingAmount, 0);
    const mainPoints = sumByRole(alive, 'MAIN');
    const subPoints = sumByRole(alive, 'SUB');
    const lastEarn = await this.prisma.pointTransaction.findFirst({
      where: { userId, type: PointTxnType.EARN },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { allianceId: true },
    });

    /**
     * 「在哪家消费就在哪家获得积分」——按发分商家把可用积分拆开。
     *
     * 角色按**商家在上下文联盟里的角色**判定（不是流水上冻结的 sourceRole），
     * 这样一家店同时挂 A/B 两个联盟、角色不同的时候，「这笔分算是主体分还是附属分」
     * 会跟着看的是哪个联盟走，不会串。
     */
    const contextAllianceId = lastEarn?.allianceId ?? account.allianceId;
    const roleAt = (
      merchantIdValue: number | null,
      allianceIdValue: number,
      fallback: AllianceRole | null | undefined,
    ): AllianceRole | null =>
      (merchantIdValue != null
        ? merchantRoleMap.get(merchantIdValue)?.get(allianceIdValue)
        : undefined) ??
      fallback ??
      null;

    const byMerchantMap = new Map<
      number,
      {
        available: number;
        expired: number;
        expiringSoon: number;
        alliances: Set<number>;
        fallbackRole: AllianceRole | null;
      }
    >();
    for (const b of batches) {
      if (b.merchantId == null) continue;
      const agg = byMerchantMap.get(b.merchantId) ?? {
        available: 0,
        expired: 0,
        expiringSoon: 0,
        alliances: new Set<number>(),
        fallbackRole: b.sourceRole ?? null,
      };
      const usable = !b.expireAt || b.expireAt > now;
      if (usable) {
        agg.available += b.remainingAmount;
        if (b.expireAt && b.expireAt <= soon) agg.expiringSoon += b.remainingAmount;
      } else {
        agg.expired += b.remainingAmount;
      }
      agg.alliances.add(b.allianceId);
      byMerchantMap.set(b.merchantId, agg);
    }
    const byMerchant = [...byMerchantMap.entries()]
      .map(([merchantIdValue, agg]) => {
        const role = roleAt(merchantIdValue, contextAllianceId, agg.fallbackRole);
        const isSub = role === AllianceRole.SUB;
        // 桥店：发分商家同时属于多个联盟时，这批分在那几个联盟都能花
        const reachable = new Set<number>([
          ...agg.alliances,
          ...(merchantAllianceMap.get(merchantIdValue) ?? []),
        ]);
        return {
          merchantId: merchantIdValue,
          merchantName: merchantMap.get(merchantIdValue) ?? `商家#${merchantIdValue}`,
          role,
          pointKind: isSub ? 'EXCLUSIVE' : 'UNIVERSAL',
          kindName: isSub ? '附属积分' : '主体积分',
          /** 主体分：主体商品 + 全部附属商品；附属分：只有主体商品 */
          exchangeScope: isSub ? '仅可兑主体商家商品' : '可兑主体商品与全部附属商品',
          available: agg.available,
          expired: agg.expired,
          expiringSoon: agg.expiringSoon,
          allianceIds: [...reachable],
        };
      })
      .sort((a, b) => b.available - a.available || a.merchantId - b.merchantId);

    return {
      account: {
        id: account.id,
        userId: account.userId,
        allianceId: account.allianceId,
        allianceName: account.alliance?.name ?? null,
        userName: account.user?.nickname ?? null,
        userPhone: account.user?.phone ?? null,
        balance: account.balance,
        totalEarned: account.totalEarned,
        totalSpent: account.totalSpent,
        totalExpired: account.totalExpired,
        version: account.version,
        updatedAt: account.updatedAt,
        /** 主账户视角的通用/专属可用积分（未过期批次） */
        mainPoints: sumByRole(
          alive.filter((b) => b.allianceId === account.allianceId),
          'MAIN',
        ),
        subPoints: sumByRole(
          alive.filter((b) => b.allianceId === account.allianceId),
          'SUB',
        ),
        main_points: sumByRole(
          alive.filter((b) => b.allianceId === account.allianceId),
          'MAIN',
        ),
        sub_points: sumByRole(
          alive.filter((b) => b.allianceId === account.allianceId),
          'SUB',
        ),
      },
      /** 按联盟分组的全部积分账户（C 端多联盟余额展示） */
      accounts: allAccounts.map((a) => {
        const poolAlive = alive.filter((b) => b.allianceId === a.allianceId);
        const main = sumByRole(poolAlive, 'MAIN');
        const sub = sumByRole(poolAlive, 'SUB');
        return {
          accountId: a.id,
          allianceId: a.allianceId,
          allianceName: a.alliance?.name ?? `联盟#${a.allianceId}`,
          balance: a.balance,
          totalEarned: a.totalEarned,
          totalSpent: a.totalSpent,
          available: poolAlive.reduce((s, b) => s + b.remainingAmount, 0),
          /** 真正可兑（含桥店批次）；商城页必须用这个，否则会误判「积分不足」 */
          spendable: spendableOf(a.allianceId),
          mainPoints: main,
          subPoints: sub,
          main_points: main,
          sub_points: sub,
        };
      }),
      /**
       * 按发分商家分组的可用积分（C 端「我的积分」页按店展示）。
       * 与 accounts（按联盟）互为两个视角，前端按需取用。
       */
      byMerchant,
      /** 最近一次获得积分的联盟，供商城 Tab 默认选中 */
      lastEarnAllianceId: lastEarn?.allianceId ?? account.allianceId,
      summary: {
        // 能花的（未过期批次剩余之和）——与 balance 的差异就是「待过期任务清理的历史批次」
        available: alive.reduce((s, b) => s + b.remainingAmount, 0),
        /** 各联盟余额合计，兼容只认单一 balance 的旧 UI */
        totalBalance,
        /** 全联盟合计：主体发分=通用积分，附属发分=专属积分 */
        mainPoints,
        subPoints,
        main_points: mainPoints,
        sub_points: subPoints,
        expiringSoon: alive
          .filter((b) => b.expireAt && b.expireAt <= soon)
          .reduce((s, b) => s + b.remainingAmount, 0),
        expiredPending: expired.reduce((s, b) => s + b.remainingAmount, 0),
        batchCount: alive.length,
      },
      batches: batches.map((b) => ({
        id: b.id,
        type: b.type,
        amount: b.amount,
        remainingAmount: b.remainingAmount,
        expireAt: b.expireAt,
        // 已过期 / 未过期：前端据此标灰
        usable: !b.expireAt || b.expireAt > now,
        allianceId: b.allianceId,
        sourceRole: b.sourceRole,
        pointKind: roleOf(b.sourceRole) === 'SUB' ? 'EXCLUSIVE' : 'UNIVERSAL',
        merchantId: b.merchantId,
        merchantName: b.merchantId ? merchantMap.get(b.merchantId) ?? null : null,
        storeId: b.storeId,
        createdAt: b.createdAt,
        remark: b.remark,
      })),
    };
  }

  // ---------------------------------------------------------------- 流水查询

  /** 积分流水：类型 / 用户 / 商家 / 门店 / 时间筛选，越权查别人 → 403 FORBIDDEN_SCOPE */
  async listTransactions(query: QueryPointTransactionsDto, user: JwtPayload) {
    const scope = await this.scopeFilter(user);
    const allowedMerchantIds = await this.visibleMerchantIds(user);
    if (query.merchantId && allowedMerchantIds && !allowedMerchantIds.includes(query.merchantId)) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权查看该商家的积分流水');
    }
    if (query.storeId && user.userType === 'STORE' && query.storeId !== user.storeId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权查看该门店的积分流水');
    }
    if (query.userId) {
      await this.assertUserVisible(query.userId, user);
    }

    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);

    // 可见范围用 AND 包一层：避免业务筛选里的 OR 与可见范围的 OR 互相覆盖（S1.4 审计踩过的坑）
    const where: Prisma.PointTransactionWhereInput = {
      AND: [
        scope,
        {
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.type ? { type: query.type } : {}),
          ...(query.merchantId ? { merchantId: query.merchantId } : {}),
          ...(query.storeId ? { storeId: query.storeId } : {}),
          ...(query.from || query.to ? { createdAt } : {}),
        },
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.pointTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { id: true, nickname: true, phone: true } },
          alliance: { select: { id: true, name: true } },
        },
      }),
      this.prisma.pointTransaction.count({ where }),
    ]);

    // point_transactions 只有 merchantId 标量（没有 merchant 关系），商家名单独查一次
    const merchantIds = [...new Set(rows.map((r) => r.merchantId).filter((v): v is number => !!v))];
    const merchants = merchantIds.length
      ? await this.prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, name: true } })
      : [];
    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));

    const operatorIds = [...new Set(rows.map((r) => r.operatorId).filter((v): v is number => !!v))];
    const operators = operatorIds.length
      ? await this.prisma.adminUser.findMany({
          where: { id: { in: operatorIds } },
          select: { id: true, realName: true, username: true },
        })
      : [];
    const operatorMap = new Map(operators.map((o) => [o.id, o.realName || o.username]));

    return {
      list: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.user?.nickname ?? null,
        userPhone: r.user?.phone ?? null,
        type: r.type,
        amount: r.amount,
        remainingAmount: r.remainingAmount,
        balanceAfter: r.balanceAfter,
        expireAt: r.expireAt,
        allianceId: r.allianceId,
        allianceName: r.alliance?.name ?? null,
        sourceRole: r.sourceRole,
        merchantId: r.merchantId,
        merchantName: r.merchantId ? merchantMap.get(r.merchantId) ?? null : null,
        storeId: r.storeId,
        relatedOrderId: r.relatedOrderId,
        relatedCouponInstanceId: r.relatedCouponInstanceId,
        sourceTransactionId: r.sourceTransactionId,
        originBatchId: r.originBatchId,
        operatorId: r.operatorId,
        operatorName: r.operatorId ? operatorMap.get(r.operatorId) ?? null : null,
        remark: r.remark,
        createdAt: r.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ---------------------------------------------------------------- 积分过期清零（S3.3）

  /**
   * 积分过期清零（定时任务 + 手动触发共用）。
   *
   * 扫描 `point_transactions` 中 `type=EARN AND remainingAmount>0 AND expireAt<NOW()` 的批次，
   * 逐批（每批最多 500 条，避免大事务锁表）在**单事务内**对其做：
   *  - 条件更新剩余为 0（`WHERE id=? AND remainingAmount=?`，并发/重复只会有 1 个成功 → 天然幂等）；
   *  - 写一条 EXPIRE 流水（amount=-remainingAmount，sourceTransactionId 指回原批次）；
   *  - 账户余额扣减 + totalExpired 累加（乐观锁 version，冲突重试）。
   *
   * 幂等：同一批次第二次进来时 remainingAmount 已为 0，扫描即排除；并发触发由内存 `running` 互斥，
   * 唯一索引 `(userId, sourceTransactionId, type)` 兜底（同一批次只能有一条 EXPIRE）。
   */
  private running = false;

  async expirePoints(opts: PointsExpireOptions = {}): Promise<PointsExpireResult> {
    if (this.running) {
      return {
        processed: 0,
        expiredAmount: 0,
        startedAt: new Date(),
        finishedAt: new Date(),
        skipped: true,
        message: '已有过期清零任务在执行，本次跳过',
      };
    }
    this.running = true;
    const startedAt = new Date();
    let processed = 0;
    let expiredAmount = 0;
    try {
      const now = new Date();
      // 循环分批扫描，每批最多 500 条，处理完再取下一页，直到没有过期批次
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const batch = await this.prisma.pointTransaction.findMany({
          where: { type: PointTxnType.EARN, remainingAmount: { gt: 0 }, expireAt: { lt: now } },
          select: {
            id: true,
            userId: true,
            allianceId: true,
            accountId: true,
            merchantId: true,
            storeId: true,
            remainingAmount: true,
          },
          orderBy: { expireAt: 'asc' },
          take: 500,
        });
        if (batch.length === 0) break;

        let done: { count: number; amount: number } | undefined;
        let lastErr: unknown = null;
        for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
          try {
            done = await this.expireBatch(batch, opts);
            break;
          } catch (e) {
            lastErr = e;
            if (e instanceof ConcurrentSignal || isTransientLockError(e)) {
              if (attempt === MAX_RETRY) {
                this.logger.warn(`积分过期批次处理并发冲突重试耗尽，跳过该批（${batch.length} 条）`);
                break;
              }
              await sleep(20 * attempt + Math.floor(Math.random() * 20));
              continue;
            }
            throw e;
          }
        }
        if (lastErr && !(lastErr instanceof ConcurrentSignal) && !isTransientLockError(lastErr)) throw lastErr;
        processed += done?.count ?? 0;
        expiredAmount += done?.amount ?? 0;
      }
    } finally {
      this.running = false;
    }

    await this.audit.record({
      operatorId: opts.operatorId ?? null,
      operatorType: opts.operatorType ?? null,
      module: 'point',
      action: ACTION.expire,
      targetType: 'point_account',
      before: null,
      after: {
        triggeredBy: opts.triggeredBy ?? 'manual',
        processed,
        expiredAmount,
        startedAt,
        finishedAt: new Date(),
      },
      ip: opts.ip ?? null,
      userAgent: opts.userAgent ?? null,
    });

    return { processed, expiredAmount, startedAt, finishedAt: new Date(), skipped: false };
  }

  /**
   * 单批（≤500 条 EARN）过期清零，整批一个事务；按 userId 聚合账户扣减，减少账户行锁竞争。
   * 返回本批实际处理的批次数与过期总积分。
   */
  private async expireBatch(
    batch: Array<{
      id: number;
      userId: number;
      allianceId: number;
      accountId: number;
      merchantId: number | null;
      storeId: number | null;
      remainingAmount: number;
    }>,
    opts: PointsExpireOptions,
  ): Promise<{ count: number; amount: number }> {
    return this.prisma.$transaction(async (tx) => {
      // 按积分账户（userId+allianceId）聚合，避免跨池扣错
      const byAccount = new Map<number, typeof batch>();
      for (const r of batch) {
        const arr = byAccount.get(r.accountId);
        if (arr) arr.push(r);
        else byAccount.set(r.accountId, [r]);
      }

      let count = 0;
      let amount = 0;
      const expireRows: Array<Prisma.PointTransactionCreateManyInput> = [];
      for (const [accountId, rows] of byAccount) {
        const acct = await tx.pointAccount.findUnique({ where: { id: accountId } });
        if (!acct) continue;
        let curBalance = acct.balance;
        let userExpired = 0;
        for (const r of rows) {
          // 条件更新：仅当剩余仍是扫描时的值才置 0 —— 并发/重复处理只会有 1 个成功，天然幂等
          const upd = await tx.pointTransaction.updateMany({
            where: { id: r.id, remainingAmount: r.remainingAmount },
            data: { remainingAmount: 0 },
          });
          if (upd.count === 0) continue; // 已被别的触发清零
          curBalance -= r.remainingAmount;
          userExpired += r.remainingAmount;
          expireRows.push({
            userId: r.userId,
            accountId: acct.id,
            allianceId: r.allianceId,
            type: PointTxnType.EXPIRE,
            amount: -r.remainingAmount,
            remainingAmount: 0,
            balanceAfter: curBalance,
            expireAt: null,
            sourceTransactionId: r.id,
            merchantId: r.merchantId,
            storeId: r.storeId,
            operatorId: opts.operatorId ?? null,
            remark: `批次#${r.id} 过期清零（${r.remainingAmount} 分）`,
            createdAt: new Date(),
          });
          count++;
        }
        if (userExpired > 0) {
          const affected = await tx.$executeRaw(
            Prisma.sql`UPDATE point_accounts SET balance = balance - ${userExpired}, totalExpired = totalExpired + ${userExpired}, version = version + 1 WHERE id = ${acct.id} AND version = ${acct.version}`,
          );
          if (affected === 0) throw new ConcurrentSignal();
          amount += userExpired;
        }
      }
      // 批量插入 EXPIRE 流水（比逐条 create 少 N-1 次往返，10000 条场景从 ~27s 降到 ~10s）
      if (expireRows.length) await tx.pointTransaction.createMany({ data: expireRows });
      return { count, amount };
    });
  }

  // ---------------------------------------------------------------- 消费录单送积分

  /**
   * 消费录单送积分（多联盟）
   *
   * 流程：校验 allianceId → 解析商家/门店 → 校验商家属于该联盟 → 取联盟规则 →
   * 事务内写 EARN（带 allianceId / sourceRole）+ 按 (userId, allianceId) 账户乐观锁。
   * 幂等：requestId 与 allianceId 组合进订单号；同订单只送一次。
   */
  async earn(dto: EarnPointsDto, user: JwtPayload, ip?: string, ua?: string) {
    if (!dto.allianceId || dto.allianceId < 1) {
      throw BizException.badRequest(ReasonCode.ALLIANCE_ID_REQUIRED, '发分必须指定 allianceId');
    }
    const allianceId = dto.allianceId;

    const alliance = await this.prisma.alliance.findUnique({
      where: { id: allianceId },
      select: { id: true, name: true, mainMerchantId: true },
    });
    if (!alliance) {
      throw BizException.notFound(ReasonCode.ALLIANCE_NOT_FOUND, `联盟 #${allianceId} 不存在`);
    }

    // 停服闸门：盟主会员到期 → 整个联盟停发（含联盟内附属商家）。
    // 核销、兑换不做此校验：已发出去的分和券必须让用户花完。
    await this.subs.assertMainMemberActive(alliance.mainMerchantId, '发分');

    const { merchantId, storeId } = await this.resolveMerchantStore(dto, user);

    const membership = await this.prisma.merchantAlliance.findUnique({
      where: { merchantId_allianceId: { merchantId, allianceId } },
      select: { role: true },
    });
    if (!membership) {
      throw BizException.forbidden(
        ReasonCode.MERCHANT_NOT_IN_ALLIANCE,
        `商家 #${merchantId} 不属于联盟「${alliance.name}」`,
      );
    }
    const sourceRole = membership.role;

    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, nickname: true, phone: true, status: true },
    });
    if (!target) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `用户 #${dto.userId} 不存在`);
    }

    const rule = await this.resolveRule(allianceId, merchantId);
    const amount = Number(dto.amount);
    // requestId 与 allianceId 组合幂等：同 requestId 换联盟视为不同请求
    const idempotentKey = dto.requestId
      ? `a${allianceId}-${dto.requestId}`.slice(0, 32)
      : undefined;
    let order = await this.resolveOrder(dto);
    if (!order) {
      order = await this.ensureScanOrder({
        userId: dto.userId,
        amount,
        merchantId,
        storeId,
        requestId: idempotentKey ?? dto.requestId,
        orderNo: dto.orderNo,
        remark: dto.remark,
      });
    }
    const minAmount = Number(rule.minAmount);
    if (amount < minAmount) {
      return {
        earned: false,
        points: 0,
        allianceId,
        reasonCode: 'BELOW_MIN_AMOUNT',
        message: `消费 ${amount} 元未达起送金额 ${minAmount} 元，本次不送积分`,
        rule: {
          allianceId: rule.allianceId,
          merchantId: rule.merchantId,
          earnRatio: Number(rule.earnRatio),
          minAmount,
        },
      };
    }
    const points = Math.floor(amount * Number(rule.earnRatio));
    if (points <= 0) {
      return {
        earned: false,
        points: 0,
        allianceId,
        reasonCode: 'POINTS_ZERO',
        message: `按规则折算后积分为 0（金额 ${amount} × 比例 ${Number(rule.earnRatio)}）`,
        rule: {
          allianceId: rule.allianceId,
          merchantId: rule.merchantId,
          earnRatio: Number(rule.earnRatio),
          minAmount,
        },
      };
    }

    const now = new Date();
    const expireAt = this.computeExpireAt(rule, now);

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          if (order) {
            const exist = await tx.pointTransaction.findFirst({
              where: { relatedOrderId: order.id, type: PointTxnType.EARN },
              select: { id: true, amount: true, createdAt: true },
            });
            if (exist) {
              throw BizException.conflict(
                ReasonCode.ORDER_POINTS_ALREADY_EARNED,
                `订单 #${order.id}（${order.orderNo}）已送过 ${exist.amount} 积分，不能重复送`,
              );
            }
          }

          const account = await this.ensureAccount(tx, dto.userId, allianceId);
          const balanceAfter = account.balance + points;

          const txn = await tx.pointTransaction.create({
            data: {
              userId: dto.userId,
              accountId: account.id,
              allianceId,
              type: PointTxnType.EARN,
              amount: points,
              remainingAmount: points,
              balanceAfter,
              expireAt,
              relatedOrderId: order?.id ?? null,
              merchantId,
              sourceRole,
              storeId: storeId ?? null,
              operatorId: user.sub,
              remark: dto.remark ?? `消费送积分·${alliance.name}`,
            },
          });

          const affected = await tx.$executeRaw(
            Prisma.sql`UPDATE point_accounts SET balance = balance + ${points}, totalEarned = totalEarned + ${points}, version = version + 1 WHERE id = ${account.id} AND version = ${account.version}`,
          );
          if (affected === 0) throw new ConcurrentSignal();

          await this.audit.record(
            {
              operatorId: user.sub,
              operatorType: user.userType,
              module: 'point',
              action: ACTION.earn,
              targetType: 'point_account',
              targetId: account.id,
              before: { userId: dto.userId, allianceId, balance: account.balance, version: account.version },
              after: {
                balance: balanceAfter,
                points,
                allianceId,
                sourceRole,
                expireAt,
                orderId: order?.id ?? null,
                transactionId: txn.id,
              },
              ip,
              userAgent: ua,
            },
            tx,
          );

          return {
            earned: true,
            points,
            allianceId,
            allianceName: alliance.name,
            sourceRole,
            transactionId: txn.id,
            expireAt,
            balance: balanceAfter,
            accountId: account.id,
            rule: {
              allianceId: rule.allianceId,
              merchantId: rule.merchantId,
              earnRatio: Number(rule.earnRatio),
              minAmount,
            },
          };
        });
      } catch (e) {
        lastErr = e;
        if (e instanceof ConcurrentSignal || isTransientLockError(e)) {
          if (attempt === MAX_RETRY) break;
          await sleep(20 * attempt + Math.floor(Math.random() * 20));
          continue;
        }
        if (isEarnOrderUniqueViolation(e)) {
          throw BizException.conflict(
            ReasonCode.ORDER_POINTS_ALREADY_EARNED,
            `订单 #${order?.id ?? '-'}（${order?.orderNo ?? '-'}）已送过积分，不能重复送`,
          );
        }
        if (isUniqueViolation(e)) {
          if (attempt === MAX_RETRY) throw e;
          await sleep(20 * attempt + Math.floor(Math.random() * 20));
          continue;
        }
        throw e;
      }
    }
    void lastErr;
    throw BizException.conflict(
      ReasonCode.CONCURRENT_UPDATE,
      `积分账户并发更新冲突，已重试 ${MAX_RETRY} 次仍未成功，请稍后重试`,
    );
  }

  // ---------------------------------------------------------------- 人工调整

  /**
   * 人工调整积分：正增负减，必填原因（≥5 字符，DTO 校验），写 ADJUST 流水 + 审计。
   * 负向调整**走 FIFO 扣减**（与兑换一致），且过期批次不可用——避免「调账把过期积分盘活」。
   */
  async adjust(dto: AdjustPointsDto, user: JwtPayload, ip?: string, ua?: string) {
    if (dto.amount === 0) {
      throw BizException.badRequest(ReasonCode.INVALID_ADJUST_AMOUNT, '调整积分不能为 0');
    }
    // 注意这里用的是「可写」口径而不是「可读」口径：
    // 人工调整常常是给**还没有任何积分流水的新用户**补分，若套用读可见性（有流水才可见）会被 403 挡掉，
    // 逼着运营先想办法造一条流水——这是把查询口径错位用到了写操作上。
    await this.assertWritableUser(dto.userId, user);
    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, nickname: true, phone: true },
    });
    if (!target) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `用户 #${dto.userId} 不存在`);
    }

    const isAdd = dto.amount > 0;
    const points = Math.abs(dto.amount);
    const now = new Date();

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          const allianceId = DEFAULT_ALLIANCE_ID;
          const account = await this.ensureAccount(tx, dto.userId, allianceId);

          let expireAt: Date | null = null;
          let deductions: FifoDeduction[] = [];
          if (isAdd) {
            if (dto.expireAt) {
              expireAt = new Date(dto.expireAt);
            } else {
              const rule = await this.resolveRule(allianceId, null);
              expireAt = this.computeExpireAt(rule, now);
            }
          } else {
            // 扣减：按 FIFO 吃掉最快过期的批次，够不够由批次说话（不看账户余额）
            deductions = await this.consumeFifo(tx, dto.userId, allianceId, points, now);
          }

          const balanceAfter = isAdd ? account.balance + points : account.balance - points;
          if (!isAdd && balanceAfter < 0) {
            throw BizException.conflict(
              ReasonCode.BALANCE_NOT_ENOUGH,
              `可用积分不足：需扣减 ${points}，当前余额 ${account.balance}`,
            );
          }

          const txn = await tx.pointTransaction.create({
            data: {
              userId: dto.userId,
              accountId: account.id,
              allianceId,
              type: PointTxnType.ADJUST,
              amount: isAdd ? points : -points,
              // 正向调整是「新批次」可被后续 FIFO 消耗；负向调整本身不是批次，remaining=0
              remainingAmount: isAdd ? points : 0,
              balanceAfter,
              expireAt,
              operatorId: user.sub,
              remark: dto.reason,
            },
          });

          const affected = isAdd
            ? await tx.$executeRaw(
                Prisma.sql`UPDATE point_accounts SET balance = balance + ${points}, totalEarned = totalEarned + ${points}, version = version + 1 WHERE id = ${account.id} AND version = ${account.version}`,
              )
            : await tx.$executeRaw(
                Prisma.sql`UPDATE point_accounts SET balance = balance - ${points}, totalSpent = totalSpent + ${points}, version = version + 1 WHERE id = ${account.id} AND version = ${account.version}`,
              );
          if (affected === 0) throw new ConcurrentSignal();

          await this.audit.record(
            {
              operatorId: user.sub,
              operatorType: user.userType,
              module: 'point',
              action: ACTION.adjust,
              targetType: 'point_account',
              targetId: account.id,
              before: { userId: dto.userId, balance: account.balance, version: account.version },
              after: { balance: balanceAfter, adjust: dto.amount, reason: dto.reason, transactionId: txn.id, deductions },
              ip,
              userAgent: ua,
            },
            tx,
          );

          return {
            adjusted: true,
            amount: isAdd ? points : -points,
            transactionId: txn.id,
            expireAt,
            balance: balanceAfter,
            deductions,
          };
        });
      } catch (e) {
        lastErr = e;
        if (e instanceof ConcurrentSignal || isTransientLockError(e)) {
          if (attempt === MAX_RETRY) break;
          await sleep(20 * attempt + Math.floor(Math.random() * 20));
          continue;
        }
        throw e;
      }
    }
    throw BizException.conflict(
      ReasonCode.CONCURRENT_UPDATE,
      `积分账户并发更新冲突（含数据库瞬时死锁），已重试 ${MAX_RETRY} 次仍未成功，请稍后重试`,
    );
  }

  // ---------------------------------------------------------------- 积分兑换（S3.2）

  /**
   * 积分兑换代金券
   *
   * 严格按 9 步顺序执行，**任一步失败整事务回滚**（用例 9 用注入触发器验证）：
   * ① 幂等键 → ② 模板校验（存在/上架/库存/限领）→ ③ 可用积分校验 → ④ FIFO 扣减（含 SPEND 流水）→
   * ⑤ 券码分配（FOR UPDATE + 条件更新）→ ⑥ 生成券实例 → ⑦ 账户乐观锁扣减 →
   * ⑧ 模板 issuedCount 条件更新 → ⑨ 兑换记录 + 审计。
   *
   * 幂等：同一 `(userId, requestId)` 已存在 → **返回上次结果**（200 + `idempotent:true`），
   * 不是 409 —— 幂等语义下重复提交应当看到同一个结果，而不是「被拒绝」。
   */
  async exchange(
    dto: ExchangePointsDto,
    user: JwtPayload,
    ip?: string,
    ua?: string,
    ctx?: { merchantId?: number },
  ) {
    // 「逛商家」兑换：只从当前进入的这家商家所发的积分批次里扣，且不再看券所属联盟。
    // 不传 merchantId 时完全沿用旧的联盟积分池规则（后台代客兑换与回归脚本都依赖它）。
    const shopMerchantId = ctx?.merchantId && ctx.merchantId > 0 ? Number(ctx.merchantId) : 0;
    const shopMode = shopMerchantId > 0;
    if (!dto.allianceId || dto.allianceId < 1) {
      throw BizException.badRequest(ReasonCode.ALLIANCE_ID_REQUIRED, '兑换必须指定 allianceId');
    }
    const allianceId = dto.allianceId;

    const target = await this.prisma.user.findUnique({
      where: { id: dto.userId },
      select: { id: true, nickname: true, phone: true },
    });
    if (!target) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `用户 #${dto.userId} 不存在`);
    }

    // ① 幂等键命中 → 直接回上次结果（不写任何数据）
    const exist = await this.prisma.exchangeRecord.findUnique({
      where: { userId_requestId: { userId: dto.userId, requestId: dto.requestId } },
      include: { couponInstance: { select: { id: true, code: true, expireAt: true } } },
    });
    if (exist) {
      return {
        idempotent: true,
        exchangeId: exist.id,
        couponInstanceId: exist.couponInstanceId,
        code: exist.couponInstance?.code ?? null,
        expireAt: exist.couponInstance?.expireAt ?? null,
        pointsCost: exist.pointsCost,
        templateId: exist.templateId,
        createdAt: exist.createdAt,
      };
    }

    // ② 模板校验 + ownerType / allianceId
    const template = await this.prisma.couponTemplate.findUnique({ where: { id: dto.templateId } });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${dto.templateId} 不存在`);
    }
    // 商家维度兑换已取消联盟筛选：只要券能在这家店用，就允许用这家店攒的分兑换。
    if (!shopMode && template.allianceId !== allianceId) {
      throw BizException.badRequest(
        ReasonCode.ALLIANCE_MISMATCH,
        `券模板「${template.name}」属于联盟 #${template.allianceId}，与请求 allianceId=#${allianceId} 不一致`,
      );
    }
    if (template.status !== CouponTemplateStatus.PUBLISHED) {
      throw BizException.conflict(
        ReasonCode.TEMPLATE_NOT_AVAILABLE,
        `券模板「${template.name}」当前状态为 ${template.status}，只有已上架的模板可兑换`,
      );
    }
    const pointsCost = template.pointsCost;
    if (pointsCost <= 0) {
      throw BizException.badRequest(
        ReasonCode.TEMPLATE_NOT_EXCHANGEABLE,
        `券模板「${template.name}」未设置兑换所需积分（pointsCost=${pointsCost}），不支持积分兑换`,
      );
    }
    // 商家主动关掉兑换：等同下架兑换商城，但已发出的券不受影响
    if (template.exchangeEnabled === false) {
      throw BizException.conflict(
        ReasonCode.TEMPLATE_NOT_EXCHANGEABLE,
        `券模板「${template.name}」已被商家关闭积分兑换`,
      );
    }
    if (template.totalStock - template.issuedCount < 1) {
      throw BizException.conflict(
        ReasonCode.STOCK_EXHAUSTED,
        `券模板「${template.name}」库存不足：本次需 1 张，剩余 ${Math.max(template.totalStock - template.issuedCount, 0)} 张`,
      );
    }
    const owned = await this.prisma.couponInstance.count({
      where: { userId: dto.userId, templateId: dto.templateId },
    });
    // perUserLimit=0 表示不限领
    if (template.perUserLimit > 0 && owned >= template.perUserLimit) {
      throw BizException.conflict(
        ReasonCode.PER_USER_LIMIT_EXCEEDED,
        `该用户已兑换「${template.name}」${owned} 张，达到限领 ${template.perUserLimit} 张`,
      );
    }

    const advScope = (template.applicableScope ?? null) as {
      claimLimitMode?: string;
      issueDeadlineType?: string;
      issueDeadline?: string | null;
    } | null;

    // 发放截止
    if (advScope?.issueDeadlineType === 'DATE' && advScope.issueDeadline) {
      const end = new Date(`${advScope.issueDeadline}T23:59:59.999Z`);
      if (Date.now() > end.getTime()) {
        throw BizException.conflict(
          ReasonCode.ISSUE_DEADLINE_PASSED,
          `券「${template.name}」已过发放截止日期 ${advScope.issueDeadline}`,
        );
      }
    }

    // 仅限新客：该用户在券归属商家下已有成功消费订单则拒绝
    if (advScope?.claimLimitMode === 'NEW_CUSTOMER') {
      const priorOrders = await this.prisma.order.count({
        where: {
          userId: dto.userId,
          merchantId: template.ownerMerchantId,
          status: 'NORMAL',
          orderType: 'CONSUME',
        },
      });
      if (priorOrders > 0) {
        throw BizException.forbidden(
          ReasonCode.NEW_CUSTOMER_ONLY,
          `券「${template.name}」仅限新客首单，您在该商家已有历史订单`,
        );
      }
    }

    // 商家维度不再区分主体分/附属分：本店攒的分就是本店能花的全部
    const isSubCoupon = !shopMode && template.ownerType === CouponOwnerType.SUB_COUPON;
    const policy: ExchangeConsumePolicy = isSubCoupon ? 'MAIN_ONLY' : 'SUB_FIRST';

    // ③ 按联盟 + sourceRole 预检可用积分
    //
    // 口径已扩到「桥店」：除了本联盟的批次，还包括**在本联盟旗下商家获得、
    // 但记在别的联盟账户里的批次**。一家店同时挂 A、B 两个联盟时，
    // 顾客在这家店拿到的分天然可以在两个联盟花（这是产品明确要求的）。
    const now = new Date();
    const pool = shopMode
      ? await this.shopExchangePool(dto.userId, shopMerchantId, now)
      : await this.exchangePool(dto.userId, allianceId, now);
    const totalAvailable = pool.total;
    const mainAvailable = pool.main;
    const subAvailable = pool.sub;

    if (isSubCoupon) {
      // 附属券：只能用主体消费获得的积分
      if (mainAvailable < pointsCost) {
        throw BizException.forbidden(
          ReasonCode.SUB_COUPON_REQUIRES_MAIN_POINTS,
          `附属券只能用主体消费获得的积分兑换：需 ${pointsCost}，当前主体积分 ${mainAvailable}` +
            (subAvailable > 0 ? `（另有附属积分 ${subAvailable} 不可用于附属券）` : ''),
        );
      }
    } else if (totalAvailable < pointsCost) {
      throw BizException.conflict(
        ReasonCode.BALANCE_NOT_ENOUGH,
        shopMode
          ? `在这家店可用积分不足：需 ${pointsCost}，当前只有 ${totalAvailable} 分`
          : `可用积分不足：需 ${pointsCost}，当前可兑 ${totalAvailable}` +
              '（含同时属于本联盟的商家所发积分）',
      );
    }

    const available = isSubCoupon ? mainAvailable : totalAvailable;

    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= MAX_RETRY; attempt++) {
      try {
        return await this.prisma.$transaction(async (tx) => {
          // ⑤ 券码：FOR UPDATE 锁行 + 条件更新（并发下只有一个请求能拿到同一个码）
          const codes = await tx.$queryRaw<Array<{ id: bigint | number; code: string }>>(
            Prisma.sql`SELECT id, code FROM coupon_codes WHERE templateId = ${dto.templateId} AND status = 'UNISSUED' ORDER BY id ASC LIMIT 1 FOR UPDATE`,
          );
          if (codes.length === 0) {
            throw BizException.conflict(
              ReasonCode.CODE_POOL_EXHAUSTED,
              `券模板「${template.name}」券码池已耗尽，请先预生成券码`,
            );
          }
          const codeId = Number(codes[0].id);
          const codeStr = codes[0].code;
          const codeAffected = await tx.$executeRaw(
            Prisma.sql`UPDATE coupon_codes SET status = 'ISSUED' WHERE id = ${codeId} AND status = 'UNISSUED'`,
          );
          if (codeAffected === 0) {
            throw BizException.conflict(
              ReasonCode.CODE_POOL_EXHAUSTED,
              `券码 #${codeId} 已被占用（并发兑换），请重试`,
            );
          }

          // ④ 按策略 FIFO 扣减（附属券只扣 MAIN；主体券优先扣 SUB）
          //    跨联盟：批次可能记在别的联盟账户里，扣减与流水都要回到它自己的账户
          const account = await this.ensureAccount(tx, dto.userId, allianceId);
          const deductions = await this.consumeFifoForExchangeBridge(
            tx,
            dto.userId,
            allianceId,
            pointsCost,
            now,
            policy,
            shopMerchantId || undefined,
          );

          // 按账户分组：每个账户一次性乐观锁扣减，避免逐条更新版本号
          const byAccount = new Map<number, typeof deductions>();
          for (const d of deductions) {
            const list = byAccount.get(d.accountId) ?? [];
            list.push(d);
            byAccount.set(d.accountId, list);
          }

          const beforeBalance = new Map<number, number>();
          const afterBalance = new Map<number, number>();
          for (const [accountId, list] of byAccount) {
            const acc = await tx.pointAccount.findUnique({
              where: { id: accountId },
              select: { id: true, balance: true, version: true },
            });
            if (!acc) {
              throw BizException.conflict(
                ReasonCode.POINT_ACCOUNT_NOT_FOUND,
                `积分账户 #${accountId} 不存在`,
              );
            }
            const spent = list.reduce((s, d) => s + d.amount, 0);
            const next = acc.balance - spent;
            if (next < 0) {
              throw BizException.conflict(
                ReasonCode.BALANCE_NOT_ENOUGH,
                `可用积分不足：需从账户 #${accountId} 扣 ${spent}，当前余额 ${acc.balance}`,
              );
            }
            const accAffected = await tx.$executeRaw(
              Prisma.sql`UPDATE point_accounts SET balance = balance - ${spent}, totalSpent = totalSpent + ${spent}, version = version + 1 WHERE id = ${accountId} AND version = ${acc.version}`,
            );
            if (accAffected === 0) throw new ConcurrentSignal();
            beforeBalance.set(accountId, acc.balance);
            afterBalance.set(accountId, next);
          }

          // 商家维度扣的是该商家发的批次，可能分散在多个联盟账户里；
          // 这里对外报「本店还剩多少可用分」而不是某个账户的余额，避免显示成 0 分。
          const balanceAfter = shopMode
            ? Math.max(0, available - pointsCost)
            : (afterBalance.get(account.id) ?? account.balance);

          // ⑥ 生成券实例：积分兑换来的券**归属主体商家**（券是主体的资产，只是发给用户）
          const expireAt = this.computeCouponExpireAt(template, now);
          const instance = await tx.couponInstance.create({
            data: {
              userId: dto.userId,
              templateId: dto.templateId,
              code: codeStr,
              issuerMerchantId: template.ownerMerchantId,
              source: CouponSource.EXCHANGE,
              pointsCost,
              expireAt,
            },
          });
          // 券码反向绑定实例（coupon_codes.instanceId 唯一，并发下不会被绑两次）
          await tx.$executeRaw(
            Prisma.sql`UPDATE coupon_codes SET instanceId = ${instance.id} WHERE id = ${codeId} AND instanceId IS NULL`,
          );

          // ④-b SPEND 流水：**每个被扣批次一条**（而不是汇总成一条）。
          // 这样 S3.4 退款回退才能按「方案 A：退回原批次、保留原 expireAt」精确还原
          // ——汇总成一条就丢失了「这笔钱是从哪批扣的」，只能粗略地当成新批次退回。
          const running = new Map(beforeBalance);
          for (const d of deductions) {
            const next = (running.get(d.accountId) ?? 0) - d.amount;
            running.set(d.accountId, next);
            const roleHint =
              d.sourceRole === AllianceRole.MAIN
                ? '主体'
                : d.sourceRole === AllianceRole.SUB
                  ? '附属'
                  : '未知';
            await tx.pointTransaction.create({
              data: {
                userId: dto.userId,
                accountId: d.accountId,
                // 流水跟随批次所属联盟，否则按联盟对账会串账
                allianceId: d.allianceId,
                type: PointTxnType.SPEND,
                amount: -d.amount,
                remainingAmount: 0,
                balanceAfter: next,
                merchantId: shopMode ? shopMerchantId : template.ownerMerchantId,
                operatorId: user.sub,
                relatedCouponInstanceId: instance.id,
                // S4 收口：记录「这笔扣减来自哪个 EARN 批次」改用 originBatchId（不再占用 sourceTransactionId，
                // 后者仅留给 EXPIRE 的幂等键），退款回退据此按方案 A 精确还原到原批次
                originBatchId: d.txnId,
                remark:
                  dto.remark ??
                  `积分兑换「${template.name}」（${roleHint}批次 #${d.txnId} 扣 ${d.amount}` +
                    (d.allianceId === allianceId ? '）' : `，来自联盟 #${d.allianceId}）`),
              },
            });
          }

          // ⑧ 模板 issuedCount 条件更新（放在最后：它是「库存」这道闸门的最终落点，失败则前面全部回滚）
          const stockAffected = await tx.$executeRaw(
            Prisma.sql`UPDATE coupon_templates SET issuedCount = issuedCount + 1, updatedAt = NOW() WHERE id = ${dto.templateId} AND totalStock - issuedCount >= 1`,
          );
          if (stockAffected === 0) {
            throw BizException.conflict(
              ReasonCode.STOCK_EXHAUSTED,
              `券模板「${template.name}」库存不足（并发兑换已抢完），请稍后再试`,
            );
          }

          // ⑨ 兑换记录（幂等键落库）+ 审计
          const record = await tx.exchangeRecord.create({
            data: {
              userId: dto.userId,
              templateId: dto.templateId,
              couponInstanceId: instance.id,
              pointsCost,
              requestId: dto.requestId,
              channel: dto.channel ?? 'H5',
              merchantId: shopMode ? shopMerchantId : template.ownerMerchantId,
              operatorId: user.sub,
              remark: dto.remark ?? null,
            },
          });

          await this.audit.record(
            {
              operatorId: user.sub,
              operatorType: user.userType,
              module: 'point',
              action: ACTION.exchange,
              targetType: 'exchange_record',
              targetId: record.id,
              before: {
                userId: dto.userId,
                balance: account.balance,
                version: account.version,
                available,
              },
              after: {
                balance: balanceAfter,
                pointsCost,
                allianceId,
                merchantId: shopMode ? shopMerchantId : null,
                ownerType: template.ownerType,
                policy,
                couponInstanceId: instance.id,
                code: codeStr,
                deductions,
                requestId: dto.requestId,
              },
              ip,
              userAgent: ua,
            },
            tx,
          );

          return {
            idempotent: false,
            exchangeId: record.id,
            couponInstanceId: instance.id,
            code: codeStr,
            expireAt,
            pointsCost,
            allianceId,
            merchantId: shopMode ? shopMerchantId : null,
            ownerType: template.ownerType,
            balance: balanceAfter,
            deductions,
          };
        });
      } catch (e) {
        lastErr = e;
        // 幂等键撞车（并发重复提交）：返回上次结果，而不是报错
        if (isUniqueViolation(e)) {
          const prev = await this.prisma.exchangeRecord.findUnique({
            where: { userId_requestId: { userId: dto.userId, requestId: dto.requestId } },
            include: { couponInstance: { select: { id: true, code: true, expireAt: true } } },
          });
          if (prev) {
            return {
              idempotent: true,
              exchangeId: prev.id,
              couponInstanceId: prev.couponInstanceId,
              code: prev.couponInstance?.code ?? null,
              expireAt: prev.couponInstance?.expireAt ?? null,
              pointsCost: prev.pointsCost,
              templateId: prev.templateId,
              createdAt: prev.createdAt,
            };
          }
        }
        if (e instanceof ConcurrentSignal || isTransientLockError(e)) {
          if (attempt === MAX_RETRY) break;
          await sleep(20 * attempt + Math.floor(Math.random() * 20));
          continue;
        }
        throw e;
      }
    }
    throw BizException.conflict(
      ReasonCode.CONCURRENT_UPDATE,
      `积分兑换并发冲突（含数据库瞬时死锁），已重试 ${MAX_RETRY} 次仍未成功，请稍后重试`,
    );
  }

  /**
   * 可兑商品清单（C 端兑换商城）
   *
   * 口径就是「谁发的分能兑什么」：
   * - 主体商家发的分（发分商家在本联盟 role=MAIN）→ 可兑主体券 + 全部附属券
   * - 附属商家发的分（role=SUB）→ 只能兑主体券
   *
   * 发分商家在本联盟的角色按 merchant_alliances **动态判定**，不看流水上冻结的 sourceRole：
   * 一家店同时挂 A/B 两个联盟、角色还不一样时，同一笔分在两个联盟里的身份各算各的，不会串。
   *
   * 每张券带 `eligibleMerchants`（哪几家店发的分能兑它），前端直接展示
   * 「用城南店、城西店的主体积分可兑」——这就是「不同商家积分对应不同商品」的落点。
   */
  async exchangeOptions(query: QueryExchangeOptionsDto, user: JwtPayload) {
    await this.assertUserVisible(query.userId, user);
    const now = new Date();

    const allianceId =
      query.allianceId ??
      (
        await this.prisma.pointTransaction.findFirst({
          where: { userId: query.userId, type: PointTxnType.EARN },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { allianceId: true },
        })
      )?.allianceId ??
      DEFAULT_ALLIANCE_ID;

    const alliance = await this.prisma.alliance.findUnique({
      where: { id: allianceId },
      select: { id: true, name: true, mainMerchantId: true },
    });
    if (!alliance) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `联盟 #${allianceId} 不存在`);
    }

    // 一次查出「可动用的批次 + 发分商家在本联盟的角色」，避免逐条子查询
    const rows = await this.prisma.$queryRaw<
      Array<{ merchantId: number | null; remaining: bigint | number; role: AllianceRole | null }>
    >(Prisma.sql`
      SELECT pt.merchantId AS merchantId, pt.remainingAmount AS remaining,
             COALESCE(
               (SELECT ma.role FROM merchant_alliances ma
                WHERE ma.allianceId = ${allianceId} AND ma.merchantId = pt.merchantId
                LIMIT 1),
               pt.sourceRole
             ) AS role
      FROM point_transactions pt
      WHERE pt.userId = ${query.userId}
        AND pt.type IN ('EARN', 'ADJUST', 'REFUND')
        AND pt.remainingAmount > 0
        AND (pt.expireAt IS NULL OR pt.expireAt > ${now})
        AND (
          pt.allianceId = ${allianceId}
          OR EXISTS (
            SELECT 1 FROM merchant_alliances ma
            WHERE ma.allianceId = ${allianceId} AND ma.merchantId = pt.merchantId
          )
        )`);

    const perMerchant = new Map<number, { remaining: number; role: AllianceRole }>();
    let mainPoints = 0;
    let subPoints = 0;
    for (const r of rows) {
      const v = Number(r.remaining);
      const role = r.role === AllianceRole.SUB ? AllianceRole.SUB : AllianceRole.MAIN;
      if (role === AllianceRole.MAIN) mainPoints += v;
      else subPoints += v;
      // raw 查询返回的是 BigInt，转成 number 才能当 Map 键和给 Prisma 当入参
      if (r.merchantId == null) continue;
      const merchantIdValue = Number(r.merchantId);
      const agg = perMerchant.get(merchantIdValue) ?? { remaining: 0, role };
      agg.remaining += v;
      perMerchant.set(merchantIdValue, agg);
    }

    // 商家上下文：附属身份在本联盟只能看到主体商家的券（附属积分只能兑主体商品）
    let viewAsSub = false;
    if (query.merchantId) {
      const membership = await this.prisma.merchantAlliance.findFirst({
        where: { merchantId: query.merchantId, allianceId },
        select: { role: true },
      });
      viewAsSub = membership?.role === AllianceRole.SUB;
    }

    const templates = await this.prisma.couponTemplate.findMany({
      where: {
        allianceId,
        status: CouponTemplateStatus.PUBLISHED,
        exchangeEnabled: true,
        pointsCost: { gt: 0 },
        ...(viewAsSub ? { ownerType: CouponOwnerType.MAIN_COUPON } : {}),
      },
      orderBy: [{ pointsCost: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        subtitle: true,
        ownerType: true,
        ownerMerchantId: true,
        faceValue: true,
        thresholdAmount: true,
        pointsCost: true,
        totalStock: true,
        issuedCount: true,
        perUserLimit: true,
        validDays: true,
      },
    });

    const ownerIds = [...new Set(templates.map((t) => t.ownerMerchantId))];
    const perMerchantIds = [...perMerchant.keys()];
    const [owners, ownedRows, perMerchantNames] = await Promise.all([
      ownerIds.length
        ? this.prisma.merchant.findMany({
            where: { id: { in: ownerIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: number; name: string }>),
      templates.length
        ? this.prisma.couponInstance.groupBy({
            by: ['templateId'],
            where: { userId: query.userId, templateId: { in: templates.map((t) => t.id) } },
            _count: { _all: true },
          })
        : Promise.resolve([] as Array<{ templateId: number; _count: { _all: number } }>),
      perMerchantIds.length
        ? this.prisma.merchant.findMany({
            where: { id: { in: perMerchantIds } },
            select: { id: true, name: true },
          })
        : Promise.resolve([] as Array<{ id: number; name: string }>),
    ]);
    const ownerMap = new Map(owners.map((m) => [m.id, m.name]));
    const ownedMap = new Map(ownedRows.map((r) => [r.templateId, r._count._all]));
    const merchantNameMap = new Map(perMerchantNames.map((m) => [m.id, m.name]));

    const items = templates.map((t) => {
      // 附属券只能用主体分；主体券两种分都能用
      const isSubCoupon = t.ownerType === CouponOwnerType.SUB_COUPON;
      const usablePoints = isSubCoupon ? mainPoints : mainPoints + subPoints;
      const owned = ownedMap.get(t.id) ?? 0;
      const remainingStock = Math.max(t.totalStock - t.issuedCount, 0);
      const limitReached = t.perUserLimit > 0 && owned >= t.perUserLimit;

      /** 哪几家店发的分能兑这张券（附属券只认主体分） */
      const eligibleMerchants = [...perMerchant.entries()]
        .filter(([, m]) => m.remaining > 0)
        .filter(([, m]) => (isSubCoupon ? m.role !== AllianceRole.SUB : true))
        .map(([id, m]) => ({
          merchantId: id,
          merchantName: merchantNameMap.get(id) ?? `商家#${id}`,
          role: m.role === AllianceRole.SUB ? ('SUB' as const) : ('MAIN' as const),
          points: m.remaining,
        }))
        .sort((a, b) => b.points - a.points);

      return {
        templateId: t.id,
        name: t.name,
        subtitle: t.subtitle,
        ownerType: t.ownerType,
        ownerMerchantId: t.ownerMerchantId,
        ownerMerchantName: ownerMap.get(t.ownerMerchantId) ?? null,
        faceValue: Number(t.faceValue),
        thresholdAmount: Number(t.thresholdAmount),
        pointsCost: t.pointsCost,
        validDays: t.validDays,
        remainingStock,
        perUserLimit: t.perUserLimit,
        owned,
        /** MAIN=只认主体分；BOTH=两种分都行 */
        payWith: isSubCoupon ? ('MAIN' as const) : ('BOTH' as const),
        payWithText: isSubCoupon ? '仅可用主体积分兑换' : '主体或附属积分均可兑换',
        usablePoints,
        affordable: usablePoints >= t.pointsCost && remainingStock > 0 && !limitReached,
        limitReached,
        eligibleMerchants,
      };
    });

    return {
      userId: query.userId,
      allianceId: alliance.id,
      allianceName: alliance.name,
      /** 主体积分可兑全部；附属积分只能兑主体券 */
      pool: { mainPoints, subPoints, total: mainPoints + subPoints },
      viewAsSub,
      items,
      affordableCount: items.filter((i) => i.affordable).length,
    };
  }

  /** 兑换记录（用户视角为 /points/exchange-records?userId=自己） */
  async listExchangeRecords(query: QueryExchangeRecordsDto, user: JwtPayload) {
    if (query.userId) {
      await this.assertUserVisible(query.userId, user);
    }
    const merchantIds = await this.visibleMerchantIds(user);
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) createdAt.lte = new Date(`${query.to}T23:59:59.999Z`);

    const where: Prisma.ExchangeRecordWhereInput = {
      AND: [
        // 平台全量；其余按「券归属商家」收敛（无归属记录仅主体可见，与流水同口径）
        user.userType === 'PLATFORM'
          ? {}
          : { OR: [{ merchantId: { in: merchantIds ?? [] } }, ...(merchantIds && merchantIds.includes(user.merchantId ?? 0) ? [{ merchantId: null }] : [])] },
        {
          ...(query.userId ? { userId: query.userId } : {}),
          ...(query.templateId ? { templateId: query.templateId } : {}),
          ...(query.from || query.to ? { createdAt } : {}),
        },
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.exchangeRecord.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { id: true, nickname: true, phone: true } },
          template: { select: { id: true, name: true, faceValue: true } },
          couponInstance: { select: { id: true, code: true, status: true, expireAt: true } },
        },
      }),
      this.prisma.exchangeRecord.count({ where }),
    ]);

    return {
      list: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.user?.nickname ?? null,
        userPhone: r.user?.phone ?? null,
        templateId: r.templateId,
        templateName: r.template?.name ?? null,
        faceValue: r.template ? Number(r.template.faceValue) : null,
        couponInstanceId: r.couponInstanceId,
        code: r.couponInstance?.code ?? null,
        couponStatus: r.couponInstance?.status ?? null,
        couponExpireAt: r.couponInstance?.expireAt ?? null,
        pointsCost: r.pointsCost,
        requestId: r.requestId,
        channel: r.channel,
        operatorId: r.operatorId,
        remark: r.remark,
        createdAt: r.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  // ---------------------------------------------------------------- 积分规则

  /** 规则列表：平台看全部；商家看「自己 + 平台默认」 */
  async listRules(user: JwtPayload) {
    const where: Prisma.PointRuleWhereInput =
      user.userType === 'PLATFORM'
        ? {}
        : { OR: [{ merchantId: user.merchantId ?? 0 }, { merchantId: 0 }] };
    const rows = await this.prisma.pointRule.findMany({ where, orderBy: [{ merchantId: 'asc' }, { id: 'asc' }] });
    return {
      list: rows.map((r) => ({
        id: r.id,
        merchantId: r.merchantId,
        // merchantId=0 就是平台级默认规则，商家没有自己的规则时回落到这里
        level: r.merchantId === 0 ? 'PLATFORM' : 'MERCHANT',
        earnRatio: Number(r.earnRatio),
        minAmount: Number(r.minAmount),
        pointsValidMonths: r.pointsValidMonths,
        expireMode: r.expireMode,
        status: r.status,
        effectiveAt: r.effectiveAt,
        updatedAt: r.updatedAt,
      })),
    };
  }

  /** 规则编辑：写审计（谁改的、改前改后）。改平台规则需要平台管理员。 */
  async updateRule(id: number, dto: UpdatePointRuleDto, user: JwtPayload, ip?: string, ua?: string) {
    const rule = await this.prisma.pointRule.findUnique({ where: { id } });
    if (!rule) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `积分规则 #${id} 不存在`);
    }
    if (user.userType !== 'PLATFORM' && rule.merchantId !== user.merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '只能修改本商家的积分规则');
    }

    const before = {
      earnRatio: Number(rule.earnRatio),
      minAmount: Number(rule.minAmount),
      pointsValidMonths: rule.pointsValidMonths,
      expireMode: rule.expireMode,
      status: rule.status,
    };
    try {
      const updated = await this.prisma.pointRule.update({
        where: { id },
        data: {
          ...(dto.earnRatio !== undefined ? { earnRatio: dto.earnRatio } : {}),
          ...(dto.minAmount !== undefined ? { minAmount: dto.minAmount } : {}),
          ...(dto.pointsValidMonths !== undefined ? { pointsValidMonths: dto.pointsValidMonths } : {}),
          ...(dto.expireMode !== undefined ? { expireMode: dto.expireMode as ExpireMode } : {}),
          ...(dto.status !== undefined ? { status: dto.status } : {}),
        },
      });
      await this.audit.record({
        operatorId: user.sub,
        operatorType: user.userType,
        module: 'point',
        action: ACTION.ruleUpdate,
        targetType: 'point_rule',
        targetId: id,
        before,
        after: {
          earnRatio: Number(updated.earnRatio),
          minAmount: Number(updated.minAmount),
          pointsValidMonths: updated.pointsValidMonths,
          expireMode: updated.expireMode,
          status: updated.status,
        },
        ip,
        userAgent: ua,
      });
      return { rule: { id: updated.id, merchantId: updated.merchantId, ...{
        earnRatio: Number(updated.earnRatio),
        minAmount: Number(updated.minAmount),
        pointsValidMonths: updated.pointsValidMonths,
        expireMode: updated.expireMode,
        status: updated.status,
      } } };
    } catch (e) {
      // 同一商家只能有一条生效规则（唯一约束 (merchantId, status)）；**精确匹配**该索引
      if (isPointRuleUniqueViolation(e)) {
        throw BizException.conflict(
          ReasonCode.POINT_RULE_ALREADY_ACTIVE,
          `商家 #${rule.merchantId} 已有一条生效中的积分规则，请先停用再启用`,
        );
      }
      throw e;
    }
  }

  // ---------------------------------------------------------------- FIFO（S3.2 兑换复用）

  /**
   * FIFO 扣减积分：**必须在事务内调用**。
   *
   * - 只挑「未过期（expireAt > now）且 remainingAmount > 0」的批次，按 `expireAt` 升序吃；
   * - 每笔都用条件更新 `WHERE remainingAmount >= take`，并发抢扣时影响行数 0 → 409 `BALANCE_NOT_ENOUGH`；
   * - 返回逐笔扣减明细，供兑换 / 退款回退（S3.4 方案 A：退回原批次，保留原 expireAt）。
   */
  async consumeFifo(
    tx: Prisma.TransactionClient,
    userId: number,
    allianceId: number,
    points: number,
    now: Date,
  ): Promise<FifoDeduction[]> {
    // 调账等非兑换场景：不区分 sourceRole，严格按过期时间 FIFO
    const raw = await tx.$queryRaw<
      Array<{ id: bigint | number; remainingAmount: number; expireAt: Date | null; sourceRole: AllianceRole | null }>
    >(
      Prisma.sql`
        SELECT id, remainingAmount, expireAt, sourceRole
        FROM point_transactions
        WHERE userId = ${userId}
          AND allianceId = ${allianceId}
          AND type IN ('EARN', 'ADJUST', 'REFUND')
          AND remainingAmount > 0
          AND (expireAt IS NULL OR expireAt > ${now})
        ORDER BY (expireAt IS NULL), expireAt ASC, id ASC
        FOR UPDATE`,
    );
    return this.applyFifoDeductions(
      raw.map((b) => ({
        id: Number(b.id),
        remainingAmount: Number(b.remainingAmount),
        expireAt: b.expireAt,
        sourceRole: b.sourceRole,
      })),
      points,
      tx,
      false,
    );
  }

  /**
   * 兑换专用 FIFO：
   * - MAIN_ONLY（附属券）：只扣 sourceRole=MAIN，按 expireAt 升序
   * - SUB_FIRST（主体券）：先扣 SUB（受限积分优先花掉），再扣 MAIN；各自内部按 expireAt 升序
   * 历史 sourceRole IS NULL 的批次：仅在主体券路径中作为 MAIN 之后的兜底（兼容旧数据）
   */
  async consumeFifoForExchange(
    tx: Prisma.TransactionClient,
    userId: number,
    allianceId: number,
    points: number,
    now: Date,
    policy: ExchangeConsumePolicy,
  ): Promise<FifoDeduction[]> {
    const raw = await tx.$queryRaw<
      Array<{
        id: bigint | number;
        remainingAmount: number;
        expireAt: Date | null;
        sourceRole: AllianceRole | null;
      }>
    >(
      Prisma.sql`
        SELECT id, remainingAmount, expireAt, sourceRole
        FROM point_transactions
        WHERE userId = ${userId}
          AND allianceId = ${allianceId}
          AND type IN ('EARN', 'ADJUST', 'REFUND')
          AND remainingAmount > 0
          AND (expireAt IS NULL OR expireAt > ${now})
        ORDER BY (expireAt IS NULL), expireAt ASC, id ASC
        FOR UPDATE`,
    );
    const batches = raw.map((b) => ({
      id: Number(b.id),
      remainingAmount: Number(b.remainingAmount),
      expireAt: b.expireAt,
      sourceRole: b.sourceRole,
    }));

    const byExpire = (
      a: { expireAt: Date | null; id: number },
      b: { expireAt: Date | null; id: number },
    ) => {
      if (a.expireAt == null && b.expireAt == null) return a.id - b.id;
      if (a.expireAt == null) return 1;
      if (b.expireAt == null) return -1;
      const d = a.expireAt.getTime() - b.expireAt.getTime();
      return d !== 0 ? d : a.id - b.id;
    };

    let ordered: typeof batches;
    if (policy === 'MAIN_ONLY') {
      ordered = batches.filter((b) => b.sourceRole === AllianceRole.MAIN).sort(byExpire);
    } else {
      const sub = batches.filter((b) => b.sourceRole === AllianceRole.SUB).sort(byExpire);
      const main = batches.filter((b) => b.sourceRole === AllianceRole.MAIN).sort(byExpire);
      const legacy = batches.filter((b) => b.sourceRole == null).sort(byExpire);
      ordered = [...sub, ...main, ...legacy];
    }

    return this.applyFifoDeductions(ordered, points, tx, policy === 'MAIN_ONLY');
  }

  /**
   * 「逛商家」兑换的可用积分：只算这家商家发给该用户、尚未过期且没花完的批次。
   * 不再看联盟、也不再区分主体分/附属分 —— 从哪家店进，就用哪家店攒的分。
   */
  private async shopExchangePool(userId: number, merchantId: number, now: Date) {
    const rows = await this.prisma.$queryRaw<Array<{ remaining: bigint | number }>>(
      Prisma.sql`
        SELECT pt.remainingAmount AS remaining
        FROM point_transactions pt
        WHERE pt.userId = ${userId}
          AND pt.merchantId = ${merchantId}
          AND pt.type IN ('EARN', 'ADJUST', 'REFUND')
          AND pt.remainingAmount > 0
          AND (pt.expireAt IS NULL OR pt.expireAt > ${now})`,
    );
    const total = rows.reduce((sum, row) => sum + Number(row.remaining), 0);
    return { total, main: total, sub: 0 };
  }

  /**
   * 兑换可用积分池（含「桥店」跨联盟批次）。
   *
   * 判定口径：
   * - 批次记在本联盟 → 可用（原有逻辑）；
   * - 批次记在别的联盟，但**发分商家同时是本联盟成员** → 也可用。
   *   这就是「同一家店挂两个联盟时，顾客在这家店拿的分两边都能花」的落点。
   *   注意只按发分商家判断，不按当前门店：分是这家店给的，才享受这家店的桥。
   */
  private async exchangePool(userId: number, allianceId: number, now: Date) {
    const rows = await this.prisma.$queryRaw<
      Array<{ remaining: bigint | number; sourceRole: AllianceRole | null }>
    >(
      Prisma.sql`
        SELECT pt.remainingAmount AS remaining,
               COALESCE(
                 (SELECT ma.role FROM merchant_alliances ma
                  WHERE ma.allianceId = ${allianceId} AND ma.merchantId = pt.merchantId
                  LIMIT 1),
                 pt.sourceRole
               ) AS sourceRole
        FROM point_transactions pt
        WHERE pt.userId = ${userId}
          AND pt.type IN ('EARN', 'ADJUST', 'REFUND')
          AND pt.remainingAmount > 0
          AND (pt.expireAt IS NULL OR pt.expireAt > ${now})
          AND (
            pt.allianceId = ${allianceId}
            OR EXISTS (
              SELECT 1 FROM merchant_alliances ma
              WHERE ma.allianceId = ${allianceId} AND ma.merchantId = pt.merchantId
            )
          )`,
    );
    let total = 0;
    let main = 0;
    let sub = 0;
    for (const r of rows) {
      const v = Number(r.remaining);
      total += v;
      if (r.sourceRole === AllianceRole.MAIN) main += v;
      else if (r.sourceRole === AllianceRole.SUB) sub += v;
    }
    return { total, main, sub };
  }

  /**
   * 兑换专用 FIFO（跨联盟版）：
   * 与 {@link consumeFifoForExchange} 同一套策略，但批次来自多个账户，
   * 因此返回结果里带上 `accountId` / `allianceId`，供调用方把 SPEND 流水写回正确账户。
   */
  private async consumeFifoForExchangeBridge(
    tx: Prisma.TransactionClient,
    userId: number,
    allianceId: number,
    points: number,
    now: Date,
    policy: ExchangeConsumePolicy,
    merchantId?: number,
  ): Promise<Array<FifoDeduction & { accountId: number; allianceId: number }>> {
    // 商家维度：只取这家店发的批次，不看联盟；旧模式保持「本联盟 + 桥店」口径不变。
    const batchScope = merchantId
      ? Prisma.sql`AND pt.merchantId = ${merchantId}`
      : Prisma.sql`AND (
            pt.allianceId = ${allianceId}
            OR EXISTS (
              SELECT 1 FROM merchant_alliances ma
              WHERE ma.allianceId = ${allianceId} AND ma.merchantId = pt.merchantId
            )
          )`;
    const raw = await tx.$queryRaw<
      Array<{
        id: bigint | number;
        remainingAmount: number;
        expireAt: Date | null;
        sourceRole: AllianceRole | null;
        accountId: bigint | number;
        allianceId: bigint | number;
      }>
    >(
      Prisma.sql`
        SELECT pt.id, pt.remainingAmount, pt.expireAt, pt.accountId, pt.allianceId,
               COALESCE(
                 (SELECT ma.role FROM merchant_alliances ma
                  WHERE ma.allianceId = ${allianceId} AND ma.merchantId = pt.merchantId
                  LIMIT 1),
                 pt.sourceRole
               ) AS sourceRole
        FROM point_transactions pt
        WHERE pt.userId = ${userId}
          AND pt.type IN ('EARN', 'ADJUST', 'REFUND')
          AND pt.remainingAmount > 0
          AND (pt.expireAt IS NULL OR pt.expireAt > ${now})
          ${batchScope}
        ORDER BY (pt.expireAt IS NULL), pt.expireAt ASC, pt.id ASC
        FOR UPDATE`,
    );

    const batches = raw.map((b) => ({
      id: Number(b.id),
      remainingAmount: Number(b.remainingAmount),
      expireAt: b.expireAt,
      sourceRole: b.sourceRole,
      accountId: Number(b.accountId),
      allianceId: Number(b.allianceId),
    }));

    const byExpire = (
      a: { expireAt: Date | null; id: number },
      b: { expireAt: Date | null; id: number },
    ) => {
      if (a.expireAt == null && b.expireAt == null) return a.id - b.id;
      if (a.expireAt == null) return 1;
      if (b.expireAt == null) return -1;
      const d = a.expireAt.getTime() - b.expireAt.getTime();
      return d !== 0 ? d : a.id - b.id;
    };

    let ordered: typeof batches;
    if (merchantId) {
      // 本店攒的分不分主体/附属，纯按到期时间 FIFO
      ordered = [...batches].sort(byExpire);
    } else if (policy === 'MAIN_ONLY') {
      ordered = batches.filter((b) => b.sourceRole === AllianceRole.MAIN).sort(byExpire);
    } else {
      const sub = batches.filter((b) => b.sourceRole === AllianceRole.SUB).sort(byExpire);
      const main = batches.filter((b) => b.sourceRole === AllianceRole.MAIN).sort(byExpire);
      const legacy = batches.filter((b) => b.sourceRole == null).sort(byExpire);
      ordered = [...sub, ...main, ...legacy];
    }

    const available = ordered.reduce((s, b) => s + b.remainingAmount, 0);
    if (available < points) {
      if (policy === 'MAIN_ONLY') {
        throw BizException.forbidden(
          ReasonCode.SUB_COUPON_REQUIRES_MAIN_POINTS,
          `附属券只能用主体消费获得的积分兑换：需 ${points}，主体积分可用 ${available}`,
        );
      }
      throw BizException.conflict(
        ReasonCode.BALANCE_NOT_ENOUGH,
        merchantId
          ? `在这家店可用积分不足：需 ${points}，未过期可用 ${available}（别家店攒的分不能在这家用）`
          : `可用积分不足：需 ${points}，未过期批次可用 ${available}（过期积分不可用于扣减）`,
      );
    }

    const result: Array<FifoDeduction & { accountId: number; allianceId: number }> = [];
    let need = points;
    for (const b of ordered) {
      if (need <= 0) break;
      const take = Math.min(b.remainingAmount, need);
      const affected = await tx.$executeRaw(
        Prisma.sql`UPDATE point_transactions SET remainingAmount = remainingAmount - ${take} WHERE id = ${b.id} AND remainingAmount >= ${take}`,
      );
      if (affected === 0) {
        throw BizException.conflict(ReasonCode.BALANCE_NOT_ENOUGH, '积分批次并发扣减冲突，请重试');
      }
      result.push({
        txnId: b.id,
        amount: take,
        expireAt: b.expireAt,
        sourceRole: b.sourceRole,
        accountId: b.accountId,
        allianceId: b.allianceId,
      });
      need -= take;
    }
    if (need > 0) {
      throw BizException.conflict(
        ReasonCode.BALANCE_NOT_ENOUGH,
        `可用积分不足：还差 ${need} 分（FIFO 扣减中途发现批次不足）`,
      );
    }
    return result;
  }

  private async applyFifoDeductions(
    ordered: Array<{
      id: number;
      remainingAmount: number;
      expireAt: Date | null;
      sourceRole: AllianceRole | null;
      accountId?: number;
      allianceId?: number;
    }>,
    points: number,
    tx: Prisma.TransactionClient,
    mainOnly: boolean,
  ): Promise<FifoDeduction[]> {
    const available = ordered.reduce((s, b) => s + b.remainingAmount, 0);
    if (available < points) {
      if (mainOnly) {
        throw BizException.forbidden(
          ReasonCode.SUB_COUPON_REQUIRES_MAIN_POINTS,
          `附属券只能用主体消费获得的积分兑换：需 ${points}，主体积分可用 ${available}`,
        );
      }
      throw BizException.conflict(
        ReasonCode.BALANCE_NOT_ENOUGH,
        `可用积分不足：需 ${points}，未过期批次可用 ${available}（过期积分不可用于扣减）`,
      );
    }

    const deductions: FifoDeduction[] = [];
    let need = points;
    for (const b of ordered) {
      if (need <= 0) break;
      const take = Math.min(b.remainingAmount, need);
      const affected = await tx.$executeRaw(
        Prisma.sql`UPDATE point_transactions SET remainingAmount = remainingAmount - ${take} WHERE id = ${b.id} AND remainingAmount >= ${take}`,
      );
      if (affected === 0) {
        throw BizException.conflict(ReasonCode.BALANCE_NOT_ENOUGH, '积分批次并发扣减冲突，请重试');
      }
      deductions.push({
        txnId: b.id,
        amount: take,
        expireAt: b.expireAt,
        sourceRole: b.sourceRole,
      });
      need -= take;
    }
    if (need > 0) {
      throw BizException.conflict(
        ReasonCode.BALANCE_NOT_ENOUGH,
        `可用积分不足：还差 ${need} 分（FIFO 扣减中途发现批次不足）`,
      );
    }
    return deductions;
  }

  // ---------------------------------------------------------------- 退款回退 / 冲正（S3.4）

  /**
   * S3.4 方案 A：把某张积分兑换券消耗的积分**退回原 EARN 批次**（保留原 expireAt）。
   * 在调用方的事务内执行；账户乐观锁冲突抛 {@link ConcurrentSignal}（调用方整事务重试）。
   *
   * 关键点：
   *  - 兑换时每条 SPEND 都记了 `sourceTransactionId`（指向被扣的 EARN 批次），
   *    退款据此**精确还原**到原批次（而不是笼统地当成新批次退回）；
   *  - 只恢复原批次的 `remainingAmount`、不动 `expireAt`——若原批次已过期，回退后仍是过期
   *    （`consumeFifo` 只看 `expireAt > now`，不会「退款复活」）；
   *  - 新生成的 REFUND 是**台账记录**（remainingAmount=0），真正的积分在原批次里，不会重复计入。
   */
  async refundExchangePoints(
    tx: Prisma.TransactionClient,
    couponInstanceId: number,
    operatorId: number | null,
  ): Promise<{ total: number; details: Array<{ sourceTxnId: number; amount: number }> }> {
    const spends = await tx.pointTransaction.findMany({
      where: {
        relatedCouponInstanceId: couponInstanceId,
        type: PointTxnType.SPEND,
        originBatchId: { not: null },
      },
      orderBy: { id: 'asc' },
    });
    if (spends.length === 0) return { total: 0, details: [] };

    const userId = spends[0].userId;

    // 一笔兑换可能跨账户扣减（桥店通兑），回退必须按 SPEND 行自己的 accountId 回到原账户，
    // 否则积分会被记到「第一个联盟」头上，两个联盟的余额都会错。
    const accounts = new Map<number, { balance: number; version: number; delta: number }>();
    let total = 0;
    const details: Array<{ sourceTxnId: number; amount: number }> = [];

    for (const s of spends) {
      const take = -s.amount;
      const sourceId = s.originBatchId as number;
      await tx.$executeRaw(
        Prisma.sql`UPDATE point_transactions SET remainingAmount = remainingAmount + ${take} WHERE id = ${sourceId}`,
      );

      let acc = accounts.get(s.accountId);
      if (!acc) {
        const row = await tx.pointAccount.findUnique({
          where: { id: s.accountId },
          select: { balance: true, version: true },
        });
        if (!row) {
          throw BizException.conflict(
            ReasonCode.POINT_ACCOUNT_NOT_FOUND,
            `积分账户 #${s.accountId} 不存在，无法回退`,
          );
        }
        acc = { balance: row.balance, version: row.version, delta: 0 };
        accounts.set(s.accountId, acc);
      }
      acc.balance += take;
      acc.delta += take;

      await tx.pointTransaction.create({
        data: {
          userId,
          accountId: s.accountId,
          allianceId: s.allianceId,
          type: PointTxnType.REFUND,
          amount: take,
          remainingAmount: 0,
          balanceAfter: acc.balance,
          merchantId: s.merchantId,
          operatorId,
          relatedCouponInstanceId: couponInstanceId,
          originBatchId: sourceId,
          remark: `订单回退：退回批次 #${sourceId} 的 ${take} 分（保留原有效期）`,
        },
      });
      total += take;
      details.push({ sourceTxnId: sourceId, amount: take });
    }

    for (const [accountId, acc] of accounts) {
      if (acc.delta <= 0) continue;
      const affected = await tx.$executeRaw(
        Prisma.sql`UPDATE point_accounts SET balance = balance + ${acc.delta}, totalSpent = totalSpent - ${acc.delta}, version = version + 1 WHERE id = ${accountId} AND version = ${acc.version}`,
      );
      if (affected === 0) throw new ConcurrentSignal();
    }
    return { total, details };
  }

  /**
   * S3.4：在调用方事务内做负向积分冲正（走 FIFO + ADJUST 负流水 + 账户扣减）。
   * 用于异常订单「金额录入错误」场景（`amount` 为负）。账户乐观锁冲突抛 {@link ConcurrentSignal}。
   */
  async adjustInTx(
    tx: Prisma.TransactionClient,
    userId: number,
    amount: number,
    operatorId: number | null,
    reason: string,
  ): Promise<{ balanceAfter: number }> {
    const points = Math.abs(amount);
    const now = new Date();
    const allianceId = DEFAULT_ALLIANCE_ID;
    await this.consumeFifo(tx, userId, allianceId, points, now);
    const account = await this.ensureAccount(tx, userId, allianceId);
    const balanceAfter = account.balance - points;
    await tx.pointTransaction.create({
      data: {
        userId,
        accountId: account.id,
        allianceId,
        type: PointTxnType.ADJUST,
        amount: -points,
        remainingAmount: 0,
        balanceAfter,
        operatorId,
        remark: reason,
      },
    });
    const affected = await tx.$executeRaw(
      Prisma.sql`UPDATE point_accounts SET balance = balance - ${points}, totalSpent = totalSpent + ${points}, version = version + 1 WHERE id = ${account.id} AND version = ${account.version}`,
    );
    if (affected === 0) throw new ConcurrentSignal();
    return { balanceAfter };
  }

  // ---------------------------------------------------------------- 内部工具

  /** 账户不存在则建（按 userId + allianceId 分池），返回带 version 的账户 */
  private async ensureAccount(
    tx: Prisma.TransactionClient,
    userId: number,
    allianceId: number = DEFAULT_ALLIANCE_ID,
  ) {
    return tx.pointAccount.upsert({
      where: { userId_allianceId: { userId, allianceId } },
      create: { userId, allianceId },
      update: {},
    });
  }

  /**
   * 解析消费归属：商家 / 门店由 JWT 推导，**不信任入参**
   * （商家传别家 merchantId → 403；店员传别家门店 → 403）。
   */
  private async resolveMerchantStore(dto: EarnPointsDto, user: JwtPayload) {
    if (user.userType === 'PLATFORM') {
      const merchantId = dto.merchantId;
      if (!merchantId) {
        throw BizException.badRequest(ReasonCode.MERCHANT_ID_REQUIRED, '平台管理员录单必须指定 merchantId');
      }
      return this.assertStore(merchantId, dto.storeId ?? null);
    }

    if (user.userType === 'STORE') {
      if (!user.storeId) {
        throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '店员账号未绑定门店');
      }
      const store = await this.prisma.store.findUnique({
        where: { id: user.storeId },
        select: { id: true, merchantId: true },
      });
      if (!store) {
        throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '店员绑定的门店不存在');
      }
      if (dto.storeId && dto.storeId !== store.id) {
        throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, '店员只能录本门店的消费');
      }
      if (dto.merchantId && dto.merchantId !== store.merchantId) {
        throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权为其他商家录单送积分');
      }
      return { merchantId: store.merchantId, storeId: store.id };
    }

    // MERCHANT（主体 / 附属）
    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '账号未关联商家');
    }
    if (dto.merchantId && dto.merchantId !== merchantId) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权为其他商家录单送积分');
    }
    return this.assertStore(merchantId, dto.storeId ?? null);
  }

  /**
   * 门店必须属于该商家（不传门店则只认商家）。
   * **主体商家可以用直属附属的门店**（与券核销同口径：消费确实发生在门店，积分归属仍是门店所属商家）
   * ——注意积分记在**门店所属商家**名下，不是录单人商家，否则对账时门店维度会对不上。
   */
  private async assertStore(merchantId: number, storeId: number | null) {
    if (!storeId) return { merchantId, storeId: null };
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { id: true, merchantId: true, merchant: { select: { id: true, parentId: true } } },
    });
    if (!store) {
      throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, `门店 #${storeId} 不存在`);
    }
    const own = store.merchantId === merchantId;
    const childOfMine = store.merchant?.parentId === merchantId;
    if (!own && !childOfMine) {
      throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, `门店 #${storeId} 不属于商家 #${merchantId} 及其附属`);
    }
    // 积分记在门店所属商家名下（对账口径：消费发生在哪家店，积分就算哪家的）
    return { merchantId: store.merchantId, storeId };
  }

  /** 订单解析：orderId / orderNo 二选一（缺失由调用方按 ORDER_ID_REQUIRED 处理）；订单不存在 → 404；归属不符 → 400 */
  private async resolveOrder(dto: EarnPointsDto) {
    let order = null;
    if (dto.orderId) {
      order = await this.prisma.order.findUnique({
        where: { id: dto.orderId },
        select: { id: true, orderNo: true, userId: true },
      });
      if (!order) {
        throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `订单 #${dto.orderId} 不存在`);
      }
    } else if (dto.orderNo) {
      order = await this.prisma.order.findUnique({
        where: { orderNo: dto.orderNo },
        select: { id: true, orderNo: true, userId: true },
      });
      if (!order) {
        throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `订单 ${dto.orderNo} 不存在`);
      }
    }
    if (order && order.userId !== dto.userId) {
      throw BizException.badRequest(
        ReasonCode.RESOURCE_NOT_FOUND,
        `订单 ${order.orderNo} 不属于用户 #${dto.userId}，不能给他送积分`,
      );
    }
    return order;
  }

  // ---------------------------------------------------------------- 发分预览（AI 协同）

  /**
   * 发分预览：与 earn() 共用同一套规则引擎，算出「这笔消费该发多少分」，但不落库、不写流水。
   *
   * 为什么必须由后端算：AI 协同发分时，若让模型自己折算积分，会出现
   * 「建议发 168 分、实际入账 100 分」的口径分裂，商家会直接失去信任。
   * 所以模型只负责理解与组织语言，积分数字永远来自这里。
   *
   * 与 earn() 的差异：不写订单、不写流水、不因不可发分而抛错（改为返回 blocked + reason 供前端提示）。
   */
  async previewEarn(
    input: {
      userId: number;
      amount: number;
      allianceId: number;
      merchantId?: number;
      storeId?: number | null;
    },
    user: JwtPayload,
  ) {
    const allianceId = Number(input.allianceId);
    const amount = Number(input.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw BizException.badRequest('INVALID_AMOUNT', '消费金额必须大于 0');
    }

    const alliance = await this.prisma.alliance.findUnique({
      where: { id: allianceId },
      select: { id: true, name: true },
    });
    if (!alliance) {
      throw BizException.notFound(ReasonCode.ALLIANCE_NOT_FOUND, `联盟 #${allianceId} 不存在`);
    }

    const { merchantId, storeId } = await this.resolveMerchantStore(
      {
        merchantId: input.merchantId,
        storeId: input.storeId ?? undefined,
      } as unknown as EarnPointsDto,
      user,
    );

    const membership = await this.prisma.merchantAlliance.findUnique({
      where: { merchantId_allianceId: { merchantId, allianceId } },
      select: { role: true },
    });
    if (!membership) {
      throw BizException.forbidden(
        ReasonCode.MERCHANT_NOT_IN_ALLIANCE,
        `商家 #${merchantId} 不属于联盟「${alliance.name}」`,
      );
    }

    const target = await this.prisma.user.findUnique({
      where: { id: input.userId },
      select: { id: true },
    });
    if (!target) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `用户 #${input.userId} 不存在`);
    }

    const rule = await this.resolveRule(allianceId, merchantId);
    const earnRatio = Number(rule.earnRatio);
    const minAmount = Number(rule.minAmount);
    const raw = Math.floor(amount * earnRatio);

    let blocked = false;
    let reasonCode: string | null = null;
    let reason: string | null = null;
    if (amount < minAmount) {
      blocked = true;
      reasonCode = 'BELOW_MIN_AMOUNT';
      reason = `消费 ${amount} 元未达起送金额 ${minAmount} 元，本次不送积分`;
    } else if (raw <= 0) {
      blocked = true;
      reasonCode = 'POINTS_ZERO';
      reason = `按 ${earnRatio} 分/元折算为 0 分`;
    }

    return {
      allianceId,
      allianceName: alliance.name,
      merchantId,
      storeId,
      amount,
      points: blocked ? 0 : raw,
      earnRatio,
      minAmount,
      pointsValidMonths: rule.pointsValidMonths,
      sourceRole: membership.role,
      blocked,
      reasonCode,
      reason,
    };
  }

  /**
   * 积分规则（多联盟）：先找该联盟下商家专属规则，再找联盟默认（merchantId=0）。
   * 都没有 → 1 元 = 1 分兜底（带 allianceId）。
   */
  private async resolveRule(allianceId: number, merchantId: number | null) {
    if (merchantId) {
      const merchantRule = await this.prisma.pointRule.findFirst({
        where: { allianceId, merchantId, status: 1 },
        orderBy: { id: 'desc' },
      });
      if (merchantRule) return merchantRule;
    }
    const allianceDefault = await this.prisma.pointRule.findFirst({
      where: { allianceId, merchantId: 0, status: 1 },
      orderBy: { id: 'desc' },
    });
    if (allianceDefault) return allianceDefault;
    return {
      id: 0,
      allianceId,
      merchantId: 0,
      earnRatio: new Prisma.Decimal(1),
      minAmount: new Prisma.Decimal(0),
      pointsValidMonths: 12,
      expireMode: ExpireMode.FIXED_MONTHS,
      effectiveAt: new Date(),
      status: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
  }

  /** 无订单时自动建一笔消费单，orderNo 优先用 requestId，保证前端防重。 */
  private async ensureScanOrder(p: {
    userId: number;
    amount: number;
    merchantId: number;
    storeId: number | null;
    requestId?: string;
    orderNo?: string;
    remark?: string;
  }) {
    const orderNo = (p.requestId || p.orderNo || `SM${Date.now()}${Math.floor(Math.random() * 1000)}`).slice(0, 32);
    const existing = await this.prisma.order.findUnique({
      where: { orderNo },
      select: { id: true, orderNo: true, userId: true },
    });
    if (existing) {
      if (existing.userId !== p.userId) {
        throw BizException.badRequest(
          ReasonCode.RESOURCE_NOT_FOUND,
          `订单 ${existing.orderNo} 不属于用户 #${p.userId}，不能给他送积分`,
        );
      }
      return existing;
    }
    return this.prisma.order.create({
      data: {
        orderNo,
        userId: p.userId,
        merchantId: p.merchantId,
        storeId: p.storeId,
        orderType: OrderType.CONSUME,
        totalAmount: p.amount,
        payAmount: p.amount,
        discountAmount: 0,
        source: OrderSource.APPLET,
        status: OrderStatus.NORMAL,
      },
      select: { id: true, orderNo: true, userId: true },
    });
  }

  /** 券有效期：FIXED 用 validEnd；AFTER_RECEIVE_DAYS 按兑换时刻 + N 天（与券发放同口径） */
  private computeCouponExpireAt(
    template: { validType: string; validEnd: Date | null; validDays: number },
    now: Date,
  ): Date {
    if (template.validType === 'FIXED') {
      const end = template.validEnd ?? new Date(now.getTime() + template.validDays * 86400_000);
      return end.getTime() > now.getTime() ? end : now;
    }
    return new Date(now.getTime() + (template.validDays || 30) * 86400_000);
  }

  /** 有效期计算：FIXED_MONTHS 按自然月；YEAR_END 到当年 12-31 23:59:59 */
  private computeExpireAt(rule: { pointsValidMonths: number; expireMode: ExpireMode }, now: Date): Date {
    if (rule.expireMode === ExpireMode.YEAR_END) {
      return new Date(Date.UTC(now.getUTCFullYear(), 11, 31, 23, 59, 59));
    }
    const d = new Date(now);
    d.setMonth(d.getMonth() + rule.pointsValidMonths);
    return d;
  }

  /**
   * 流水可见范围：平台全量 / 商家=自己+直属附属（**含无归属的人工调整**）/ 店员=本店。
   *
   * 为什么商家视角要额外放行 `merchantId: null`：人工调整（ADJUST）是运营动作、不挂商家，
   * 若按商家过滤，主体商家反而看不到自己刚做的调账——过滤是为了隔离别人，不是为了藏自己的操作。
   * 店员视角仍然严格只看本店（不给他看跨店调账）。
   */
  private async scopeFilter(user: JwtPayload): Promise<Prisma.PointTransactionWhereInput> {
    if (user.userType === 'PLATFORM') return {};

    if (user.userType === 'STORE') {
      if (!user.storeId) return { id: -1 };
      return { storeId: user.storeId };
    }

    const merchantId = user.merchantId;
    if (!merchantId) return { id: -1 };
    const merchants = await this.prisma.merchant.findMany({
      where: { OR: [{ id: merchantId }, { parentId: merchantId }] },
      select: { id: true, type: true },
    });
    const ids = merchants.map((m) => m.id);
    const self = merchants.find((m) => m.id === merchantId);
    // 只有**主体商家**才看得到无商家归属的流水（人工调整）：
    // 调账是主体运营动作，附属商家没有理由看到主体给他用户做的调账。
    if (self?.type === MerchantType.MAIN) {
      return { OR: [{ merchantId: { in: ids } }, { merchantId: null }] };
    }
    return { merchantId: { in: ids } };
  }

  /** 可见商家 id 列表（用于拒绝「指定别人 merchantId」的查询）；平台返回 null 表示不限 */
  private async visibleMerchantIds(user: JwtPayload): Promise<number[] | null> {
    if (user.userType === 'PLATFORM') return null;
    if (user.userType === 'STORE') {
      if (!user.storeId) return [];
      const store = await this.prisma.store.findUnique({
        where: { id: user.storeId },
        select: { merchantId: true },
      });
      return store ? [store.merchantId] : [];
    }
    const merchantId = user.merchantId;
    if (!merchantId) return [];
    const merchants = await this.prisma.merchant.findMany({
      where: { OR: [{ id: merchantId }, { parentId: merchantId }] },
      select: { id: true },
    });
    return merchants.map((m) => m.id);
  }

  /**
   * 可写口径的用户校验（人工调整用）
   *
   * - 平台管理员：不限；
   * - **主体商家**：不限 —— 积分是主体的负债，给谁加、给谁扣是自己说了算的事；
   * - 附属商家 / 店员：只能动「在自己体系内产生过积分流水」的用户（否则等于能凭空给任意用户送积分）。
   */
  private async assertWritableUser(userId: number, user: JwtPayload) {
    if (user.userType === 'PLATFORM') return;
    if (user.userType === 'MERCHANT' && user.merchantId) {
      const self = await this.prisma.merchant.findUnique({
        where: { id: user.merchantId },
        select: { type: true },
      });
      if (self?.type === MerchantType.MAIN) return;
    }
    await this.assertUserVisible(userId, user);
  }

  /** 账户 / 流水维度的用户可见性校验：越权 → 403（不泄露「该用户是否存在」） */
  private async assertUserVisible(userId: number, user: JwtPayload) {
    if (user.userType === 'PLATFORM') return;
    const scope = await this.scopeFilter(user);
    const hit = await this.prisma.pointTransaction.findFirst({
      where: { userId, ...scope },
      select: { id: true },
    });
    if (!hit) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权查看该用户的积分数据');
    }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 唯一约束冲突：Prisma P2002，或 MySQL 1062（走 $executeRaw 时） */
function isUniqueViolation(e: unknown): boolean {
  const code = (e as { code?: string })?.code;
  const msg = (e as Error)?.message ?? '';
  return code === 'P2002' || msg.includes('Duplicate entry');
}

/**
 * 是否**精确**命中「同一订单只送一次」的唯一索引 `uniq_point_earn_order(relatedOrderId, type)`。
 * 用于把 P2002 精确分类：只有这个唯一键才代表「订单已送分」，其它唯一键（如并发建账户）
 * 不应被误报为 ORDER_POINTS_ALREADY_EARNED（S4 收口教训）。
 */
function isEarnOrderUniqueViolation(e: unknown): boolean {
  if (!isUniqueViolation(e)) return false;
  const target = (e as { meta?: { target?: unknown } })?.meta?.target;
  const s = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return s.includes('relatedOrderId') || s.includes('uniq_point_earn_order');
}

/** 是否精确命中积分规则唯一索引 `point_rules(merchantId, status)` */
function isPointRuleUniqueViolation(e: unknown): boolean {
  if (!isUniqueViolation(e)) return false;
  const target = (e as { meta?: { target?: unknown } })?.meta?.target;
  const s = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return s.includes('point_rules') || s.includes('merchantId');
}

/**
 * 瞬时锁错误：MySQL 1213（死锁）/ 1205（锁等待超时）/ Prisma P2034（写冲突或死锁）。
 * 这类错误**不代表业务规则拒绝**，重试一次通常就过了；不重试就会变成 500。
 */
function isTransientLockError(e: unknown): boolean {
  const msg = (e as Error)?.message ?? '';
  const code = (e as { code?: string })?.code;
  return (
    code === 'P2034' ||
    msg.includes('Deadlock found') ||
    msg.includes('Lock wait timeout') ||
    msg.includes('deadlock detected')
  );
}
