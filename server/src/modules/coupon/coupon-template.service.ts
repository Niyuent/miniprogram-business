import { Injectable, Logger } from '@nestjs/common';
import {
  AuthStatus,
  AuthType,
  CouponInstanceStatus,
  CouponOwnerType,
  CouponTemplateStatus,
  MerchantStatus,
  MerchantType,
  Prisma,
} from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import {
  ApplyScopeValue,
  CreateCouponTemplateDto,
  OwnerTypeValue,
  QueryCouponTemplatesDto,
  TemplateStatusValue,
  UpdateCouponTemplateDto,
  ValidTypeValue,
} from './dto/coupon-template.dto';
import {
  parseApplicableScope,
  resolveAdvancedFromDto,
  type CouponApplicableScope,
} from './coupon-advanced';

/** 列表 / 详情统一视图，前后端字段一致（金额转 number，避免 Decimal 序列化成字符串） */
export interface CouponTemplateView {
  id: number;
  name: string;
  subtitle: string | null;
  ownerType: string;
  ownerMerchantId: number;
  ownerMerchantName: string | null;
  creatorMerchantId: number;
  couponType: string;
  faceValue: number;
  thresholdAmount: number;
  pointsCost: number;
  /** 是否参与积分兑换（商家自选开关） */
  exchangeEnabled: boolean;
  purchasePrice: number;
  totalStock: number;
  issuedCount: number;
  usedCount: number;
  remainingStock: number;
  validType: string;
  validStart: Date | null;
  validEnd: Date | null;
  validDays: number;
  applyScope: string;
  storeIds: number[];
  stores: Array<{ id: number; name: string }>;
  /** 每人限领（limit_per_user）；0=不限 */
  perUserLimit: number;
  limitPerUser: number;
  requireGreaterThanFace: boolean;
  applicableScope: CouponApplicableScope | null;
  status: CouponTemplateStatus;
  /** 是否允许编辑（仅 DRAFT / UNPUBLISHED）——前端直接拿它决定按钮显隐 */
  editable: boolean;
  description: string | null;
  rules: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** 券效果看板（列表 / 详情） */
export interface CouponEffectStats {
  issuedCount: number;
  totalStock: number;
  redeemedCount: number;
  /** 带动实付总额：关联订单 payAmount 之和 */
  drivenPayAmount: number;
  /** 让利总额：成功核销面值之和（≈ 核销数 × 面值） */
  discountTotal: number;
}

/** 审计动作名（写入 audit_logs.action，GET /audit-logs?module=coupon 可按此过滤） */
const ACTION = {
  create: 'coupon:create',
  update: 'coupon:update',
  publish: 'coupon:publish',
  unpublish: 'coupon:unpublish',
} as const;

/**
 * 券模板管理（S2.1）
 *
 * 与 docs/04 硬约束 H1 对应的三条红线：
 *
 * 1. **创建者必须是主体商家（H1）**：`create` 一律以「调用方所属主体」写 creatorMerchantId，
 *    附属商家账号进来直接 403 `COUPON_CREATOR_NOT_MAIN`（而不是靠前端隐藏按钮）。
 * 2. **可见性按身份收敛**：主体看「自己创建 + 自己拥有」；附属看「自己拥有 + 被授权且已上架的主体券」，
 *    越权指定 `ownerMerchantId` 一律 403 而不是静默忽略。
 * 3. **上架后才可用**：新建一律 DRAFT，必须显式 publish；PUBLISHED 不允许改字段（先下架），
 *    避免「改了面值但用户手上的券还在按旧面值算」。
 *
 * S2.2 的发放 / 核销会复用这里的 `assertOwnerVisible()` 做模板归属校验。
 */
@Injectable()
export class CouponTemplateService {
  private readonly logger = new Logger('CouponTemplate');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- 查询

  /**
   * 券模板列表
   *
   * 可见范围：
   * - 平台管理员：全部（可用 ownerMerchantId 过滤）；
   * - 主体商家：自己创建的（含代附属商家建的券）+ 自己拥有的；
   * - 附属商家：自己拥有的 + 「发放主体商家代金券」授权范围内的**已上架主体券**。
   */
  async list(query: QueryCouponTemplatesDto, user: JwtPayload) {
    const { where, keyword } = await this.buildVisibleWhere(query, user);

    const whereFull: Prisma.CouponTemplateWhereInput = {
      ...where,
      ...(keyword ? { OR: [{ name: { contains: keyword } }, { subtitle: { contains: keyword } }] } : {}),
      ...(query.ownerType ? { ownerType: query.ownerType as CouponOwnerType } : {}),
      ...(query.status ? { status: query.status as CouponTemplateStatus } : {}),
      ...(query.ownerMerchantId ? { ownerMerchantId: query.ownerMerchantId } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.couponTemplate.findMany({
        where: whereFull,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          ownerMerchant: { select: { id: true, name: true } },
          stores: { select: { store: { select: { id: true, name: true } } } },
        },
      }),
      this.prisma.couponTemplate.count({ where: whereFull }),
    ]);

