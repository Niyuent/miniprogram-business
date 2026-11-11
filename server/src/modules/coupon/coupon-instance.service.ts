import { Injectable, Logger } from '@nestjs/common';
import {
  CouponInstanceStatus,
  CouponOwnerType,
  CouponSource,
  CouponTemplateStatus,
  MerchantType,
  Prisma,
} from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { AuthorizationService } from '../authorization/authorization.service';
import { JwtPayload } from '../auth/jwt-payload';
import { CouponTemplateService } from './coupon-template.service';
import { FreezeInstanceDto, IssueCouponDto, QueryInstancesDto } from './dto/coupon-instance.dto';

/** 审计动作名 */
const ACTION = {
  issue: 'coupon:issue',
  freeze: 'coupon:freeze',
  unfreeze: 'coupon:unfreeze',
} as const;

export interface CouponInstanceView {
  id: number;
  userId: number;
  userName: string | null;
  userPhone: string | null;
  templateId: number;
  templateName: string | null;
  code: string | null;
  issuerMerchantId: number | null;
  issuerMerchantName: string | null;
  source: CouponSource;
  pointsCost: number;
  status: CouponInstanceStatus;
  obtainedAt: Date;
  expireAt: Date;
  usedAt: Date | null;
  createdAt: Date;
}

/**
 * 券实例：发放 / 冻结 / 查询（S2.2）
 *
 * ## 发放为什么必须这么写
 *
 * 发券是「库存 + 券码池 + 实例」三处写入，且并发下必须只成功一次，所以：
 *
 * 1. **授权**：`AuthorizationService.checkAuthorization(merchantId, templateId)` —— S1.3 铺好的
 *    三重校验（未授权 / 非主体券 / 范围外 / 未上架），每步独立错误码。**撤销授权后立即生效**：
 *    每次发券都实时查 ENABLED 授权，不读缓存、不读 JWT 里的快照。
 * 2. **库存**：不用「先 select 再 update」，而是**条件更新**
 *    `UPDATE ... SET issued_count = issued_count + N WHERE id=? AND total_stock - issued_count >= N`，
 *    影响行数 0 → 409 `STOCK_EXHAUSTED`。并发下由行锁串行化，不会出现超发。
 * 3. **券码**：`SELECT ... WHERE status='UNISSUED' LIMIT N FOR UPDATE` 先锁行，再逐条绑定；
 *    绑定时仍带 `status='UNISSUED'` 条件，影响行数不足 → 409 `CODE_POOL_EXHAUSTED`。
 * 4. **审计**：同事务写 `coupon:issue`，含操作人、模板、用户、数量、券码样例。
 *
 * 整个发放过程在一个 `$transaction` 里，任一步失败全部回滚。
 */
