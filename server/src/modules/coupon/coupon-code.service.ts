import { Injectable, Logger } from '@nestjs/common';
import { CouponCodeStatus, Prisma } from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import { CouponTemplateService } from './coupon-template.service';
import { GenerateCodesDto, QueryCodesDto } from './dto/coupon-code.dto';
import { generateCouponCodes } from './coupon-code.util';

/** 审计动作名（module=coupon，GET /audit-logs?module=coupon 可过滤） */
const ACTION = { generate: 'coupon:code:generate' } as const;

/** 券码视图：明文只在有权限的商家视角返回，越权一律 404（不暴露存在性） */
export interface CouponCodeView {
  id: number;
  code: string;
  batchNo: string;
  batchId: number | null;
  templateId: number;
  status: CouponCodeStatus;
  instanceId: number | null;
  generatedAt: Date;
}

/**
 * 券码预生成（S2.2）
 *
 * 三条硬约束：
 *
 * 1. **券码用 crypto 生成**（`coupon-code.util.ts`），不用 `Math.random` / 时间戳 / 自增，
 *    带 1 位校验位，12 位字符集去掉 0/O/1/I/L。
 * 2. **批次号唯一由数据库保证**：`coupon_code_batches.batchNo` 有唯一索引，重复批次命中
 *    P2002 → 409 `BATCH_ALREADY_EXISTS`。只用应用层 `count()` 预检挡不住并发。
 * 3. **券码唯一也交给数据库**：`coupon_codes.code` 唯一索引，偶发碰撞重试 3 次。
 *
 * 可见性与模板一致（复用 `CouponTemplateService.assertVisible`）：
 * 看不到模板的人，也拿不到它的券码。
 */
