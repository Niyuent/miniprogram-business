import { Injectable } from '@nestjs/common';
import { ChangeStatus, MerchantType, Prisma } from '@prisma/client';
import { BizException, ReasonCode } from '../../common/exceptions/biz.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../audit-log/audit.service';
import { JwtPayload } from '../auth/jwt-payload';
import {
  CHANGEABLE_FIELDS,
  CreateStoreChangeDto,
  FORBIDDEN_FIELDS,
  QueryStoreChangeDto,
  ReviewStoreChangeDto,
} from './dto/store-change.dto';

interface Scope {
  merchantId: number | null;
  storeId: number | null;
}

interface ChangeEntry {
  old: unknown;
  new: unknown;
}

const STORE_FIELDS: Prisma.StoreSelect = {
  id: true,
  merchantId: true,
  name: true,
  code: true,
  contactName: true,
  contactPhone: true,
  province: true,
  city: true,
  district: true,
  address: true,
  lng: true,
  lat: true,
  businessHours: true,
  logo: true,
  status: true,
};

/**
 * 门店变更申请（S5.3）
 *
 * 规则：
 *  1. 附属只能对本商家（店员：本门店）提交/查看/作废；
 *  2. 审核仅平台/主体（`store:change:review`，且 scope 必须无商家约束）；
 *  3. 驳回必填原因，通过可选；
 *  4. 通过 = 同事务「更新 stores + 改状态 + 写审计」；
 *  5. 同门店同时只能有一个 PENDING；
 *  6. 申请不可修改 —— 只能作废后重新提交。
 */