    // S2.4：列表要显示「已发放 / 已核销」。模板上的 issuedCount / usedCount 是**冗余计数**
    // （发放、核销、冲正时原子自增自减），这里再用 coupon_instances 实算一次做对照：
    // 一旦两者不一致（历史数据、脚本修数、异常中断），列表页能立刻看出来，而不是默默信任计数。
    const ids = rows.map((r) => r.id);
    const [realCount, effectMap] = await Promise.all([
      this.prisma.couponInstance.groupBy({
        by: ['templateId', 'status'],
        where: { templateId: { in: ids } },
        _count: { _all: true },
      }),
      this.loadEffectStats(ids),
    ]);
    const statsMap = new Map<number, { issued: number; used: number; unused: number; frozen: number; expired: number }>();
    for (const row of realCount) {
      const item =
        statsMap.get(row.templateId) ?? { issued: 0, used: 0, unused: 0, frozen: 0, expired: 0 };
      item.issued += row._count._all;
      if (row.status === CouponInstanceStatus.USED) item.used += row._count._all;
      if (row.status === CouponInstanceStatus.UNUSED) item.unused += row._count._all;
      if (row.status === CouponInstanceStatus.FROZEN) item.frozen += row._count._all;
      if (row.status === CouponInstanceStatus.EXPIRED) item.expired += row._count._all;
      statsMap.set(row.templateId, item);
    }

    return {
      list: rows.map((row) => {
        const real = statsMap.get(row.id) ?? { issued: 0, used: 0, unused: 0, frozen: 0, expired: 0 };
        const effect = effectMap.get(row.id);
        return {
          ...this.toView(row),
          // 实算统计（groupBy）+ 与冗余计数的偏差标记。
          // 命名 `instanceStats` 而非 `stats`：详情接口的 `stats` 是「券码 / 券实例分状态统计」，两者含义不同。
          instanceStats: {
            issuedCount: real.issued,
            usedCount: real.used,
            unusedCount: real.unused,
            frozenCount: real.frozen,
            expiredCount: real.expired,
            drift: {
              issued: real.issued !== row.issuedCount,
              used: real.used !== row.usedCount,
            },
          },
          effectStats: {
            issuedCount: real.issued,
            totalStock: row.totalStock,
            redeemedCount: effect?.redeemedCount ?? real.used,
            drivenPayAmount: effect?.drivenPayAmount ?? 0,
            discountTotal: effect?.discountTotal ?? Number((real.used * Number(row.faceValue)).toFixed(2)),
          } satisfies CouponEffectStats,
        };
      }),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 券模板详情：视图字段 + 券码/券实例统计（不分页，够用且避免多余往返） */
  async detail(id: number, user: JwtPayload) {
    const template = await this.prisma.couponTemplate.findUnique({
      where: { id },
      include: {
        ownerMerchant: { select: { id: true, name: true, code: true } },
        stores: { select: { store: { select: { id: true, name: true, merchantId: true } } } },
      },
    });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${id} 不存在`);
    }
    await this.assertVisible(template, user);

    const [codes, instances] = await Promise.all([
      this.prisma.couponCode.groupBy({
        by: ['status'],
        where: { templateId: id },
        _count: { _all: true },
      }),
      this.prisma.couponInstance.groupBy({
        by: ['status'],
        where: { templateId: id },
        _count: { _all: true },
      }),
    ]);

    const toRecord = (rows: Array<{ status: string; _count: { _all: number } }>) =>
      rows.reduce<Record<string, number>>((acc, r) => {
        acc[r.status] = r._count._all;
        return acc;
      }, {});

    const effectMap = await this.loadEffectStats([id]);
    const effect = effectMap.get(id);
    const used = instances.find((i) => i.status === CouponInstanceStatus.USED)?._count._all ?? 0;
    const issued = instances.reduce((s, i) => s + i._count._all, 0);

    return {
      ...this.toView(template),
      stats: {
        codes: toRecord(codes),
        instances: toRecord(instances),
      },
      effectStats: {
        issuedCount: issued,
        totalStock: template.totalStock,
        redeemedCount: effect?.redeemedCount ?? used,
        drivenPayAmount: effect?.drivenPayAmount ?? 0,
        discountTotal:
          effect?.discountTotal ?? Number((used * Number(template.faceValue)).toFixed(2)),
      } satisfies CouponEffectStats,
    };
  }

  /**
   * 券效果明细：哪些用户核销了这张券、实付多少
   */
  async effectDetails(
    id: number,
    user: JwtPayload,
    query: { page?: number; pageSize?: number } = {},
  ) {
    const template = await this.prisma.couponTemplate.findUnique({ where: { id } });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${id} 不存在`);
    }
    await this.assertVisible(template, user);