@Injectable()
export class CouponCodeService {
  private readonly logger = new Logger('CouponCode');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly templates: CouponTemplateService,
  ) {}

  /**
   * 预生成券码
   *
   * 事务内：建批次（唯一约束）→ 批量插码（唯一约束，撞码重试）。
   * 任一步失败整批回滚，不会留下「有批次没码」的半成品。
   */
  async generate(templateId: number, dto: GenerateCodesDto, user: JwtPayload, ip?: string, ua?: string) {
    const template = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: {
        id: true,
        name: true,
        ownerMerchantId: true,
        creatorMerchantId: true,
        ownerType: true,
        status: true,
      },
    });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${templateId} 不存在`);
    }
    // 可见性 + 归属：能生成券码的人，必须能操作这张模板
    await this.templates.assertVisible(template, user);
    await this.templates.assertOwnedByMyMain(template, user);

    const quantity = dto.quantity;
    const batchNo = dto.batchNo?.trim() || (await this.nextBatchNo(templateId));

    let created: { id: number; code: string }[] = [];
    let batchId = 0;

    await this.prisma.$transaction(async (tx) => {
      let batch;
      try {
        batch = await tx.couponCodeBatch.create({
          data: {
            batchNo,
            templateId,
            quantity,
            remark: dto.remark?.trim() || null,
            operatorId: user.sub,
          },
        });
      } catch (e) {
        if (this.isUniqueViolation(e)) {
          throw BizException.conflict(
            ReasonCode.BATCH_ALREADY_EXISTS,
            `批次号 ${batchNo} 已存在，不能重复生成`,
          );
        }
        throw e;
      }
      batchId = batch.id;

      // 撞码重试：code 上有唯一索引，理论上极难命中，但必须兜住
      for (let attempt = 1; attempt <= 3; attempt++) {
        const codes = generateCouponCodes(quantity);
        try {
          await tx.couponCode.createMany({
            data: codes.map((code) => ({
              code,
              templateId,
              batchNo,
              batchId: batch.id,
              status: CouponCodeStatus.UNISSUED,
            })),
          });
          created = await tx.couponCode.findMany({
            where: { batchId: batch.id },
            select: { id: true, code: true },
            orderBy: { id: 'asc' },
          });
          break;
        } catch (e) {
          if (this.isUniqueViolation(e) && attempt < 3) {
            this.logger.warn(`券码碰撞，重试第 ${attempt} 次（batchNo=${batchNo}）`);
            continue;
          }
          throw e;
        }
      }

      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'coupon',
          action: ACTION.generate,
          targetType: 'coupon_template',
          targetId: templateId,
          before: null,
          after: {
            batchNo,
            quantity,
            templateName: template.name,
            // 只记前后各 3 个样码用于追溯，不把整批券码塞进审计表
            samples: created.slice(0, 3).map((c) => c.code),
          },
          ip: ip ?? null,
          userAgent: ua ?? null,
        },
        tx,
      );
    });

    return {
      batchNo,
      batchId,
      templateId,
      quantity: created.length,
      codes: created.map((c) => c.code),
    };
  }

  /** 券码列表（分页，默认返回明文；越权 404） */
  async list(templateId: number, query: QueryCodesDto, user: JwtPayload) {
    const template = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, ownerMerchantId: true, creatorMerchantId: true, ownerType: true, status: true },
    });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${templateId} 不存在`);
    }
    await this.templates.assertVisible(template, user);

    const where: Prisma.CouponCodeWhereInput = {
      templateId,
      ...(query.status ? { status: query.status as CouponCodeStatus } : {}),
      ...(query.batchNo ? { batchNo: query.batchNo } : {}),
      ...(query.batchId ? { batchId: query.batchId } : {}),
      ...(query.code ? { code: { contains: query.code } } : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.couponCode.findMany({
        where,
        orderBy: { id: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.couponCode.count({ where }),
    ]);

    const [unused, issued, redeemed] = await Promise.all([
      this.prisma.couponCode.count({ where: { templateId, status: CouponCodeStatus.UNISSUED } }),
      this.prisma.couponCode.count({ where: { templateId, status: CouponCodeStatus.ISSUED } }),
      this.prisma.couponCode.count({ where: { templateId, status: CouponCodeStatus.REDEEMED } }),
    ]);

    const withCode = query.withCode !== false;
    return {
      list: rows.map(
        (row): CouponCodeView => ({
          id: row.id,
          code: withCode ? row.code : `${row.code.slice(0, 4)}****${row.code.slice(-2)}`,
          batchNo: row.batchNo,
          batchId: row.batchId,
          templateId: row.templateId,
          status: row.status,
          instanceId: row.instanceId,
          generatedAt: row.generatedAt,
        }),
      ),
      total,
      page: query.page,
      pageSize: query.pageSize,
      stats: { unused, issued, redeemed },
    };
  }

  /** 批次列表：给前端「按批次导出 / 追溯」用 */
  async batches(templateId: number, user: JwtPayload) {
    const template = await this.prisma.couponTemplate.findUnique({
      where: { id: templateId },
      select: { id: true, ownerMerchantId: true, creatorMerchantId: true, ownerType: true, status: true },
    });
    if (!template) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${templateId} 不存在`);
    }
    await this.templates.assertVisible(template, user);

    const rows = await this.prisma.couponCodeBatch.findMany({
      where: { templateId },
      orderBy: { id: 'desc' },
      include: { _count: { select: { codes: true } } },
    });

    // S2.4：每个批次「未发放 / 已发放 / 已核销 / 作废」明细 —— 批次列表页要能一眼看出
    // 这一批还剩多少张能发、发出去的有多少被用了（对应 F-2 券码池耗尽的排查场景）。
    const statusCount = await this.prisma.couponCode.groupBy({
      by: ['batchId', 'status'],
      where: { templateId, batchId: { not: null } },
      _count: { _all: true },
    });
    const statsMap = new Map<number, Record<string, number>>();
    for (const row of statusCount) {
      if (row.batchId == null) continue;
      const item = statsMap.get(row.batchId) ?? {};
      item[row.status] = row._count._all;
      statsMap.set(row.batchId, item);
    }
    const operatorIds = [...new Set(rows.map((b) => b.operatorId).filter((v): v is number => !!v))];
    const operators = operatorIds.length
      ? await this.prisma.adminUser.findMany({
          where: { id: { in: operatorIds } },
          select: { id: true, realName: true, username: true },
        })
      : [];
    const operatorMap = new Map(operators.map((o) => [o.id, o.realName || o.username]));

    return {
      list: rows.map((b) => {
        const stats = statsMap.get(b.id) ?? {};
        return {
          id: b.id,
          batchNo: b.batchNo,
          templateId: b.templateId,
          quantity: b.quantity,
          actualCount: b._count.codes,
          stats: {
            UNISSUED: stats.UNISSUED ?? 0,
            ISSUED: stats.ISSUED ?? 0,
            REDEEMED: stats.REDEEMED ?? 0,
            VOID: stats.VOID ?? 0,
          },
          remark: b.remark,
          operatorId: b.operatorId,
          operatorName: b.operatorId ? operatorMap.get(b.operatorId) ?? null : null,
          createdAt: b.createdAt,
        };
      }),
    };
  }

  // ---------------------------------------------------------------- 内部

  /**
   * 自动生成批次号：`{templateId}-{yyyymmdd}-{seq}`
   *
   * seq 为该模板当日已有批次 + 1（3 位补零）。只作为**默认建议值**，
   * 真正防重仍靠 `batchNo` 唯一索引 —— 并发下两个请求算出同一个 seq 时，
   * 后者会撞 P2002 并拿到 BATCH_ALREADY_EXISTS。
   */
  private async nextBatchNo(templateId: number): Promise<string> {
    const now = new Date();
    const ymd = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(
      now.getDate(),
    ).padStart(2, '0')}`;
    const prefix = `${templateId}-${ymd}`;
    const count = await this.prisma.couponCodeBatch.count({
      where: { batchNo: { startsWith: prefix } },
    });
    return `${prefix}-${String(count + 1).padStart(3, '0')}`;
  }

  private isUniqueViolation(e: unknown): boolean {
    const code = (e as { code?: string })?.code;
    return code === 'P2002';
  }
}
