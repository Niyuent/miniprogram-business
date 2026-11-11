import { Injectable, Logger } from '@nestjs/common';
import { AuditResult, Prisma } from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { JwtPayload } from '../auth/jwt-payload';
import { QueryAuditLogsDto } from './dto/audit-log.dto';

/**
 * 需要脱敏的字段名（不区分大小写）。
 * 覆盖口令/凭证类：`passwordHash` / `accessToken` / `password` / `token` / `secret` / `pwd`
 */
const SENSITIVE_KEY = /(password|passwd|pwd|secret|token|credential|authorization)/i;

/** 写审计日志的入参 */
export interface AuditRecordInput {
  /** 操作人 admin_users.id；定时任务/系统可为 null */
  operatorId?: number | null;
  operatorType?: string;
  operatorName?: string;
  /** 业务模块，如 merchant / authorization / coupon */
  module: string;
  /** 动作，如 approve / reject / suspend */
  action: string;
  targetType?: string;
  targetId?: number | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
  userAgent?: string | null;
  result?: AuditResult;
}

/**
 * 审计日志写入服务（S1.2 起被各业务模块复用，S1.4 会补查询接口）
 *
 * 约定：
 *  - **成功与失败都要记**，失败时 `result=FAILED`，避免静默丢弃。
 *  - 敏感字段（passwordHash）不进日志。
 *  - 写入失败只记 error 日志，**不阻断主流程**（审计不该让业务失败）。
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger('Audit');

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 写一条审计日志
   * @param tx 可选。传入事务客户端时，日志与业务改动**同事务**：
   *           要么一起提交（成功一定有日志），要么一起回滚（不会有「数据变了的日志」）。
   *           不传则用独立连接（用于记录失败尝试）。
   */
  // ---------------------------------------------------------------- S1.4 查询侧

  /**
   * 操作日志列表（分页 + 模块/操作人/时间筛选）
   *
   * 可见范围：**由 JWT 推导，不信任入参**。
   *  - 平台管理员：全部
   *  - 主体商家：本主体 + 直属附属，且限定「这些人操作的」或「目标属于这些商家/门店/授权」
   *  - 附属商家 / 店员：同上，但商家集合只有自己
   * 组合方式用 `AND: [可见范围, 业务筛选]`，避免业务筛选里的 OR 与可见范围的 OR 互相覆盖。
   */
  async list(query: QueryAuditLogsDto, user: JwtPayload) {
    const visibility = await this.visibilityWhere(user);

    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = new Date(query.to);

    let operatorFilter: Prisma.AuditLogWhereInput = {};
    if (query.operatorId) {
      operatorFilter = { operatorId: query.operatorId };
    } else if (query.operatorKeyword) {
      const matched = await this.prisma.adminUser.findMany({
        where: {
          OR: [
            { username: { contains: query.operatorKeyword } },
            { realName: { contains: query.operatorKeyword } },
          ],
        },
        select: { id: true },
      });
      const ids = matched.map((m) => m.id);
      // 关键词在库里查不到任何人时返回空集，而不是「忽略条件把全部日志都吐出来」
      operatorFilter = {
        OR: [
          { operatorId: { in: ids } },
          { operatorName: { contains: query.operatorKeyword } },
        ],
      };
    }

    const where: Prisma.AuditLogWhereInput = {
      AND: [
        visibility,
        {
          ...(query.module ? { module: query.module } : {}),
          ...(query.action ? { action: query.action } : {}),
          ...(query.targetType ? { targetType: query.targetType } : {}),
          ...(query.targetId ? { targetId: query.targetId } : {}),
          ...(query.result ? { result: query.result as AuditResult } : {}),
          ...(query.from || query.to ? { createdAt } : {}),
          ...operatorFilter,
        },
      ],
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
        module: r.module,
        action: r.action,
        result: r.result,
        targetType: r.targetType,
        targetId: r.targetId,
        operatorId: r.operatorId,
        operatorType: r.operatorType,
        operatorName: r.operatorName,
        ip: r.ip,
        // 列表刻意不带 before/after（体积大且前端不需要），详情接口才给全量（脱敏后）
        hasDetail: !!(r.beforeData || r.afterData),
        createdAt: r.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  /**
   * 操作日志详情：`beforeData` / `afterData` 对齐展示用，**脱敏后**返回。
   * 越权访问不该存在的日志 → 404（不泄露「这条日志是否存在」）。
   */
  async detail(id: number, user: JwtPayload) {
    const visibility = await this.visibilityWhere(user);
    const row = await this.prisma.auditLog.findFirst({ where: { id, ...visibility } });
    if (!row) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '日志不存在或无权查看');
    }

    const operator = row.operatorId
      ? await this.prisma.adminUser.findUnique({
          where: { id: row.operatorId },
          select: { id: true, username: true, realName: true },
        })
      : null;

    return {
      id: row.id,
      module: row.module,
      action: row.action,
      result: row.result,
      targetType: row.targetType,
      targetId: row.targetId,
      operatorId: row.operatorId,
      operatorType: row.operatorType,
      operatorName: row.operatorName,
      operatorUsername: operator?.username ?? null,
      ip: row.ip,
      userAgent: row.userAgent,
      before: this.mask(row.beforeData),
      after: this.mask(row.afterData),
      createdAt: row.createdAt,
    };
  }

  // ---------------------------------------------------------------- 内部工具

  /** 可见范围：按 JWT 归属收敛（详见 list 注释） */
  private async visibilityWhere(user: JwtPayload): Promise<Prisma.AuditLogWhereInput> {
    if (user.userType === 'PLATFORM') return {};

    // 没有商家上下文（极少见）：只能看自己操作产生的日志
    if (!user.merchantId) return { operatorId: user.sub };

    const merchants = await this.prisma.merchant.findMany({
      where: { OR: [{ id: user.merchantId }, { parentId: user.merchantId }] },
      select: { id: true },
    });
    const merchantIds = merchants.map((m) => m.id);

    const [operators, stores, authorizations] = await Promise.all([
      this.prisma.adminUser.findMany({
        where: { merchantId: { in: merchantIds } },
        select: { id: true },
      }),
      this.prisma.store.findMany({
        where: { merchantId: { in: merchantIds } },
        select: { id: true },
      }),
      this.prisma.merchantAuthorization.findMany({
        where: { OR: [{ mainMerchantId: { in: merchantIds } }, { subMerchantId: { in: merchantIds } }] },
        select: { id: true },
      }),
    ]);

    return {
      OR: [
        { operatorId: { in: operators.map((o) => o.id) } },
        { targetType: 'merchant', targetId: { in: merchantIds } },
        { targetType: 'store', targetId: { in: stores.map((s) => s.id) } },
        {
          targetType: 'merchant_authorization',
          targetId: { in: authorizations.map((a) => a.id) },
        },
      ],
    };
  }

  /**
   * 敏感字段脱敏：密钥/口令类字段一律替换成 `******`。
   * 审计日志的作用是「追溯谁改了什么」，不需要也不应该看到凭证原文。
   */
  private mask(data: unknown): unknown {
    if (data === null || data === undefined) return null;
    if (Array.isArray(data)) return data.map((item) => this.mask(item));
    if (typeof data !== 'object') return data;

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = '******';
      } else if (value && typeof value === 'object') {
        out[key] = this.mask(value);
      } else {
        out[key] = value;
      }
    }
    return out;
  }

  async record(input: AuditRecordInput, tx?: Prisma.TransactionClient) {
    try {
      const client = tx ?? this.prisma;
      return await client.auditLog.create({
        data: {
          operatorId: input.operatorId ?? null,
          operatorType: input.operatorType ?? null,
          operatorName: input.operatorName ?? null,
          module: input.module,
          action: input.action,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          beforeData: (input.before ?? undefined) as never,
          afterData: (input.after ?? undefined) as never,
          ip: input.ip ?? null,
          userAgent: input.userAgent ?? null,
          result: input.result ?? AuditResult.SUCCESS,
        },
      });
    } catch (e) {
      this.logger.error(
        `审计日志写入失败 module=${input.module} action=${input.action}: ${(e as Error).message}`,
      );
      return null;
    }
  }
}