@Injectable()
export class CouponInstanceService {
  private readonly logger = new Logger('CouponInstance');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly templates: CouponTemplateService,
    private readonly authorization: AuthorizationService,
  ) {}

  // ---------------------------------------------------------------- 发放

  /**
   * 带商家范围的发放入口：
   * - audience=USER：发给指定会员（可附带联盟商家范围写进审计）
   * - audience=MERCHANT_VISITORS：按所选商家到店会员批量发（单次最多 100 人）
   * 附属商家只能发主体券（assertIssuable），且商家范围只能是本店。
   */
  async issueWithScope(dto: IssueCouponDto, user: JwtPayload, ip?: string, ua?: string) {
    const scopeIds = await this.resolveTargetMerchantIds(dto, user);
    const scopeRemark =
      scopeIds.length > 0 ? `范围商家:[${scopeIds.join(',')}]` : '';
    const remark = [dto.remark?.trim(), scopeRemark].filter(Boolean).join(' · ').slice(0, 200) || undefined;
    const base = { ...dto, remark };

    if ((dto.audience || 'USER') === 'MERCHANT_VISITORS') {
      if (!scopeIds.length) {
        throw BizException.badRequest(ReasonCode.RESOURCE_NOT_FOUND, '请先选择发放商家范围');
      }
      const visitors = await this.prisma.order.groupBy({
        by: ['userId'],
        where: {
          merchantId: { in: scopeIds },
          status: 'NORMAL',
          orderType: 'CONSUME',
        },
        _max: { consumeTime: true },
        orderBy: { _max: { consumeTime: 'desc' } },
        take: 100,
      });
      if (!visitors.length) {
        throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '所选商家暂无到店会员可发放');
      }
      const results: Array<{ userId: number; quantity: number }> = [];
      let fail = 0;
      for (const row of visitors) {
        try {
          const one = await this.issue(
            {
              ...base,
              userId: row.userId,
              phone: undefined,
              audience: 'USER',
              allMerchants: false,
              targetMerchantIds: scopeIds,
            },
            user,
            ip,
            ua,
          );
          results.push({ userId: row.userId, quantity: one.quantity });
        } catch (error) {
          fail += 1;
          this.logger.warn(
            `批量发券跳过 user#${row.userId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      if (!results.length) {
        throw BizException.conflict(ReasonCode.STOCK_EXHAUSTED, '批量发放全部失败，请检查库存与券码池');
      }
      return {
        mode: 'MERCHANT_VISITORS' as const,
        targetMerchantIds: scopeIds,
        userCount: results.length,
        failCount: fail,
        issuedQuantity: results.reduce((sum, row) => sum + row.quantity, 0),
        results,
      };
    }

    const issued = await this.issue(base, user, ip, ua);
    return { ...issued, targetMerchantIds: scopeIds };
  }

  /**
   * 发放券实例
   *
   * 发券方由 JWT 推导（平台可用 dto.merchantId 指定；主体可指定本店或直属附属）：
   * - 发**自己拥有**的券 → 只校验模板已上架；
   * - 发**别人的主体券**（附属商家的典型场景）→ 走 `checkAuthorization`。
   */
  async issue(dto: IssueCouponDto, user: JwtPayload, ip?: string, ua?: string) {
    const quantity = dto.quantity ?? 1;
    const merchantId = await this.resolveIssuerMerchant(dto, user);
    const target = await this.resolveUser(dto);

    // ① 授权 / 状态校验（H2）
    const { template } = await this.assertIssuable(dto.templateId, merchantId);

    const now = new Date();
    const expireAt = this.computeExpireAt(template.validType, template.validEnd, template.validDays, now);

    const result = await this.prisma.$transaction(async (tx) => {
      // ② 库存：条件更新，并发下只有一个能拿到行
      // 列名与 Prisma 字段名一致（本库未做 snake_case @map），写死前已核对 information_schema
      const stockAffected = await tx.$executeRaw(
        Prisma.sql`UPDATE coupon_templates SET issuedCount = issuedCount + ${quantity}, updatedAt = NOW() WHERE id = ${dto.templateId} AND totalStock - issuedCount >= ${quantity}`,
      );
      if (stockAffected === 0) {
        throw BizException.conflict(
          ReasonCode.STOCK_EXHAUSTED,
          `模板「${template.name}」库存不足：本次需 ${quantity} 张，剩余 ${Math.max(
            template.totalStock - template.issuedCount,
            0,
          )} 张`,
        );
      }

      // ③ 券码：FOR UPDATE 锁行，防止并发取到同一批码
      const codeRows = await tx.$queryRaw<Array<{ id: number; code: string }>>(
        Prisma.sql`SELECT id, code FROM coupon_codes WHERE templateId = ${dto.templateId} AND status = 'UNISSUED' ORDER BY id ASC LIMIT ${quantity} FOR UPDATE`,
      );
      if (codeRows.length < quantity) {
        throw BizException.conflict(
          ReasonCode.CODE_POOL_EXHAUSTED,
          `券码池不足：本次需 ${quantity} 个，可用 ${codeRows.length} 个，请先预生成券码`,
        );
      }

      // ④ 建实例 + 绑定券码
      const created: Array<{ id: number; code: string }> = [];
      for (const row of codeRows) {
        const instance = await tx.couponInstance.create({
          data: {
            userId: target.id,
            templateId: dto.templateId,
            code: row.code,
            issuerMerchantId: merchantId,
            source: CouponSource.MERCHANT_ISSUE,
            pointsCost: template.pointsCost,
            status: CouponInstanceStatus.UNUSED,
            obtainedAt: now,
            expireAt,
          },
        });

        const bound = await tx.$executeRaw(
          Prisma.sql`UPDATE coupon_codes SET status = 'ISSUED', instanceId = ${instance.id} WHERE id = ${row.id} AND status = 'UNISSUED'`,
        );
        if (bound === 0) {
          // 理论上到不了（已 FOR UPDATE 锁住），真发生说明有人绕过了事务改码
          throw BizException.conflict(
            ReasonCode.CODE_POOL_EXHAUSTED,
            `券码 ${row.code} 已被占用，发放中止`,
          );
        }
        created.push({ id: instance.id, code: row.code });
      }

      // ⑤ 审计
      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'coupon',
          action: ACTION.issue,
          targetType: 'coupon_instance',
          targetId: created[0]?.id ?? null,
          before: {
            templateId: dto.templateId,
            issuedCount: template.issuedCount,
          },
          after: {
            templateId: dto.templateId,
            templateName: template.name,
            issuerMerchantId: merchantId,
            userId: target.id,
            quantity: created.length,
            expireAt,
            codes: created.map((c) => c.code),
            remark: dto.remark?.trim() || null,
          },
          ip: ip ?? null,
          userAgent: ua ?? null,
        },
        tx,
      );

      return created;
    });

    const instances = await this.prisma.couponInstance.findMany({
      where: { id: { in: result.map((r) => r.id) } },
      include: {
        user: { select: { id: true, nickname: true, phone: true } },
        template: { select: { id: true, name: true } },
      },
    });

    return {
      issued: await this.withIssuerNames(instances),
      quantity: instances.length,
      expireAt,
    };
  }

  // ---------------------------------------------------------------- 冻结 / 解冻

  async freeze(id: number, dto: FreezeInstanceDto, user: JwtPayload, ip?: string, ua?: string) {
    const instance = await this.prisma.couponInstance.findUnique({
      where: { id },
      include: { template: { select: { id: true, name: true, ownerMerchantId: true, creatorMerchantId: true, ownerType: true, status: true } } },
    });
    if (!instance) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券实例 #${id} 不存在`);
    }
    await this.assertInstanceVisible(instance, user);

    const frozen = dto.frozen;
    if (frozen && instance.status !== CouponInstanceStatus.UNUSED) {
      throw BizException.conflict(
        ReasonCode.COUPON_NOT_FREEZABLE,
        `只有未使用（UNUSED）的券可以冻结，当前状态为 ${instance.status}`,
      );
    }
    if (!frozen && instance.status !== CouponInstanceStatus.FROZEN) {
      throw BizException.conflict(
        ReasonCode.COUPON_NOT_FREEZABLE,
        `只有已冻结（FROZEN）的券可以解冻，当前状态为 ${instance.status}`,
      );
    }

    const before = { status: instance.status };
    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.couponInstance.update({
        where: { id },
        data: { status: frozen ? CouponInstanceStatus.FROZEN : CouponInstanceStatus.UNUSED },
        include: {
          user: { select: { id: true, nickname: true, phone: true } },
          template: { select: { id: true, name: true } },
        },
      });

      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'coupon',
          action: frozen ? ACTION.freeze : ACTION.unfreeze,
          targetType: 'coupon_instance',
          targetId: id,
          before,
          after: { status: row.status, reason: dto.reason?.trim() || null },
          ip: ip ?? null,
          userAgent: ua ?? null,
        },
        tx,
      );

      return row;
    });

    return { instance: (await this.withIssuerNames([updated]))[0] };
  }

  // ---------------------------------------------------------------- 查询

  /**
   * 券实例列表
   *
   * 数据隔离（H6）：
   * - 平台：全部（可按 issuerMerchantId 过滤）；
   * - 主体商家：自己创建的模板 + 自己拥有的模板 + 自己发放的；
   * - 附属商家：自己发放的 + 自己拥有的模板下的；传别人的 issuerMerchantId 直接 403。
   */
  async list(query: QueryInstancesDto, user: JwtPayload) {
    const scope = await this.visibleWhere(user);

    if (query.issuerMerchantId) {
      if (user.userType !== 'PLATFORM' && query.issuerMerchantId !== user.merchantId) {
        // H6：附属商家拿 query 参数查别人的券 → 直接 403，不是「静默忽略后返回全量」
        throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '只能查询自己发放的券实例');
      }
    }

    const where: Prisma.CouponInstanceWhereInput = {
      AND: [
        scope,
        ...(query.issuerMerchantId && user.userType === 'PLATFORM'
          ? [{ issuerMerchantId: query.issuerMerchantId }]
          : []),
        ...(query.templateId ? [{ templateId: query.templateId }] : []),
        ...(query.userId ? [{ userId: query.userId }] : []),
        ...(query.status ? [{ status: query.status as CouponInstanceStatus }] : []),
        ...(query.code ? [{ code: { contains: query.code } }] : []),
        ...(query.expireFrom || query.expireTo
          ? [
              {
                expireAt: {
                  ...(query.expireFrom ? { gte: new Date(query.expireFrom) } : {}),
                  ...(query.expireTo ? { lte: new Date(query.expireTo) } : {}),
                },
              },
            ]
          : []),
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.couponInstance.findMany({
        where,
        orderBy: [{ obtainedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          user: { select: { id: true, nickname: true, phone: true } },
          template: { select: { id: true, name: true } },
        },
      }),
      this.prisma.couponInstance.count({ where }),
    ]);

    return {
      list: await this.withIssuerNames(rows),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 券实例详情：越权一律 404 */
  async detail(id: number, user: JwtPayload) {
    const instance = await this.prisma.couponInstance.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, nickname: true, phone: true } },
        template: {
          select: {
            id: true,
            name: true,
            faceValue: true,
            thresholdAmount: true,
            applyScope: true,
            ownerMerchantId: true,
            creatorMerchantId: true,
            ownerType: true,
            status: true,
            stores: { select: { store: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    if (!instance) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券实例 #${id} 不存在`);
    }
    await this.assertInstanceVisible(instance, user);

    // S2.4：详情页要能看到这张券的核销记录（含被冲正的），方便追溯「这张券被谁、在哪、哪单核过」
    const redemptions = await this.prisma.redemptionRecord.findMany({
      where: { couponInstanceId: id },
      orderBy: [{ redeemedAt: 'desc' }, { id: 'desc' }],
      include: { store: { select: { id: true, name: true } } },
    });
    const orderIds = [...new Set(redemptions.map((r) => r.orderId).filter((v): v is number => !!v))];
    const orders = orderIds.length
      ? await this.prisma.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, orderNo: true } })
      : [];
    const orderMap = new Map(orders.map((o) => [o.id, o.orderNo]));
    const operatorIds = [...new Set(redemptions.map((r) => r.operatorId).filter((v): v is number => !!v))];
    const operators = operatorIds.length
      ? await this.prisma.adminUser.findMany({ where: { id: { in: operatorIds } }, select: { id: true, realName: true, username: true } })
      : [];
    const operatorMap = new Map(operators.map((o) => [o.id, o.realName || o.username]));

    return {
      instance: {
        ...(await this.withIssuerNames([instance]))[0],
        faceValue: Number(instance.template.faceValue),
        thresholdAmount: Number(instance.template.thresholdAmount),
        applyScope: instance.template.applyScope,
        stores: instance.template.stores.map((s) => ({ id: s.store.id, name: s.store.name })),
        // S2.4：关联核销记录挂在实例本体上（含已冲正的），前端详情页直接用
        redemptions: redemptions.map((r) => ({
          id: r.id,
          code: r.code,
          status: r.status,
          channel: r.channel,
          storeId: r.storeId,
          storeName: r.store?.name ?? null,
          operatorId: r.operatorId,
          operatorName: r.operatorId ? operatorMap.get(r.operatorId) ?? null : null,
          orderId: r.orderId,
          orderNo: r.orderId ? orderMap.get(r.orderId) ?? null : null,
          faceValue: Number(r.faceValue),
          discountAmount: Number(r.discountAmount),
          reverseReason: r.reverseReason,
          reversedAt: r.reversedAt,
          redeemedAt: r.redeemedAt,
        })),
      },
    };
  }

  // ---------------------------------------------------------------- 内部：校验与作用域

  /** 解析发券商家：平台可指定，其余只认 JWT */
  private async resolveIssuerMerchant(dto: IssueCouponDto, user: JwtPayload): Promise<number> {
    if (user.userType === 'PLATFORM') {
      const merchantId = dto.merchantId ?? user.merchantId;
      if (!merchantId) {
        throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '未指定发券商家');
      }
      return merchantId;
    }
    if (!user.merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    if (!dto.merchantId || dto.merchantId === user.merchantId) {
      return user.merchantId;
    }
    const self = await this.prisma.merchant.findUnique({
      where: { id: user.merchantId },
      select: { id: true, type: true },
    });
    if (!self) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    // 附属不能冒充别家发券
    if (self.type !== MerchantType.MAIN) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '附属商家只能以本店身份发券');
    }
    const child = await this.prisma.merchant.findFirst({
      where: { id: dto.merchantId, parentId: self.id, status: 'APPROVED' },
      select: { id: true },
    });
    if (!child) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '只能指定本联盟内的附属商家发券');
    }
    return child.id;
  }

  /** 解析发放范围商家：全体 / 勾选 / 默认本店 */
  private async resolveTargetMerchantIds(dto: IssueCouponDto, user: JwtPayload): Promise<number[]> {
    if (!user.merchantId && user.userType !== 'PLATFORM') {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    const selfId = user.merchantId;
    if (!selfId) {
      return dto.targetMerchantIds?.length ? [...new Set(dto.targetMerchantIds)] : [];
    }
    const self = await this.prisma.merchant.findUnique({
      where: { id: selfId },
      select: { id: true, type: true },
    });
    if (!self) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }

    if (self.type !== MerchantType.MAIN) {
      // 附属：范围只能是本店
      if (dto.allMerchants) {
        throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '附属商家不能选择全体联盟发券');
      }
      if (dto.targetMerchantIds?.some((id) => id !== self.id)) {
        throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '附属商家只能选择本店');
      }
      return [self.id];
    }

    const children = await this.prisma.merchant.findMany({
      where: { parentId: self.id, status: 'APPROVED' },
      select: { id: true },
    });
    const allowed = new Set<number>([self.id, ...children.map((row) => row.id)]);
    if (dto.allMerchants) {
      return [...allowed];
    }
    const picked = [...new Set(dto.targetMerchantIds || [])];
    if (!picked.length) {
      return [self.id];
    }
    const invalid = picked.filter((id) => !allowed.has(id));
    if (invalid.length) {
      throw BizException.forbidden(
        ReasonCode.FORBIDDEN_SCOPE,
        `商家 ${invalid.join(',')} 不在本联盟范围内`,
      );
    }
    return picked;
  }

  private async resolveUser(dto: IssueCouponDto) {
    if (dto.userId) {
      const user = await this.prisma.user.findUnique({
        where: { id: dto.userId },
        select: { id: true, status: true },
      });
      if (!user) {
        throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `用户 #${dto.userId} 不存在`);
      }
      return user;
    }
    if (dto.phone) {
      const user = await this.prisma.user.findUnique({
        where: { phone: dto.phone },
        select: { id: true, status: true },
      });
      if (!user) {
        throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `手机号 ${dto.phone} 未注册`);
      }
      return user;
    }
    throw BizException.badRequest(ReasonCode.RESOURCE_NOT_FOUND, 'userId 与 phone 必须传一个');
  }

  /**
   * 发券前的模板校验
   *
   * 自己拥有的券只查状态；不属于自己的主体券一律走 `checkAuthorization`
   * （未授权 / 非主体券 / 范围外 / 未上架各自独立错误码）。
   */
  private async assertIssuable(templateId: number, merchantId: number) {
    const template = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        name: true,
        ownerMerchantId: true,
        creatorMerchantId: true,
        ownerType: true,
        status: true,
        validType: true,
        validEnd: true,
        validDays: true,
        totalStock: true,
        issuedCount: true,
        pointsCost: true,
      },
    });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${templateId} 不存在`);
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, type: true },
    });
    if (!merchant) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `商家 #${merchantId} 不存在`);
    }

    // H2：附属商家**一律**走授权校验 —— 即便这张券是它自己的附属券也不行，
    // 附属商家只能发放「主体券且在自己授权范围内」的券（docs/06 S1.3 用例：发附属券 T4 → 403）。
    if (merchant.type === MerchantType.SUB) {
      const checked = await this.authorization.checkAuthorization(merchantId, templateId);
      return { template: { ...template, ...checked.template } };
    }

    // 主体商家：发自己拥有 / 自己创建的券，只校验上架状态
    if (template.ownerMerchantId === merchantId || template.creatorMerchantId === merchantId) {
      if (template.status !== CouponTemplateStatus.PUBLISHED) {
        throw BizException.badRequest(
          ReasonCode.TEMPLATE_NOT_AVAILABLE,
          `模板「${template.name}」当前状态为 ${template.status}，不可发放`,
        );
      }
      return { template };
    }

    // 主体商家去发一张既不属于自己、也不是自己创建的券：只有主体券可跨主体发（走授权）
    if (template.ownerType !== CouponOwnerType.MAIN_COUPON) {
      throw BizException.forbidden(
        ReasonCode.SUB_MERCHANT_CAN_ONLY_ISSUE_MAIN_COUPON,
        '只能发放主体商家代金券',
      );
    }
    const checked = await this.authorization.checkAuthorization(merchantId, templateId);
    return { template: { ...template, ...checked.template } };
  }

  private computeExpireAt(
    validType: string,
    validEnd: Date | null,
    validDays: number,
    now: Date,
  ): Date {
    if (validType === 'FIXED') {
      // FIXED 模板上架时已校验 validEnd 在未来；这里再兜一次，避免发出「生成即过期」的券
      const end = validEnd ?? new Date(now.getTime() + validDays * 86400_000);
      return end.getTime() > now.getTime() ? end : now;
    }
    return new Date(now.getTime() + (validDays || 30) * 86400_000);
  }

  /** 券实例可见范围（与模板可见性口径一致） */
  private async visibleWhere(user: JwtPayload): Promise<Prisma.CouponInstanceWhereInput> {
    if (user.userType === 'PLATFORM') return {};
    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { type: true },
    });

    // 主体视角 = 自己拥有 / 自己创建的模板下的全部券实例
    //（附属商家代发的主体券也落在里面，所以主体能看到「全平台」自己的券）
    if (merchant?.type === MerchantType.MAIN) {
      return {
        template: { OR: [{ ownerMerchantId: merchantId }, { creatorMerchantId: merchantId }] },
      };
    }
    // 附属视角 = 自己发放的 + 自己拥有的模板下的
    return {
      OR: [
        { issuerMerchantId: merchantId },
        { template: { OR: [{ ownerMerchantId: merchantId }, { creatorMerchantId: merchantId }] } },
      ],
    };
  }

  private async assertInstanceVisible(
    instance: {
      issuerMerchantId: number | null;
      template: { ownerMerchantId: number; creatorMerchantId: number };
    },
    user: JwtPayload,
  ) {
    if (user.userType === 'PLATFORM') return;
    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    const visible =
      instance.issuerMerchantId === merchantId ||
      instance.template.ownerMerchantId === merchantId ||
      instance.template.creatorMerchantId === merchantId;
    if (!visible) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '券实例不存在或不在你的可见范围内');
    }
  }

  // ---------------------------------------------------------------- 视图

  /** 补发放商家名称（列表 / 发放结果都要展示，避免前端再查一次） */
  private async withIssuerNames<T extends { issuerMerchantId: number | null }>(rows: T[]) {
    const ids = [...new Set(rows.map((r) => r.issuerMerchantId).filter((v): v is number => !!v))];
    const names = new Map<number, string>();
    if (ids.length) {
      const merchants = await this.prisma.merchant.findMany({
        where: { id: { in: ids } },
        select: { id: true, name: true },
      });
      merchants.forEach((m) => names.set(m.id, m.name));
    }
    return rows.map((row) => ({
      ...this.toView(row as never),
      issuerMerchantName: row.issuerMerchantId ? names.get(row.issuerMerchantId) ?? null : null,
    }));
  }

  private toView(row: {
    id: number;
    userId: number;
    templateId: number;
    code: string | null;
    issuerMerchantId: number | null;
    source: CouponSource;
    pointsCost: number;
    status: CouponInstanceStatus;
    obtainedAt: Date;
    expireAt: Date;
    usedAt: Date | null;
    createdAt: Date;
    user?: { id: number; nickname: string | null; phone: string } | null;
    template?: { id: number; name: string } | null;
  }): CouponInstanceView {
    return {
      id: row.id,
      userId: row.userId,
      userName: row.user?.nickname ?? null,
      userPhone: row.user?.phone ?? null,
      templateId: row.templateId,
      templateName: row.template?.name ?? null,
      code: row.code,
      issuerMerchantId: row.issuerMerchantId,
      issuerMerchantName: null,
      source: row.source,
      pointsCost: row.pointsCost,
      status: row.status,
      obtainedAt: row.obtainedAt,
      expireAt: row.expireAt,
      usedAt: row.usedAt,
      createdAt: row.createdAt,
    };
  }
}
