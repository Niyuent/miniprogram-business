import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  AuthStatus,
  AuthType,
  CouponOwnerType,
  CouponTemplateStatus,
  MerchantType,
} from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import {
  CreateAuthorizationDto,
  DisableAuthorizationDto,
  QueryAuthorizationLogsDto,
  QueryAuthorizationsDto,
  QueryMeAuthorizationsDto,
} from './dto/authorization.dto';

/** 单次查询就带回来的完整授权状态，供前端与 S2 直接使用，不必二次往返 */
export interface AuthorizationView {
  id: number;
  mainMerchantId: number;
  mainMerchantName: string | null;
  subMerchantId: number;
  subMerchantName: string | null;
  authType: string;
  status: string;
  templateScope: string;
  templateIds: number[];
  grantedBy: number | null;
  grantedAt: Date | null;
  revokedBy: number | null;
  revokedAt: Date | null;
  revokeReason: string | null;
}

/** 审计动作名（写入 audit_logs.action，GET /authorizations/logs 可按此过滤） */
const ACTION_GRANT = 'authorization:grant';
const ACTION_REVOKE = 'authorization:revoke';

/**
 * 授权管理
 *
 * 三条设计约束，逐条对应 S1.3 最容易出问题的地方：
 *
 * 1. **热路径单次取全**：`GET /me/authorizations` 与 `getEffectiveGrant()` 一次查询就把
 *    「有没有授权 + 授权范围 + 模板清单」全部带回，调用方（S2 发券）不必
 *    「先查授权、再查模板」。并且**刻意不加缓存** —— 撤销授权必须立刻生效，
 *    这条链路上缓存延迟等于「撤了权还能继续发券」，是业务风险而非优化点。
 * 2. **撤销幂等**：重复关闭返回 **200 + `alreadyDisabled:true`**，不 409、更不允许 500。
 *    并发安全交给条件更新 `UPDATE ... WHERE status='ENABLED'`，只有一个人占了行。
 * 3. **审计不丢**：业务成功时日志与数据改动写在**同一个事务**里（要么都有要么都没有）；
 *    业务失败时另外补一条 `result=FAILED` 的日志，保证「谁试图做过什么」不丢。
 */
@Injectable()
export class AuthorizationService {
  private readonly logger = new Logger('Authorization');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- 主体视角