    const page = Math.max(1, query.page ?? 1);
    const pageSize = Math.min(100, Math.max(1, query.pageSize ?? 20));
    const where = { templateId: id, status: 'SUCCESS' as const };

    const [rows, total] = await Promise.all([
      this.prisma.redemptionRecord.findMany({
        where,
        orderBy: { redeemedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          user: { select: { id: true, nickname: true, phone: true } },
        },
      }),
      this.prisma.redemptionRecord.count({ where }),
    ]);

    const orderIds = rows.map((r) => r.orderId).filter((x): x is number => !!x);
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds } },
          select: { id: true, orderNo: true, payAmount: true, totalAmount: true },
        })
      : [];
    const orderMap = new Map(orders.map((o) => [o.id, o]));

    return {
      list: rows.map((r) => {
        const ord = r.orderId ? orderMap.get(r.orderId) : undefined;
        return {
          redemptionId: r.id,
          code: r.code,
          userId: r.userId,
          userName: r.user?.nickname ?? null,
          userPhone: r.user?.phone ?? null,
          faceValue: Number(r.faceValue),
          discountAmount: Number(r.discountAmount),
          orderId: r.orderId,
          orderNo: ord?.orderNo ?? null,
          payAmount: ord ? Number(ord.payAmount) : null,
          totalAmount: ord ? Number(ord.totalAmount) : null,
          redeemedAt: r.redeemedAt,
          storeId: r.storeId,
          merchantId: r.merchantId,
        };
      }),
      total,
      page,
      pageSize,
    };
  }

  /** 批量加载券效果：核销数 / 带动实付 / 让利总额 */
  private async loadEffectStats(
    templateIds: number[],
  ): Promise<Map<number, { redeemedCount: number; drivenPayAmount: number; discountTotal: number }>> {
    const map = new Map<number, { redeemedCount: number; drivenPayAmount: number; discountTotal: number }>();
    if (!templateIds.length) return map;

    const rows = await this.prisma.$queryRaw<
      Array<{
        templateId: number;
        redeemedCount: bigint | number;
        drivenPayAmount: Prisma.Decimal | number | null;
        discountTotal: Prisma.Decimal | number | null;
      }>
    >(Prisma.sql`
      SELECT
        r.templateId AS templateId,
        COUNT(*) AS redeemedCount,
        COALESCE(SUM(o.payAmount), 0) AS drivenPayAmount,
        COALESCE(SUM(r.faceValue), 0) AS discountTotal
      FROM redemption_records r
      LEFT JOIN orders o ON o.id = r.orderId
      WHERE r.status = 'SUCCESS' AND r.templateId IN (${Prisma.join(templateIds)})
      GROUP BY r.templateId
    `);

    for (const row of rows) {
      map.set(Number(row.templateId), {
        redeemedCount: Number(row.redeemedCount),
        drivenPayAmount: Number(row.drivenPayAmount ?? 0),
        discountTotal: Number(row.discountTotal ?? 0),
      });
    }
    return map;
  }

  // ---------------------------------------------------------------- 写操作

  /** 创建券模板：**始终以调用方主体身份创建**（H1），初始状态固定 DRAFT */
  async create(dto: CreateCouponTemplateDto, user: JwtPayload, ip?: string, ua?: string) {
    const main = await this.resolveMainMerchant(user, dto.mainMerchantId);
    const owner = await this.resolveOwner(dto.ownerType, dto.ownerMerchantId, main.id);

    const input = this.normalize(dto, { isUpdate: false });
    if (input.validType === 'FIXED' && input.validStart && input.validEnd) {
      this.assertValidPeriod(input.validStart, input.validEnd);
    }

    const storeIds = await this.assertStores(input.applyScope, dto.storeIds, owner.id);

    const advanced = resolveAdvancedFromDto({
      rules: dto.rules,
      perUserLimit: dto.perUserLimit,
      requireGreaterThanFace: dto.requireGreaterThanFace,
      applicableScope: dto.applicableScope
        ? parseApplicableScope(dto.applicableScope) ?? undefined
        : undefined,
    });

    // 券归属联盟由「券归属商家」所在的联盟决定，而不是按盟主 main 的层级硬套。
    // 旧实现会把其它联盟（含联盟 2 的盟主）建的券全挂到联盟 1，导致那些商城为空。
    // 桥店同属多联盟时，优先其作为盟主的联盟。
    const ownerMemberships = await this.prisma.merchantAlliance.findMany({
      where: { merchantId: owner.id },
      select: { allianceId: true, role: true },
      orderBy: { allianceId: 'asc' },
    });
    const allianceId =
      ownerMemberships.find((m) => m.role === 'MAIN')?.allianceId ??
      ownerMemberships[0]?.allianceId ??
      1;

    const data: Prisma.CouponTemplateCreateInput = {
      alliance: { connect: { id: allianceId } },
      creatorMerchant: { connect: { id: main.id } },
      ownerMerchant: { connect: { id: owner.id } },
      ownerType: (dto.ownerType as CouponOwnerType) ?? CouponOwnerType.MAIN_COUPON,
      name: dto.name.trim(),
      subtitle: dto.subtitle?.trim() || null,
      couponType: dto.couponType as never,
      faceValue: dto.faceValue,
      thresholdAmount: dto.thresholdAmount ?? 0,
      pointsCost: dto.pointsCost ?? 0,
      exchangeEnabled: dto.exchangeEnabled ?? true,
      purchasePrice: dto.purchasePrice ?? 0,
      totalStock: dto.totalStock,
      validType: input.validType as never,
      validStart: input.validStart ?? null,
      validEnd: input.validEnd ?? null,
      validDays: input.validDays,
      applyScope: input.applyScope as never,
      perUserLimit: advanced.perUserLimit,
      requireGreaterThanFace: advanced.requireGreaterThanFace,
      applicableScope: advanced.applicableScope as unknown as Prisma.InputJsonValue,
      // 一律先落草稿：上架是独立动作，避免「建出来就能被发出去」
      status: CouponTemplateStatus.DRAFT,
      description: dto.description?.trim() || null,
      rules: advanced.humanRules,
      ...(storeIds.length ? { stores: { create: storeIds.map((storeId) => ({ storeId })) } } : {}),
    };

    const template = await this.prisma.$transaction(async (tx) => {
      const created = await tx.couponTemplate.create({
        data,
        include: {
          ownerMerchant: { select: { id: true, name: true } },
          stores: { select: { store: { select: { id: true, name: true } } } },
        },
      });

      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'coupon',
          action: ACTION.create,
          targetType: 'coupon_template',
          targetId: created.id,
          before: null,
          after: this.snapshot(created, storeIds),
          ip: ip ?? null,
          userAgent: ua ?? null,
        },
        tx,
      );

      return created;
    });

    return { template: this.toView(template) };
  }

  /** 编辑券模板：仅 DRAFT / UNPUBLISHED 可改，PUBLISHED 必须先下架 */
  async update(
    id: number,
    dto: UpdateCouponTemplateDto,
    user: JwtPayload,
    ip?: string,
    ua?: string,
  ) {
    const template = await this.prisma.couponTemplate.findUnique({
      where: { id },
      include: { stores: { select: { storeId: true } } },
    });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${id} 不存在`);
    }
    await this.assertOwnedByMyMain(template, user);
    this.assertEditable(template.status);

    const merged = this.merge(template, dto);
    if (merged.validType === 'FIXED') {
      this.assertValidPeriod(merged.validStart, merged.validEnd);
    }
    const nextTotalStock = dto.totalStock ?? template.totalStock;
    if (nextTotalStock < template.issuedCount) {
      throw BizException.badRequest(
        ReasonCode.STOCK_BELOW_ISSUED,
        `发行总量不能小于已发放数量（当前已发放 ${template.issuedCount} 张）`,
      );
    }
    const storeIds = await this.assertStores(merged.applyScope, dto.storeIds, template.ownerMerchantId);

    const advancedTouched =
      dto.rules !== undefined ||
      dto.perUserLimit !== undefined ||
      dto.requireGreaterThanFace !== undefined ||
      dto.applicableScope !== undefined;
    const advanced = advancedTouched
      ? resolveAdvancedFromDto({
          rules: dto.rules !== undefined ? dto.rules : template.rules,
          perUserLimit: dto.perUserLimit,
          requireGreaterThanFace: dto.requireGreaterThanFace,
          applicableScope: dto.applicableScope
            ? parseApplicableScope(dto.applicableScope) ?? undefined
            : parseApplicableScope(template.applicableScope) ?? undefined,
        })
      : null;

    const data: Prisma.CouponTemplateUpdateInput = {
      name: dto.name?.trim(),
      subtitle: dto.subtitle === undefined ? undefined : dto.subtitle.trim() || null,
      faceValue: dto.faceValue,
      thresholdAmount: dto.thresholdAmount,
      pointsCost: dto.pointsCost,
      exchangeEnabled: dto.exchangeEnabled,
      purchasePrice: dto.purchasePrice,
      totalStock: dto.totalStock,
      validType: merged.validType as never,
      validStart: merged.validType === 'FIXED' ? merged.validStart : null,
      validEnd: merged.validType === 'FIXED' ? merged.validEnd : null,
      validDays: merged.validDays,
      applyScope: merged.applyScope as never,
      ...(advanced
        ? {
            perUserLimit: advanced.perUserLimit,
            requireGreaterThanFace: advanced.requireGreaterThanFace,
            applicableScope: advanced.applicableScope as unknown as Prisma.InputJsonValue,
            rules: advanced.humanRules,
          }
        : {}),
      description: dto.description === undefined ? undefined : dto.description.trim() || null,
      ...(dto.applyScope !== undefined
        ? {
            stores: {
              deleteMany: {},
              ...(storeIds.length ? { create: storeIds.map((storeId) => ({ storeId })) } : {}),
            },
          }
        : {}),
    };

    const before = this.snapshot(
      template,
      template.stores.map((s) => s.storeId),
    );

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.couponTemplate.update({
        where: { id },
        data,
        include: {
          ownerMerchant: { select: { id: true, name: true } },
          stores: { select: { store: { select: { id: true, name: true } } } },
        },
      });

      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'coupon',
          action: ACTION.update,
          targetType: 'coupon_template',
          targetId: id,
          before,
          after: this.snapshot(row, storeIds.length ? storeIds : template.stores.map((s) => s.storeId)),
          ip: ip ?? null,
          userAgent: ua ?? null,
        },
        tx,
      );

      return row;
    });

    return { template: this.toView(updated) };
  }

  /** 上架：DRAFT / UNPUBLISHED → PUBLISHED */
  async publish(id: number, user: JwtPayload, ip?: string, ua?: string) {
    return this.changeStatus(id, CouponTemplateStatus.PUBLISHED, user, ip, ua);
  }

  /** 下架：PUBLISHED → UNPUBLISHED */
  async unpublish(id: number, user: JwtPayload, ip?: string, ua?: string) {
    return this.changeStatus(id, CouponTemplateStatus.UNPUBLISHED, user, ip, ua);
  }

  private async changeStatus(id: number, target: TemplateStatusValue, user: JwtPayload, ip?: string, ua?: string) {
    const template = await this.prisma.couponTemplate.findUnique({
      where: { id },
      include: { stores: { select: { storeId: true } } },
    });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${id} 不存在`);
    }
    await this.assertOwnedByMyMain(template, user);

    const publishing = target === 'PUBLISHED';
    if (publishing && template.status === CouponTemplateStatus.PUBLISHED) {
      throw BizException.conflict(ReasonCode.TEMPLATE_ALREADY_PUBLISHED, '该券模板已处于上架状态');
    }
    if (!publishing && template.status !== CouponTemplateStatus.PUBLISHED) {
      throw BizException.conflict(
        ReasonCode.TEMPLATE_NOT_PUBLISHED,
        '只有已上架（PUBLISHED）的券模板才能下架',
      );
    }
    if (template.status === CouponTemplateStatus.VOID) {
      throw BizException.conflict(ReasonCode.TEMPLATE_NOT_EDITABLE, '已作废的券模板不可再变更状态');
    }
    if (publishing) {
      if (template.totalStock <= 0) {
        throw BizException.badRequest(ReasonCode.STOCK_NOT_ENOUGH, '发行总量必须大于 0 才能上架');
      }
      // 上架时的有效性必须成立：用了 FIXED 却已过期，等于放一批废券出去
      if (template.validType === 'FIXED' && template.validEnd && template.validEnd.getTime() < Date.now()) {
        throw BizException.badRequest(
          ReasonCode.TEMPLATE_INVALID_VALID_PERIOD,
          '固定有效期的券模板已过期，请先调整有效期再上架',
        );
      }
      if (
        template.applyScope === 'SPECIFIED_STORES' &&
        (template.stores?.length ?? 0) === 0
      ) {
        throw BizException.badRequest(
          ReasonCode.TEMPLATE_STORE_REQUIRED,
          '适用范围为指定门店时必须至少选择 1 家门店',
        );
      }
    }

    const before = this.snapshot(template, template.stores.map((s) => s.storeId));

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.couponTemplate.update({
        where: { id },
        data: { status: target },
        include: {
          ownerMerchant: { select: { id: true, name: true } },
          stores: { select: { store: { select: { id: true, name: true } } } },
        },
      });

      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'coupon',
          action: publishing ? ACTION.publish : ACTION.unpublish,
          targetType: 'coupon_template',
          targetId: id,
          before,
          after: { status: target },
          ip: ip ?? null,
          userAgent: ua ?? null,
        },
        tx,
      );

      return row;
    });

    return { template: this.toView(updated) };
  }

  // ---------------------------------------------------------------- 归属与可见性

  /**
   * 解析「以哪个主体的身份创建」
   * - 平台管理员：可用 dto.mainMerchantId 指定；
   * - 其余：只能用自己的 merchantId，且必须是 **MAIN** 且 APPROVED（H1）。
   */
  private async resolveMainMerchant(user: JwtPayload, requested?: number) {
    const merchantId = user.userType === 'PLATFORM' ? (requested ?? user.merchantId) : user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true, type: true, status: true },
    });
    if (!merchant) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `商家 #${merchantId} 不存在`);
    }
    if (merchant.type !== MerchantType.MAIN) {
      // H1：只有主体商家能创建券模板 —— 附属商家连入口都不该有
      throw BizException.forbidden(
        ReasonCode.COUPON_CREATOR_NOT_MAIN,
        '只有主体商家可以创建券模板',
      );
    }
    if (merchant.status !== MerchantStatus.APPROVED) {
      throw BizException.forbidden(
        ReasonCode.MERCHANT_NOT_ACTIVE,
        `主体商家「${merchant.name}」当前状态为 ${merchant.status}，不可创建券模板`,
      );
    }
    return merchant;
  }

  /** 解析券的归属商家：主体券归主体自己；附属券必须是该主体的直接下属且已通过审核 */
  private async resolveOwner(ownerType: OwnerTypeValue, ownerMerchantId: number | undefined, mainId: number) {
    if (ownerType === 'MAIN_COUPON') {
      if (ownerMerchantId && ownerMerchantId !== mainId) {
        throw BizException.badRequest(
          ReasonCode.FORBIDDEN_SCOPE,
          '主体券的归属商家必须是主体自身，不能指定为其它商家',
        );
      }
      return { id: mainId };
    }

    if (!ownerMerchantId) {
      throw BizException.badRequest(
        ReasonCode.MERCHANT_ID_REQUIRED,
        'ownerType=SUB_COUPON 时必须传 ownerMerchantId',
      );
    }
    const owner = await this.prisma.merchant.findUnique({
      where: { id: ownerMerchantId },
      select: { id: true, name: true, parentId: true, type: true, status: true },
    });
    if (!owner) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `商家 #${ownerMerchantId} 不存在`);
    }
    if (owner.type !== MerchantType.SUB || owner.parentId !== mainId) {
      throw BizException.forbidden(
        ReasonCode.OWNER_NOT_CHILD,
        '附属商家券的归属商家必须是本主体的直接下属',
      );
    }
    if (owner.status !== MerchantStatus.APPROVED) {
      throw BizException.forbidden(
        ReasonCode.MERCHANT_NOT_ACTIVE,
        `商家「${owner.name}」尚未通过审核，不能作为券归属`,
      );
    }
    return owner;
  }

  /** 组装列表的可见性条件（含附属商家的授权范围） */
  private async buildVisibleWhere(query: QueryCouponTemplatesDto, user: JwtPayload) {
    const keyword = query.keyword?.trim();

    if (user.userType === 'PLATFORM') {
      return { where: {} as Prisma.CouponTemplateWhereInput, keyword };
    }

    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, type: true },
    });
    if (!merchant) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号所属商家不存在');
    }

    if (merchant.type === MerchantType.MAIN) {
      // 指定的 ownerMerchantId 必须在「自己 / 自己创建」的范围内，否则 403
      if (query.ownerMerchantId && query.ownerMerchantId !== merchantId) {
        const owned = await this.prisma.couponTemplate.count({
          where: { ownerMerchantId: query.ownerMerchantId, creatorMerchantId: merchantId },
        });
        if (owned === 0) {
          throw BizException.forbidden(
            ReasonCode.FORBIDDEN_SCOPE,
            '不能查看不属于本主体范围内的券模板',
          );
        }
      }
      return {
        where: {
          OR: [{ ownerMerchantId: merchantId }, { creatorMerchantId: merchantId }],
        } as Prisma.CouponTemplateWhereInput,
        keyword,
      };
    }

    // 附属商家：自己拥有的 + 被授权且已上架的主体券（授权撤销后立刻从这里消失）
    if (query.ownerMerchantId && query.ownerMerchantId !== merchantId) {
      throw BizException.forbidden(
        ReasonCode.FORBIDDEN_SCOPE,
        '附属商家只能查看自己名下或被授权给自己的券模板',
      );
    }
    const authorized = await this.authorizedCondition(merchantId);
    return {
      where: { OR: [{ ownerMerchantId: merchantId }, authorized] } as Prisma.CouponTemplateWhereInput,
      keyword,
    };
  }

  /**
   * 附属商家视角下的「可发放主体券」条件。
   * templateScope=ALL 时不限制模板 id；SPECIFIED 只放行清单内的模板。
   */
  private async authorizedCondition(subMerchantId: number): Promise<Prisma.CouponTemplateWhereInput> {
    const auths = await this.prisma.merchantAuthorization.findMany({
      where: {
        subMerchantId,
        status: AuthStatus.ENABLED,
        authType: AuthType.ISSUE_MAIN_COUPON,
      },
      select: { templateScope: true, templates: { select: { templateId: true } } },
    });

    const base: Prisma.CouponTemplateWhereInput = {
      ownerType: CouponOwnerType.MAIN_COUPON,
      status: CouponTemplateStatus.PUBLISHED,
    };
    if (!auths.length) {
      return { ...base, id: -1 };
    }
    if (auths.some((a) => a.templateScope === 'ALL')) {
      return base;
    }
    const ids = auths.flatMap((a) => a.templates.map((t) => t.templateId));
    return { ...base, id: { in: ids.length ? ids : [-1] } };
  }

  /**
   * 单条模板的可见性校验（详情用）
   *
   * 公开给 S2.2 的券码 / 发放服务复用：券码与券实例的可见性必须和模板完全一致，
   * 否则会出现「模板看不到但能导出它的券码」这种绕行。
   */
  async assertVisible(
    template: {
      id: number;
      ownerMerchantId: number;
      creatorMerchantId: number;
      ownerType: CouponOwnerType;
      status: CouponTemplateStatus;
    },
    user: JwtPayload,
  ) {
    if (user.userType === 'PLATFORM') return;
    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    if (template.ownerMerchantId === merchantId || template.creatorMerchantId === merchantId) return;

    const authorized = await this.authorizedCondition(merchantId);
    const hit = await this.prisma.couponTemplate.count({
      where: { AND: [{ id: template.id }, authorized] },
    });
    if (hit === 0) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '券模板不存在或不在你的可见范围内');
    }
  }

  /** 写操作归属校验：该模板必须属于「我这个主体」创建或拥有（S2.2 券码生成复用） */
  async assertOwnedByMyMain(
    template: { id: number; ownerMerchantId: number; creatorMerchantId: number },
    user: JwtPayload,
  ) {
    if (user.userType === 'PLATFORM') return;
    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    if (template.creatorMerchantId === merchantId || template.ownerMerchantId === merchantId) {
      return;
    }
    throw BizException.forbidden(
      ReasonCode.FORBIDDEN_SCOPE,
      '只能操作本主体创建或拥有的券模板',
    );
  }

  /** 只有草稿 / 已下架可以改字段，避免改已上架券的核销口径 */
  private assertEditable(status: CouponTemplateStatus) {
    if (status === CouponTemplateStatus.PUBLISHED) {
      throw BizException.conflict(
        ReasonCode.TEMPLATE_NOT_EDITABLE,
        '已上架的券模板不可编辑，请先下架再修改',
      );
    }
    if (status === CouponTemplateStatus.VOID) {
      throw BizException.conflict(ReasonCode.TEMPLATE_NOT_EDITABLE, '已作废的券模板不可编辑');
    }
  }

  private assertValidPeriod(start: Date | null | undefined, end: Date | null | undefined) {
    if (!start || !end) {
      throw BizException.badRequest(
        ReasonCode.TEMPLATE_INVALID_VALID_PERIOD,
        '固定有效期必须同时传 validStart 与 validEnd',
      );
    }
    if (start.getTime() >= end.getTime()) {
      throw BizException.badRequest(
        ReasonCode.TEMPLATE_INVALID_VALID_PERIOD,
        'validEnd 必须晚于 validStart',
      );
    }
  }

  /** 校验并归一化有效期 / 适用范围 */
  private normalize(dto: CreateCouponTemplateDto, opts: { isUpdate: boolean }) {
    return this.buildValidity(dto.validType, dto.validStart, dto.validEnd, dto.validDays, dto.applyScope);
  }

  /** 编辑时把 DTO 与库中现有值合并后再校验（DTO 未传的字段沿用原值） */
  private merge(
    template: {
      validType: string;
      validStart: Date | null;
      validEnd: Date | null;
      validDays: number;
      applyScope: string;
    },
    dto: UpdateCouponTemplateDto,
  ) {
    return this.buildValidity(
      dto.validType ?? (template.validType as ValidTypeValue),
      dto.validStart ?? template.validStart?.toISOString(),
      dto.validEnd ?? template.validEnd?.toISOString(),
      dto.validDays ?? template.validDays,
      dto.applyScope ?? (template.applyScope as ApplyScopeValue),
    );
  }

  private buildValidity(
    validType: ValidTypeValue,
    validStart?: string | null,
    validEnd?: string | null,
    validDays?: number,
    applyScope: ApplyScopeValue = 'ALL_STORES',
  ) {
    if (applyScope === 'SPECIFIED_MERCHANTS') {
      throw BizException.badRequest(
        ReasonCode.APPLY_SCOPE_UNSUPPORTED,
        '适用范围 SPECIFIED_MERCHANTS 尚未实现（S4 规划），请选择全部门店或指定门店',
      );
    }

    if (validType === 'FIXED') {
      const start = validStart ? new Date(validStart) : null;
      const end = validEnd ? new Date(validEnd) : null;
      return { validType: 'FIXED' as ValidTypeValue, validStart: start, validEnd: end, validDays: 0, applyScope };
    }

    const days = validDays ?? 30;
    return {
      validType: 'AFTER_RECEIVE_DAYS' as ValidTypeValue,
      validStart: null,
      validEnd: null,
      validDays: days,
      applyScope,
    };
  }

  /** 适用范围为指定门店时，门店必须属于券的归属商家 */
  private async assertStores(applyScope: ApplyScopeValue, storeIds: number[] | undefined, ownerMerchantId: number) {
    if (applyScope !== 'SPECIFIED_STORES') {
      if (storeIds?.length) {
        this.logger.warn(`applyScope=${applyScope} 时忽略 storeIds 参数`);
      }
      return [];
    }
    if (!storeIds?.length) {
      throw BizException.badRequest(
        ReasonCode.TEMPLATE_STORE_REQUIRED,
        'applyScope=SPECIFIED_STORES 时必须传 storeIds',
      );
    }
    const stores = await this.prisma.store.findMany({
      where: { id: { in: storeIds } },
      select: { id: true, name: true, merchantId: true },
    });
    if (stores.length !== storeIds.length) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '存在不存在的门店 id');
    }
    const illegal = stores.filter((s) => s.merchantId !== ownerMerchantId);
    if (illegal.length) {
      throw BizException.forbidden(
        ReasonCode.STORE_NOT_OWNED,
        `门店 ${illegal.map((s) => s.name).join('、')} 不属于该券的归属商家`,
      );
    }
    return storeIds;
  }

  // ---------------------------------------------------------------- 视图 / 快照

  private toView(row: {
    id: number;
    name: string;
    subtitle: string | null;
    ownerType: CouponOwnerType;
    ownerMerchantId: number;
    ownerMerchant?: { id: number; name: string } | null;
    creatorMerchantId: number;
    couponType: string;
    faceValue: Prisma.Decimal | number;
    thresholdAmount: Prisma.Decimal | number;
    pointsCost: number;
    exchangeEnabled?: boolean;
    purchasePrice: Prisma.Decimal | number;
    totalStock: number;
    issuedCount: number;
    usedCount: number;
    validType: string;
    validStart: Date | null;
    validEnd: Date | null;
    validDays: number;
    applyScope: string;
    perUserLimit: number;
    requireGreaterThanFace?: boolean;
    applicableScope?: Prisma.JsonValue | null;
    status: CouponTemplateStatus;
    description: string | null;
    rules: string | null;
    createdAt: Date;
    updatedAt: Date;
    stores?: Array<{ store: { id: number; name: string } }>;
  }): CouponTemplateView {
    const stores = (row.stores ?? []).map((s) => ({ id: s.store.id, name: s.store.name }));
    const applicableScope = parseApplicableScope(row.applicableScope);
    return {
      id: row.id,
      name: row.name,
      subtitle: row.subtitle,
      ownerType: row.ownerType,
      ownerMerchantId: row.ownerMerchantId,
      ownerMerchantName: row.ownerMerchant?.name ?? null,
      creatorMerchantId: row.creatorMerchantId,
      couponType: row.couponType,
      faceValue: Number(row.faceValue),
      thresholdAmount: Number(row.thresholdAmount),
      pointsCost: row.pointsCost,
      exchangeEnabled: row.exchangeEnabled ?? true,
      purchasePrice: Number(row.purchasePrice),
      totalStock: row.totalStock,
      issuedCount: row.issuedCount,
      usedCount: row.usedCount,
      remainingStock: Math.max(row.totalStock - row.issuedCount, 0),
      validType: row.validType,
      validStart: row.validStart,
      validEnd: row.validEnd,
      validDays: row.validDays,
      applyScope: row.applyScope,
      storeIds: stores.map((s) => s.id),
      stores,
      perUserLimit: row.perUserLimit,
      limitPerUser: row.perUserLimit,
      requireGreaterThanFace: Boolean(row.requireGreaterThanFace),
      applicableScope,
      status: row.status,
      editable: row.status === 'DRAFT' || row.status === 'UNPUBLISHED',
      description: row.description,
      rules: row.rules,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /** 审计快照：只留会变的关键字段，避免 before/after 塞满整行 */
  private snapshot(
    row: {
      name: string;
      faceValue: Prisma.Decimal | number;
      thresholdAmount: Prisma.Decimal | number;
      totalStock: number;
      validType: string;
      validStart: Date | null;
      validEnd: Date | null;
      validDays: number;
      applyScope: string;
      perUserLimit: number;
      status: string;
    },
    storeIds: number[],
  ) {
    return {
      name: row.name,
      faceValue: Number(row.faceValue),
      thresholdAmount: Number(row.thresholdAmount),
      totalStock: row.totalStock,
      validType: row.validType,
      validStart: row.validStart,
      validEnd: row.validEnd,
      validDays: row.validDays,
      applyScope: row.applyScope,
      storeIds,
      perUserLimit: row.perUserLimit,
      status: row.status,
    };
  }
}
