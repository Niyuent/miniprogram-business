import { Injectable } from '@nestjs/common';
import { MerchantType, Prisma, SettleStatus } from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import { CreatePurchaseDto, QueryPurchasesDto, SettlePurchaseDto } from './dto/purchase.dto';

/**
 * 采购记录（S4.1）
 *
 * - `purchase_no` 唯一，格式 `{mainMerchantId}-{subMerchantId}-{yyyymmdd}-{seq}`；
 * - 采购记录**不可删除**，只能标记结算（UNSETTLED → SETTLED）；
 * - 主体可看全部（自己作为 main 或 sub 的），附属只能看自己作为 sub_merchant 的。
 */
@Injectable()
export class PurchaseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(query: QueryPurchasesDto, user: JwtPayload) {
    const scope = await this.purchaseScope(user);
    const visibleSubIds = await this.visibleSubMerchantIds(user);
    // 附属试图用 query 查别家 → 403
    if (query.subMerchantId && visibleSubIds && !visibleSubIds.includes(query.subMerchantId)) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '无权查看其他附属商家的采购记录');
    }

    const purchasedAt: Prisma.DateTimeFilter = {};
    if (query.from) purchasedAt.gte = new Date(`${query.from}T00:00:00.000Z`);
    if (query.to) purchasedAt.lte = new Date(`${query.to}T23:59:59.999Z`);

    const where: Prisma.PurchaseRecordWhereInput = {
      AND: [
        scope,
        {
          ...(query.subMerchantId ? { subMerchantId: query.subMerchantId } : {}),
          ...(query.settleStatus ? { settleStatus: query.settleStatus as SettleStatus } : {}),
          ...(query.from || query.to ? { purchasedAt } : {}),
        },
      ],
    };

    const [rows, total] = await Promise.all([
      this.prisma.purchaseRecord.findMany({
        where,
        orderBy: [{ id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          template: { select: { id: true, name: true } },
        },
      }),
      this.prisma.purchaseRecord.count({ where }),
    ]);

    const merchantIds = [...new Set(rows.flatMap((r) => [r.mainMerchantId, r.subMerchantId]))];
    const merchants = merchantIds.length
      ? await this.prisma.merchant.findMany({ where: { id: { in: merchantIds } }, select: { id: true, name: true } })
      : [];
    const merchantMap = new Map(merchants.map((m) => [m.id, m.name]));

    return {
      list: rows.map((r) => ({
        id: r.id,
        purchaseNo: r.purchaseNo,
        mainMerchantId: r.mainMerchantId,
        mainMerchantName: merchantMap.get(r.mainMerchantId) ?? null,
        subMerchantId: r.subMerchantId,
        subMerchantName: merchantMap.get(r.subMerchantId) ?? null,
        templateId: r.templateId,
        templateName: r.template?.name ?? null,
        quantity: r.quantity,
        unitPrice: Number(r.unitPrice),
        totalAmount: Number(r.totalAmount),
        settleStatus: r.settleStatus,
        settleRemark: r.settleRemark,
        purchasedAt: r.purchasedAt,
        createdAt: r.createdAt,
      })),
      total,
      page: query.page,
      pageSize: query.pageSize,
    };
  }

  async create(dto: CreatePurchaseDto, user: JwtPayload) {
    const { mainMerchantId, subMerchantId } = await this.resolveParties(dto, user);
    const totalAmount = dto.totalAmount ?? Math.round(Number(dto.unitPrice) * dto.quantity * 100) / 100;

    // 校验模板存在
    const template = await this.prisma.couponTemplate.findUnique({ where: { id: dto.templateId }, select: { id: true } });
    if (!template) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `券模板 #${dto.templateId} 不存在`);

    // 并发安全：seq 是「读最新 + 1」，并发下可能撞同号 → 唯一索引兜底（P2002），
    // 捕获后重读最新 seq 重试，绝不留 500。最多 5 次（极端并发下也兜得住）。
    let record;
    let purchaseNo;
    let lastErr: unknown = null;
    for (let attempt = 1; attempt <= 5; attempt++) {
      purchaseNo = await this.nextPurchaseNo(mainMerchantId, subMerchantId);
      try {
        record = await this.prisma.purchaseRecord.create({
          data: {
            purchaseNo,
            mainMerchantId,
            subMerchantId,
            templateId: dto.templateId,
            quantity: dto.quantity,
            unitPrice: dto.unitPrice,
            totalAmount,
            purchasedAt: dto.purchasedAt ? new Date(dto.purchasedAt) : new Date(),
            operatorId: user.sub,
          },
        });
        lastErr = null;
        break;
      } catch (e) {
        lastErr = e;
        if ((e as { code?: string }).code === 'P2002') {
          // purchaseNo 唯一冲突：重读最新 seq 重试
          continue;
        }
        throw e;
      }
    }
    if (!record) {
      throw BizException.conflict(ReasonCode.CONCURRENT_UPDATE, '采购单号并发冲突，已重试 5 次仍未成功，请稍后重试');
    }

    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      module: 'purchase',
      action: 'PURCHASE_CREATE',
      targetType: 'purchase_record',
      targetId: record.id,
      after: { purchaseNo, mainMerchantId, subMerchantId, totalAmount },
    });

    return { id: record.id, purchaseNo: record.purchaseNo, totalAmount: Number(record.totalAmount), settleStatus: record.settleStatus };
  }

  /** 标记已结算：只能 UNSETTLED → SETTLED，不可回退（采购记录不可删除/不可逆） */
  async settle(id: number, dto: SettlePurchaseDto, user: JwtPayload) {
    const record = await this.prisma.purchaseRecord.findUnique({ where: { id } });
    if (!record) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, `采购记录 #${id} 不存在`);
    await this.assertSettleAllowed(record, user);

    const updated = await this.prisma.$transaction(async (tx) => {
      const affected = await tx.$executeRaw(
        Prisma.sql`UPDATE purchase_records SET settleStatus = 'SETTLED', settleRemark = ${dto.settleRemark ?? null}, updatedAt = NOW() WHERE id = ${id} AND settleStatus = 'UNSETTLED'`,
      );
      if (affected === 0) {
        throw BizException.conflict(ReasonCode.CONCURRENT_UPDATE, '该采购记录已结算，不能重复结算');
      }
      return tx.purchaseRecord.findUnique({ where: { id } });
    });

    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      module: 'purchase',
      action: 'PURCHASE_SETTLE',
      targetType: 'purchase_record',
      targetId: id,
      before: { settleStatus: record.settleStatus },
      after: { settleStatus: updated?.settleStatus, settleRemark: dto.settleRemark ?? null },
    });

    return { id, settleStatus: updated?.settleStatus, settleRemark: dto.settleRemark ?? null };
  }

  // ---------------------------------------------------------------- 内部工具

  /** 采购双方解析：平台指定 / 主体=main / 附属=sub */
  private async resolveParties(dto: CreatePurchaseDto, user: JwtPayload) {
    if (user.userType === 'PLATFORM') {
      if (!dto.mainMerchantId || !dto.subMerchantId) {
        throw BizException.badRequest(ReasonCode.MERCHANT_ID_REQUIRED, '平台管理员新增采购必须指定 mainMerchantId 与 subMerchantId');
      }
      return { mainMerchantId: dto.mainMerchantId, subMerchantId: dto.subMerchantId };
    }
    if (user.userType === 'STORE') {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '门店账号无权新增采购记录');
    }
    const self = user.merchantId;
    if (!self) throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '账号未关联商家');
    const me = await this.prisma.merchant.findUnique({ where: { id: self }, select: { type: true } });
    if (me?.type === MerchantType.MAIN) {
      // 主体采购：自己是 main，采购对象是 sub
      if (!dto.subMerchantId) throw BizException.badRequest(ReasonCode.MERCHANT_ID_REQUIRED, '主体采购必须指定 subMerchantId');
      return { mainMerchantId: self, subMerchantId: dto.subMerchantId };
    }
    // 附属录单：自己是 sub，卖给 main
    if (!dto.mainMerchantId) throw BizException.badRequest(ReasonCode.MERCHANT_ID_REQUIRED, '附属录单必须指定 mainMerchantId');
    return { mainMerchantId: dto.mainMerchantId, subMerchantId: self };
  }

  /** 可见范围：平台全量 / 主体=自己作为 main 或 sub 的 / 附属=自己作为 sub 的 */
  private async purchaseScope(user: JwtPayload): Promise<Prisma.PurchaseRecordWhereInput> {
    if (user.userType === 'PLATFORM') return {};
    if (user.userType === 'STORE') return { id: -1 };
    const merchantId = user.merchantId;
    if (!merchantId) return { id: -1 };
    const me = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { type: true } });
    if (me?.type === MerchantType.MAIN) {
      return { OR: [{ mainMerchantId: merchantId }, { subMerchantId: merchantId }] };
    }
    return { subMerchantId: merchantId };
  }

  /** 附属可查的 subMerchantId 集合（用于拒绝越权 query）；主体/平台返回 null 表示不限 */
  private async visibleSubMerchantIds(user: JwtPayload): Promise<number[] | null> {
    if (user.userType === 'PLATFORM') return null;
    const merchantId = user.merchantId;
    if (!merchantId) return [];
    const me = await this.prisma.merchant.findUnique({ where: { id: merchantId }, select: { type: true } });
    if (me?.type === MerchantType.MAIN) return null;
    return [merchantId];
  }

  /** 结算权归主体：附属不能结算 */
  private async assertSettleAllowed(record: { mainMerchantId: number; subMerchantId: number }, user: JwtPayload) {
    if (user.userType === 'PLATFORM') return;
    const me = await this.prisma.merchant.findUnique({ where: { id: user.merchantId ?? -1 }, select: { type: true } });
    if (!me || me.type !== MerchantType.MAIN) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '采购结算权归主体商家');
    }
  }

  /** 生成唯一采购单号：{main}-{sub}-{yyyymmdd}-{seq} */
  private async nextPurchaseNo(mainMerchantId: number, subMerchantId: number): Promise<string> {
    const now = new Date();
    const yyyymmdd = now.toISOString().slice(0, 10).replace(/-/g, '');
    const prefix = `${mainMerchantId}-${subMerchantId}-${yyyymmdd}-`;
    const last = await this.prisma.purchaseRecord.findFirst({
      where: { purchaseNo: { startsWith: prefix } },
      orderBy: { id: 'desc' },
      select: { purchaseNo: true },
    });
    const seq = last ? parseInt(last.purchaseNo.split('-').pop() as string, 10) + 1 : 1;
    return `${prefix}${seq}`;
  }
}