  /** 授权列表（主体视角：我发出的所有授权） */
  async list(query: QueryAuthorizationsDto, user: JwtPayload) {
    const mainMerchantId = await this.resolveMainMerchantId(user);

    const where: Prisma.MerchantAuthorizationWhereInput = {
      mainMerchantId,
      ...(query.subMerchantId ? { subMerchantId: query.subMerchantId } : {}),
      ...(query.status ? { status: query.status as AuthStatus } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.merchantAuthorization.findMany({
        where,
        orderBy: { id: 'asc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          mainMerchant: { select: { id: true, name: true } },
          subMerchant: { select: { id: true, name: true } },
          templates: { select: { templateId: true } },
        },
      }),
      this.prisma.merchantAuthorization.count({ where }),
    ]);

    return {
      list: rows.map((r) => this.toView(r)),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /** 可选主体券模板：本主体自己拥有、已上架、且属于「主体券」的模板 */
  async availableTemplates(user: JwtPayload) {
    const mainMerchantId = await this.resolveMainMerchantId(user);

    const templates = await this.prisma.couponTemplate.findMany({
      where: {
        ownerMerchantId: mainMerchantId,
        ownerType: CouponOwnerType.MAIN_COUPON,
        status: CouponTemplateStatus.PUBLISHED,
      },
      orderBy: { id: 'asc' },
      select: {
        id: true,
        name: true,
        couponType: true,
        faceValue: true,
        thresholdAmount: true,
        pointsCost: true,
        totalStock: true,
        issuedCount: true,
        validEnd: true,
      },
    });

    return { mainMerchantId, templates };
  }

  /** 授权记录（报表用）：谁开的、谁关的、何时、什么原因 */
  async logs(query: QueryAuthorizationLogsDto, user: JwtPayload) {
    const mainMerchantId = await this.resolveMainMerchantId(user, query.mainMerchantId);

    // 数据隔离：只能看到「自己发出的授权」相关的日志，或「自己的人操作」产生的日志
    const [auths, operators] = await Promise.all([
      this.prisma.merchantAuthorization.findMany({
        where: { mainMerchantId },
        select: { id: true, subMerchantId: true },
      }),
      this.prisma.adminUser.findMany({
        where: { merchantId: mainMerchantId },
        select: { id: true },
      }),
    ]);

    const targetIds = query.subMerchantId
      ? auths.filter((a) => a.subMerchantId === query.subMerchantId).map((a) => a.id)
      : auths.map((a) => a.id);
    const operatorIds = operators.map((o) => o.id);

    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = new Date(query.to);

    const where: Prisma.AuditLogWhereInput = {
      module: 'authorization',
      ...(query.action ? { action: query.action } : {}),
      ...(query.from || query.to ? { createdAt } : {}),
      // 指定 subMerchantId 时不放宽到「自己的人」，否则会串出无关记录
      ...(query.subMerchantId
        ? { targetId: { in: targetIds } }
        : { OR: [{ targetId: { in: targetIds } }, { operatorId: { in: operatorIds } }] }),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    return {
      list: rows.map((r) => ({
        id: r.id,
        action: r.action,
        result: r.result,
        targetType: r.targetType,
        targetId: r.targetId,
        operatorId: r.operatorId,
        operatorType: r.operatorType,
        operatorName: r.operatorName,
        ip: r.ip,
        before: r.beforeData,
        after: r.afterData,
        createdAt: r.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 开启授权
   *
   * 已存在 ENABLED 记录 → 409 `AUTHORIZATION_EXISTS`；
   * 已存在 DISABLED 记录 → **重新启用同一条记录**（不新开一条），返回 `reactivated:true`。
   */
  async create(dto: CreateAuthorizationDto, user: JwtPayload, ip?: string, ua?: string) {
    const auditBase = {
      operatorId: user.sub,
      operatorType: user.userType,
      operatorName: user.username,
      module: 'authorization',
      targetType: 'merchant_authorization',
      ip,
      userAgent: ua,
    };

    try {
      const mainMerchantId = await this.resolveMainMerchantId(user, dto.mainMerchantId);
      const sub = await this.assertOwnSub(mainMerchantId, dto.subMerchantId);
      const templateIds = await this.resolveTemplates(mainMerchantId, dto);

      const result = await this.prisma.$transaction(async (tx) => {
        const existing = await tx.merchantAuthorization.findUnique({
          where: {
            mainMerchantId_subMerchantId_authType: {
              mainMerchantId,
              subMerchantId: dto.subMerchantId,
              authType: dto.authType as AuthType,
            },
          },
        });

        let reactivated = false;
        let before: unknown = null;
        let auth: {
          id: number;
          authType: AuthType;
          templateScope: string;
          subMerchantId: number;
          mainMerchantId: number;
        };

        if (existing) {
          if (existing.status === AuthStatus.ENABLED) {
            throw BizException.conflict(
              ReasonCode.AUTHORIZATION_EXISTS,
              `该商家已处于授权状态（授权 id=${existing.id}），如需调整范围请先关闭再重开`,
            );
          }
          before = { status: existing.status, templateScope: existing.templateScope };
          auth = await tx.merchantAuthorization.update({
            where: { id: existing.id },
            data: {
              status: AuthStatus.ENABLED,
              templateScope: dto.templateScope as never,
              grantedBy: user.sub,
              grantedAt: new Date(),
              // 重新启用要抹掉上次的撤销痕迹，避免报表出现「已启用但仍带着关闭时间」
              revokedBy: null,
              revokedAt: null,
              revokeReason: null,
            },
          });
          reactivated = true;
        } else {
          auth = await tx.merchantAuthorization.create({
            data: {
              mainMerchantId,
              subMerchantId: dto.subMerchantId,
              authType: dto.authType as AuthType,
              status: AuthStatus.ENABLED,
              templateScope: dto.templateScope as never,
              grantedBy: user.sub,
              grantedAt: new Date(),
            },
          });
        }

        // 模板清单整体替换：先清后写，防止残留模板让授权范围越滚越大
        await tx.merchantAuthorizationTemplate.deleteMany({
          where: { authorizationId: auth.id },
        });
        if (dto.templateScope === 'SPECIFIED') {
          await tx.merchantAuthorizationTemplate.createMany({
            data: templateIds.map((templateId) => ({ authorizationId: auth.id, templateId })),
          });
        }

        // 与业务改动同事务：成功日志不会因后续步骤失败而丢
        await this.audit.record(
          {
            ...auditBase,
            action: ACTION_GRANT,
            targetId: auth.id,
            before,
            after: {
              mainMerchantId,
              subMerchantId: dto.subMerchantId,
              subMerchantName: sub.name,
              authType: auth.authType,
              templateScope: auth.templateScope,
              templateIds: dto.templateScope === 'SPECIFIED' ? templateIds : [],
              reactivated,
            },
          },
          tx,
        );

        return { auth, reactivated };
      });

      this.logger.log(
        `主体 ${mainMerchantId} 授权 ${dto.subMerchantId}（id=${result.auth.id}）范围=${dto.templateScope}${result.reactivated ? ' [重新启用]' : ''}`,
      );

      return {
        authorization: await this.authorizationView(result.auth.id),
        reactivated: result.reactivated,
      };
    } catch (e) {
      // 唯一约束兜底：两个请求同时首次授权时，会有一个撞上 (main,sub,authType)。
      // **精确匹配**该唯一索引，避免把其它唯一键误报为 AUTHORIZATION_EXISTS（S4 收口审计）。
      if (this.isAuthUniqueViolation(e)) {
        await this.audit.record({
          ...auditBase,
          action: ACTION_GRANT,
          targetId: dto.subMerchantId,
          result: 'FAILED' as never,
          after: { reasonCode: ReasonCode.AUTHORIZATION_EXISTS, dto },
        });
        throw BizException.conflict(
          ReasonCode.AUTHORIZATION_EXISTS,
          '该授权已存在，请勿重复提交',
        );
      }
      // 失败也留痕：result=FAILED + 具体原因，避免「有人试过但查不到」
      await this.audit.record({
        ...auditBase,
        action: ACTION_GRANT,
        targetId: dto.subMerchantId,
        result: 'FAILED' as never,
        after: { reasonCode: this.reasonCodeOf(e), message: (e as Error).message, dto },
      });
      throw e;
    }
  }

  /**
   * 关闭授权（幂等）
   *
   * 并发安全靠条件更新 `UPDATE ... WHERE id=? AND status='ENABLED'`：
   * 落空的那一个回读记录后发现已经是 DISABLED → 200 + `alreadyDisabled:true`。
   */
  async disable(
    id: number,
    dto: DisableAuthorizationDto,
    user: JwtPayload,
    ip?: string,
    ua?: string,
  ) {
    const auditBase = {
      operatorId: user.sub,
      operatorType: user.userType,
      operatorName: user.username,
      module: 'authorization',
      targetType: 'merchant_authorization',
      targetId: id,
      ip,
      userAgent: ua,
    };

    try {
      const mainMerchantId = await this.resolveMainMerchantId(user);

      const result = await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.merchantAuthorization.updateMany({
          where: { id, mainMerchantId, status: AuthStatus.ENABLED },
          data: {
            status: AuthStatus.DISABLED,
            revokedBy: user.sub,
            revokedAt: new Date(),
            revokeReason: dto.revokeReason ?? null,
          },
        });

        const auth = await tx.merchantAuthorization.findUnique({
          where: { id },
          include: {
            mainMerchant: { select: { id: true, name: true } },
            subMerchant: { select: { id: true, name: true } },
            templates: { select: { templateId: true } },
          },
        });
        if (!auth) {
          throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '授权记录不存在');
        }
        // count=0 的另一种可能：这条授权不属于当前主体 —— 越权，必须 403
        if (auth.mainMerchantId !== mainMerchantId) {
          throw BizException.forbidden(
            ReasonCode.FORBIDDEN_SCOPE,
            '只能关闭本主体发出的授权',
          );
        }

        const alreadyDisabled = count === 0;

        await this.audit.record(
          {
            ...auditBase,
            action: ACTION_REVOKE,
            before: { status: alreadyDisabled ? AuthStatus.DISABLED : AuthStatus.ENABLED },
            after: {
              status: auth.status,
              subMerchantId: auth.subMerchantId,
              subMerchantName: auth.subMerchant?.name ?? null,
              revokeReason: auth.revokeReason,
              // 幂等重复调用一样留痕，但打上 noop，报表里可区分「真关闭」与「重复点击」
              noop: alreadyDisabled,
            },
          },
          tx,
        );

        return { auth, alreadyDisabled };
      });

      this.logger.log(
        `关闭授权 id=${id} 操作人=${user.username}(id=${user.sub}) 原因=${dto.revokeReason ?? '未填写'}${result.alreadyDisabled ? ' [幂等重复]' : ''}`,
      );

      return {
        authorization: this.toView(result.auth),
        alreadyDisabled: result.alreadyDisabled,
      };
    } catch (e) {
      await this.audit.record({
        ...auditBase,
        action: ACTION_REVOKE,
        result: 'FAILED' as never,
        after: { reasonCode: this.reasonCodeOf(e), message: (e as Error).message },
      });
      throw e;
    }
  }

  // ---------------------------------------------------------------- 附属视角（热路径）

  /**
   * 附属商家查自己的授权状态
   *
   * **一次查询**返回：是否授权 + 授权范围 + 模板清单 + 撤销信息。
   * 刻意不缓存：关闭授权后必须立刻查不到。
   */
  async me(user: JwtPayload, query: QueryMeAuthorizationsDto) {
    const merchantId = user.merchantId;
    if (!merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }

    // 越权判定：试图指定他人身份 → 403，而不是静默忽略（静默会让调用方误以为传参生效）
    for (const v of [query.merchantId, query.subMerchantId]) {
      if (v != null && v !== merchantId) {
        throw BizException.forbidden(
          ReasonCode.FORBIDDEN_SCOPE,
          '只能查询自己商家的授权信息',
        );
      }
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: merchantId },
      select: { id: true, name: true, type: true, parentId: true },
    });
    if (!merchant) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '商家不存在');
    }
    if (query.mainMerchantId != null && query.mainMerchantId !== merchant.parentId) {
      throw BizException.forbidden(
        ReasonCode.FORBIDDEN_SCOPE,
        '只能查询自己所属主体的授权',
      );
    }

    const rows = await this.prisma.merchantAuthorization.findMany({
      where: { subMerchantId: merchantId },
      orderBy: { id: 'asc' },
      include: {
        mainMerchant: { select: { id: true, name: true } },
        subMerchant: { select: { id: true, name: true } },
        templates: { select: { templateId: true } },
      },
    });

    const authorizations = rows.map((r) => this.toView(r));
    // 只有 ENABLED 的才算「当前生效」
    const active = authorizations.find(
      (a) => a.status === AuthStatus.ENABLED && a.authType === AuthType.ISSUE_MAIN_COUPON,
    );

    return {
      merchantId: merchant.id,
      merchantName: merchant.name,
      merchantType: merchant.type,
      // S2 发券前直接读这两个字段，不用自己再推导
      canIssueMainCoupon: !!active,
      issueMainCoupon: active
        ? {
            authorizationId: active.id,
            mainMerchantId: active.mainMerchantId,
            templateScope: active.templateScope,
            allowsAllTemplates: active.templateScope === 'ALL',
            templateIds: active.templateIds,
            grantedAt: active.grantedAt,
          }
        : null,
      authorizations,
    };
  }

  // ---------------------------------------------------------------- 供 S2 调用

  /**
   * 单次查询拿到该附属商家的**完整生效授权**（S2 发券链路直接用）
   *
   * 走 `@@index([subMerchantId, status])`，只取 ENABLED，并把模板清单一次带出；
   * 未授权返回 null。
   */
  async getEffectiveGrant(subMerchantId: number, mainMerchantId?: number) {
    return this.prisma.merchantAuthorization.findFirst({
      where: {
        subMerchantId,
        status: AuthStatus.ENABLED,
        authType: AuthType.ISSUE_MAIN_COUPON,
        ...(mainMerchantId ? { mainMerchantId } : {}),
      },
      include: {
        mainMerchant: { select: { id: true, name: true } },
        templates: { select: { templateId: true } },
      },
    });
  }

  /**
   * 「我能不能发这张券」—— S2 发券接口直接调这一个方法即可
   *
   * 校验顺序对应 docs/04 的 H2 四条硬约束，**每一步给独立错误码**，方便前端精确定位：
   *   1. 无 ENABLED 授权 → 403 `SUB_MERCHANT_NOT_AUTHORIZED`
   *   2. 模板不是主体券 → 403 `SUB_MERCHANT_CAN_ONLY_ISSUE_MAIN_COUPON`
   *   3. 模板不在指定范围内 → 403 `TEMPLATE_NOT_IN_AUTHORIZED_SCOPE`
   *   4. 模板未上架 → 400 `TEMPLATE_NOT_AVAILABLE`
   *
   * 共 2 次索引查询：`@@index([subMerchantId,status])` + 模板主键。
   */
  async checkAuthorization(subMerchantId: number, templateId: number) {
    const grant = await this.getEffectiveGrant(subMerchantId);
    if (!grant) {
      throw BizException.forbidden(
        ReasonCode.SUB_MERCHANT_NOT_AUTHORIZED,
        '该商家未获得发放主体商家代金券的授权',
      );
    }

    const template = await this.prisma.couponTemplate.findUnique({ where: { id: templateId } });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 ${templateId} 不存在`);
    }
    if (template.ownerType !== CouponOwnerType.MAIN_COUPON) {
      throw BizException.forbidden(
        ReasonCode.SUB_MERCHANT_CAN_ONLY_ISSUE_MAIN_COUPON,
        '附属商家只能发放主体商家代金券',
      );
    }

    if (
      grant.templateScope === 'SPECIFIED' &&
      !grant.templates.some((t) => t.templateId === templateId)
    ) {
      throw BizException.forbidden(
        ReasonCode.TEMPLATE_NOT_IN_AUTHORIZED_SCOPE,
        `模板「${template.name}」不在该商家的授权范围内`,
      );
    }

    if (template.status !== CouponTemplateStatus.PUBLISHED) {
      throw BizException.badRequest(
        ReasonCode.TEMPLATE_NOT_AVAILABLE,
        `模板「${template.name}」当前状态为 ${template.status}，不可发放`,
      );
    }

    return {
      authorizationId: grant.id,
      mainMerchantId: grant.mainMerchantId,
      templateScope: grant.templateScope,
      template,
    };
  }

  // ---------------------------------------------------------------- 内部：作用域与校验

  /**
   * 解析「以哪个主体的身份」操作
   * - 平台管理员：可指定 mainMerchantId，不指定则取系统里唯一的主体商家；
   * - 主体管理员：只能是自己的商家，传别人的值直接 403。
   */
  private async resolveMainMerchantId(user: JwtPayload, requested?: number): Promise<number> {
    if (user.userType === 'PLATFORM') {
      if (requested) return requested;
      const main = await this.prisma.merchant.findFirst({
        where: { type: MerchantType.MAIN },
        select: { id: true },
      });
      if (!main) {
        throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '平台未配置主体商家');
      }
      return main.id;
    }

    if (!user.merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家');
    }
    if (requested && requested !== user.merchantId) {
      throw BizException.forbidden(
        ReasonCode.FORBIDDEN_SCOPE,
        '无权以其他主体的身份查看/操作授权',
      );
    }

    const merchant = await this.prisma.merchant.findUnique({
      where: { id: user.merchantId },
      select: { id: true, type: true },
    });
    if (!merchant || merchant.type !== MerchantType.MAIN) {
      throw BizException.forbidden(
        ReasonCode.AUTHORIZATION_MAIN_INVALID,
        '只有主体商家可以管理授权',
      );
    }
    return merchant.id;
  }

  /** 校验被授权方：存在、是附属商家、是本主体的直接下属、且已通过审核 */
  private async assertOwnSub(mainMerchantId: number, subMerchantId: number) {
    const sub = await this.prisma.merchant.findUnique({
      where: { id: subMerchantId },
      select: { id: true, name: true, type: true, parentId: true, status: true },
    });
    if (!sub) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '被授权的商家不存在');
    }
    if (sub.type !== MerchantType.SUB) {
      throw BizException.badRequest(ReasonCode.AUTHORIZATION_NOT_SUB, '只能给附属商家授权');
    }
    if (sub.parentId !== mainMerchantId) {
      throw BizException.forbidden(
        ReasonCode.AUTHORIZATION_NOT_CHILD,
        '该商家不是本主体的下属商家，无权为其授权',
      );
    }
    if (sub.status !== 'APPROVED') {
      throw BizException.badRequest(
        ReasonCode.MERCHANT_NOT_ACTIVE,
        `该商家当前状态为 ${sub.status}，不可授权`,
      );
    }
    return sub;
  }

  /** 校验并归一化模板清单；ALL 时忽略入参，SPECIFIED 时逐个校验归属与上架状态 */
  private async resolveTemplates(mainMerchantId: number, dto: CreateAuthorizationDto) {
    if (dto.templateScope !== 'SPECIFIED') return [];

    const ids = dto.templateIds ?? [];
    if (ids.length === 0) {
      throw BizException.badRequest(
        ReasonCode.TEMPLATE_SCOPE_REQUIRED,
        'templateScope=SPECIFIED 时必须指定 templateIds',
      );
    }

    const templates = await this.prisma.couponTemplate.findMany({
      where: { id: { in: ids } },
      select: { id: true, name: true, ownerType: true, ownerMerchantId: true, status: true },
    });
    const map = new Map(templates.map((t) => [t.id, t]));
    for (const id of ids) {
      const t = map.get(id);
      if (!t) {
        throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 ${id} 不存在`);
      }
      if (t.ownerType !== CouponOwnerType.MAIN_COUPON || t.ownerMerchantId !== mainMerchantId) {
        throw BizException.badRequest(
          ReasonCode.TEMPLATE_NOT_MAIN_COUPON,
          `券模板「${t.name}」不是本主体的主体券，不可授权`,
        );
      }
      if (t.status !== CouponTemplateStatus.PUBLISHED) {
        throw BizException.badRequest(
          ReasonCode.TEMPLATE_NOT_AVAILABLE,
          `券模板「${t.name}」当前状态为 ${t.status}，不可授权`,
        );
      }
    }
    return ids;
  }

  /** 按 id 重新取一次完整视图（create 之后回包结构与列表保持一致） */
  private async authorizationView(id: number) {
    const row = await this.prisma.merchantAuthorization.findUniqueOrThrow({
      where: { id },
      include: {
        mainMerchant: { select: { id: true, name: true } },
        subMerchant: { select: { id: true, name: true } },
        templates: { select: { templateId: true } },
      },
    });
    return this.toView(row);
  }

  private toView(row: {
    id: number;
    mainMerchantId: number;
    subMerchantId: number;
    authType: string;
    status: string;
    templateScope: string;
    grantedBy: number | null;
    grantedAt: Date | null;
    revokedBy: number | null;
    revokedAt: Date | null;
    revokeReason: string | null;
    mainMerchant?: { id: number; name: string } | null;
    subMerchant?: { id: number; name: string } | null;
    templates?: Array<{ templateId: number }>;
  }): AuthorizationView {
    return {
      id: row.id,
      mainMerchantId: row.mainMerchantId,
      mainMerchantName: row.mainMerchant?.name ?? null,
      subMerchantId: row.subMerchantId,
      subMerchantName: row.subMerchant?.name ?? null,
      authType: row.authType,
      status: row.status,
      templateScope: row.templateScope,
      templateIds: (row.templates ?? []).map((t) => t.templateId),
      grantedBy: row.grantedBy,
      grantedAt: row.grantedAt,
      revokedBy: row.revokedBy,
      revokedAt: row.revokedAt,
      revokeReason: row.revokeReason,
    };
  }

  /** P2002 是否**精确**命中授权唯一索引 (mainMerchantId, subMerchantId, authType) */
  private isAuthUniqueViolation(e: unknown): boolean {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
    const target = (e as { meta?: { target?: unknown } }).meta?.target;
    const s = Array.isArray(target) ? target.join(',') : String(target ?? '');
    return s.includes('merchant_authorizations') || s.includes('authType');
  }

  private reasonCodeOf(e: unknown): string {
    return e instanceof BizException ? e.reasonCode : 'INTERNAL_ERROR';
  }
}