@Injectable()
export class StoreChangeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** 可见范围：平台/主体=全量；附属=本商家；店员=本店 */
  private async scope(user: JwtPayload): Promise<Scope> {
    if (user.userType === 'PLATFORM') return { merchantId: null, storeId: null };
    if (user.userType === 'STORE') return { merchantId: user.merchantId ?? null, storeId: user.storeId ?? null };
    const me = await this.prisma.merchant.findUnique({
      where: { id: user.merchantId ?? -1 },
      select: { type: true },
    });
    if (me?.type === MerchantType.MAIN) return { merchantId: null, storeId: null };
    return { merchantId: user.merchantId ?? null, storeId: null };
  }

  /** 门店归属校验：不在 scope 内 → 403 STORE_NOT_OWNED */
  private async assertStoreInScope(storeId: number, scope: Scope) {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: STORE_FIELDS });
    if (!store) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '门店不存在');
    if (scope.storeId !== null && store.id !== scope.storeId) {
      throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, '无权操作该门店');
    }
    if (scope.merchantId !== null && store.merchantId !== scope.merchantId) {
      throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, '无权操作该门店');
    }
    return store;
  }

  /** 审核侧守卫：只有平台/主体可审核 */
  private assertReviewer(scope: Scope) {
    if (scope.merchantId !== null || scope.storeId !== null) {
      throw BizException.forbidden(ReasonCode.FORBIDDEN_SCOPE, '门店变更由主体商家审核');
    }
  }

  private normalize(field: string, value: unknown): unknown {
    if (value === null || value === undefined) return null;
    if (field === 'lng' || field === 'lat') return Number(value);
    return value;
  }

  /** 从 DTO 提取「确有变化」的白名单字段 → { field: { old, new } } */
  private pickChanges(store: Record<string, unknown>, dto: CreateStoreChangeDto): Record<string, ChangeEntry> {
    const changes: Record<string, ChangeEntry> = {};
    const src = dto as unknown as Record<string, unknown>;
    for (const field of CHANGEABLE_FIELDS) {
      const next = src[field];
      if (next === undefined) continue;
      const old = this.normalize(field, store[field]);
      const to = this.normalize(field, next);
      if (String(old ?? '') === String(to ?? '')) continue;
      changes[field] = { old, new: to };
    }
    return changes;
  }

  // ---------------------------------------------------------------- 附属：提交

  async submit(
    storeId: number,
    dto: CreateStoreChangeDto,
    user: JwtPayload,
    rawBody: Record<string, unknown> | undefined,
    ip?: string,
    ua?: string,
  ) {
    // 禁止字段显式拒绝（全局 ValidationPipe 只剥离不报错，这里给出确定性 400）
    const dirty = FORBIDDEN_FIELDS.filter((f) => rawBody && Object.prototype.hasOwnProperty.call(rawBody, f));
    if (dirty.length) {
      throw BizException.badRequest(ReasonCode.STORE_CHANGE_FIELD_FORBIDDEN, `以下字段不允许变更：${dirty.join('、')}`);
    }

    const scope = await this.scope(user);
    const store = await this.assertStoreInScope(storeId, scope);

    const changes = this.pickChanges(store as unknown as Record<string, unknown>, dto);
    if (Object.keys(changes).length === 0) {
      throw BizException.badRequest(ReasonCode.STORE_CHANGE_NO_DIFF, '未检测到任何有效变更');
    }

    const pending = await this.prisma.storeChangeRequest.findFirst({
      where: { storeId, status: ChangeStatus.PENDING },
      select: { id: true },
    });
    if (pending) {
      throw BizException.conflict(
        ReasonCode.STORE_CHANGE_PENDING_EXISTS,
        `该门店已有待审核申请（#${pending.id}），请先作废后再提交`,
      );
    }

    const created = await this.prisma.storeChangeRequest.create({
      data: {
        storeId,
        merchantId: store.merchantId,
        applicantId: user.sub,
        changes: changes as unknown as Prisma.InputJsonValue,
        reason: dto.reason ?? null,
        status: ChangeStatus.PENDING,
      },
    });

    await this.audit.record({
      operatorId: user.sub,
      operatorType: user.userType,
      operatorName: user.username,
      module: 'store',
      action: 'store:change-submit',
      targetType: 'store_change_request',
      targetId: created.id,
      after: { storeId, changes },
      ip,
      userAgent: ua,
    });

    return created;
  }

  /** 附属：查看本门店的变更申请 */
  async listForStore(storeId: number, user: JwtPayload) {
    const scope = await this.scope(user);
    await this.assertStoreInScope(storeId, scope);
    return this.prisma.storeChangeRequest.findMany({
      where: { storeId },
      orderBy: { id: 'desc' },
      take: 50,
    });
  }

  // ---------------------------------------------------------------- 主体：审核

  async listForReview(query: QueryStoreChangeDto, user: JwtPayload) {
    const scope = await this.scope(user);
    this.assertReviewer(scope);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where: Prisma.StoreChangeRequestWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.storeId ? { storeId: query.storeId } : {}),
      ...(query.merchantId ? { merchantId: query.merchantId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.storeChangeRequest.findMany({
        where,
        orderBy: [{ status: 'asc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { store: { select: { id: true, name: true, code: true, merchantId: true } } },
      }),
      this.prisma.storeChangeRequest.count({ where }),
    ]);
    return { list: rows, total, page, pageSize };
  }

  async detail(id: number, user: JwtPayload) {
    const scope = await this.scope(user);
    const req = await this.prisma.storeChangeRequest.findUnique({
      where: { id },
      include: { store: { select: { id: true, name: true, code: true, merchantId: true } } },
    });
    if (!req) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '变更申请不存在');
    // 附属/店员仅可见自己的
    if (scope.storeId !== null && req.storeId !== scope.storeId) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '变更申请不存在');
    }
    if (scope.merchantId !== null && req.merchantId !== scope.merchantId) {
      throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '变更申请不存在');
    }
    return req;
  }

  async review(id: number, dto: ReviewStoreChangeDto, user: JwtPayload, ip?: string, ua?: string) {
    const scope = await this.scope(user);
    this.assertReviewer(scope);

    const req = await this.prisma.storeChangeRequest.findUnique({ where: { id } });
    if (!req) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '变更申请不存在');
    if (req.status !== ChangeStatus.PENDING) {
      throw BizException.conflict(ReasonCode.STORE_CHANGE_NOT_PENDING, '该申请已审核，不可重复处理');
    }

    const approve = dto.decision === 'APPROVE';
    if (!approve && !dto.remark?.trim()) {
      throw BizException.badRequest(ReasonCode.STORE_CHANGE_REASON_REQUIRED, '驳回时必须填写原因');
    }

    const changes = (req.changes ?? {}) as unknown as Record<string, ChangeEntry>;

    const result = await this.prisma.$transaction(async (tx) => {
      if (approve) {
        const data: Record<string, unknown> = {};
        for (const [field, entry] of Object.entries(changes)) {
          if (!(CHANGEABLE_FIELDS as readonly string[]).includes(field)) continue; // 双保险：只应用白名单字段
          data[field] = this.normalize(field, entry.new);
        }
        if (Object.keys(data).length) {
          await tx.store.update({ where: { id: req.storeId }, data });
        }
      }

      const updated = await tx.storeChangeRequest.update({
        where: { id },
        data: {
          status: approve ? ChangeStatus.APPROVED : ChangeStatus.REJECTED,
          reviewerId: user.sub,
          reviewRemark: dto.remark ?? null,
          reviewedAt: new Date(),
        },
      });

      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'store',
          action: approve ? 'store:change-approve' : 'store:change-reject',
          targetType: 'store_change_request',
          targetId: id,
          before: { status: ChangeStatus.PENDING, changes },
          after: { status: updated.status, remark: dto.remark ?? null },
          ip,
          userAgent: ua,
        },
        tx,
      );

      return updated;
    });

    return result;
  }

  /** 附属：作废本店 PENDING 申请（规则 6：不可修改，只能作废后重新提交） */
  async cancel(id: number, user: JwtPayload, ip?: string, ua?: string) {
    const scope = await this.scope(user);
    const req = await this.prisma.storeChangeRequest.findUnique({ where: { id } });
    if (!req) throw BizException.notFound(ReasonCode.RESOURCE_NOT_FOUND, '变更申请不存在');
    if (scope.storeId !== null && req.storeId !== scope.storeId) {
      throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, '无权操作该门店');
    }
    if (scope.merchantId !== null && req.merchantId !== scope.merchantId) {
      throw BizException.forbidden(ReasonCode.STORE_NOT_OWNED, '无权操作该门店');
    }
    if (req.status !== ChangeStatus.PENDING) {
      throw BizException.conflict(ReasonCode.STORE_CHANGE_NOT_PENDING, '该申请已审核，不可作废');
    }

    // 作废 = 删除 PENDING 记录（状态机无 CANCELLED 值），完整快照留审计，保证可追溯
    await this.prisma.$transaction(async (tx) => {
      await tx.storeChangeRequest.delete({ where: { id } });
      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'store',
          action: 'store:change-cancel',
          targetType: 'store_change_request',
          targetId: id,
          before: { storeId: req.storeId, changes: req.changes, status: req.status },
          after: { status: 'CANCELLED' },
          ip,
          userAgent: ua,
        },
        tx,
      );
    });

    return { id, cancelled: true };
  }
}
