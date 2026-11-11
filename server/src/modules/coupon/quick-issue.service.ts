import { Injectable, Logger } from '@nestjs/common';
import {
  CouponCodeStatus,
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
import { SubscriptionService } from '../subscription/subscription.service';
import { generateCouponCodes } from './coupon-code.util';
import { CouponInstanceService } from './coupon-instance.service';
import { QuickIssueDto } from './dto/quick-issue.dto';

const ACTION = { quickIssue: 'coupon:quick-issue' } as const;
const FACE_VALUE_MAX = 500;

/**
 * 小程序「快速建券并发放」
 * - 主体：建 MAIN_COUPON
 * - 附属：建 SUB_COUPON（本人归属）；需有启用中的发主体券授权，或具备 coupon:issue 权限
 * - 面值硬上限 500
 */
@Injectable()
export class QuickIssueService {
  private readonly logger = new Logger('QuickIssue');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly instances: CouponInstanceService,
    private readonly subs: SubscriptionService,
  ) {}

  /**
   * 券归属联盟 = 「适用商家」共同所属的联盟。
   *
   * 旧实现按 merchant.type（组织层级：主体/附属）找 creator 的 MAIN 联盟并兜底 1，
   * 会把「联盟 2 的盟主」发的券也塞进联盟 1——它在 merchants.type 里是 SUB（父主体是商家 1），
   * 但在 merchant_alliances 里对联盟 2 的 role 是 MAIN。两个维度不能混用，
   * 结果就是除联盟 1 外所有积分商城都是空的。
   *
   * 规则：
   *  - 适用商家 = targetMerchantIds；allMerchants 展开为「本店 + 附属」；缺省就是发券商家自己
   *  - 一次发券只投放一个联盟；桥店（同属多联盟）优先投到自己作为盟主的那个联盟
   *  - allMerchants 只覆盖该联盟内的商家（全体 = 本联盟全体，不跨联盟）
   */
  private async resolveScopeAlliance(
    selfId: number,
    dto: QuickIssueDto,
  ): Promise<{ allianceId: number; scopeMerchantIds: number[]; scopeStoreIds: number[] }> {
    const explicit = [...new Set(dto.targetMerchantIds ?? [])];
    const children = dto.allMerchants
      ? await this.prisma.merchant.findMany({
          where: { parentId: selfId, status: MerchantStatus.APPROVED },
          select: { id: true },
        })
      : [];
    const candidates = dto.allMerchants
      ? [selfId, ...children.map((c) => c.id)]
      : explicit.length
        ? explicit
        : [selfId];

    const memberships = await this.prisma.merchantAlliance.findMany({
      where: { merchantId: { in: candidates } },
      select: { merchantId: true, allianceId: true, role: true },
    });
    const alliancesOf = new Map<number, Set<number>>();
    const mainOfSelf = new Set<number>();
    for (const m of memberships) {
      const set = alliancesOf.get(m.merchantId) ?? new Set<number>();
      set.add(m.allianceId);
      alliancesOf.set(m.merchantId, set);
      if (m.merchantId === selfId && m.role === 'MAIN') mainOfSelf.add(m.allianceId);
    }

    // 取所有适用商家共同所属的联盟；没有联盟关系的历史商家不参与收窄
    const known = candidates
      .map((id) => alliancesOf.get(id))
      .filter((s): s is Set<number> => !!s && s.size > 0);
    let common = known.length
      ? known.reduce((acc, s) => new Set([...acc].filter((id) => s.has(id))), new Set(known[0]))
      : new Set<number>(memberships.map((m) => m.allianceId));

    if (dto.allianceId) {
      if (!common.has(dto.allianceId)) {
        throw BizException.badRequest(
          ReasonCode.FORBIDDEN_SCOPE,
          `投放联盟 #${dto.allianceId} 与所选适用商家不属于同一联盟`,
        );
      }
      common = new Set([dto.allianceId]);
    }
    if (!common.size) {
      throw BizException.badRequest(
        ReasonCode.FORBIDDEN_SCOPE,
        '所选商家分属不同联盟，请分开发券（一次发券只投放一个联盟）',
      );
    }

    const sorted = [...common].sort((a, b) => a - b);
    const allianceId = sorted.find((id) => mainOfSelf.has(id)) ?? sorted[0];

    const scoped = dto.allMerchants
      ? candidates.filter((id) => alliancesOf.get(id)?.has(allianceId) ?? false)
      : explicit;
    const scopeMerchantIds = scoped.length ? scoped : [selfId];

    // 适用商家 → 适用门店：商家选的「某家 / 多选 / 全体」同时决定券能在哪些门店核销。
    // 主体商家代表整个联盟且常常没有自己的门店，选中它时把该联盟全部成员商家的门店纳入，
    // 否则会造出「适用商家没门店 → 券一张都用不了」的死券。
    const allianceMembers = await this.prisma.merchantAlliance.findMany({
      where: { allianceId },
      select: { merchantId: true, role: true },
    });
    const mainIds = new Set(
      allianceMembers.filter((m) => m.role === 'MAIN').map((m) => m.merchantId),
    );
    const wholeAlliance = scopeMerchantIds.some((id) => mainIds.has(id));
    const storeMerchantIds = wholeAlliance
      ? allianceMembers.map((m) => m.merchantId)
      : scopeMerchantIds;
    const stores = await this.prisma.store.findMany({
      where: { merchantId: { in: storeMerchantIds } },
      select: { id: true },
    });
    const scopeStoreIds = [...new Set(stores.map((s) => s.id))];

    return { allianceId, scopeMerchantIds, scopeStoreIds };
  }

  async quickIssue(dto: QuickIssueDto, user: JwtPayload, ip?: string, ua?: string) {
    if (!user.merchantId) {
      throw BizException.forbidden(ReasonCode.SCOPE_NOT_READY, '当前账号未绑定商家，无法发券');
    }

    const benefitType = dto.benefitType === 'ITEM' ? 'ITEM' : 'VOUCHER';
    const itemName = dto.itemName?.trim() || '';
    let faceValue = Number(dto.faceValue ?? 0);
    let threshold = dto.thresholdAmount ?? 0;
    // 积分兑换价：>0 则该券进入积分兑换商城，会员花 N 积分兑换。
    // 这里只做兜底（DTO 已校验），Floor 防止前端传小数。
    const pointsCost = Math.max(0, Math.floor(Number(dto.pointsCost ?? 0)));
    const exchangeEnabled = dto.exchangeEnabled ?? true;
    const perUserLimit = Math.max(0, Math.floor(Number(dto.perUserLimit ?? 0)));

    if (benefitType === 'ITEM') {
      if (!itemName) {
        throw BizException.badRequest(ReasonCode.INVALID_ADJUST_AMOUNT, '请填写可兑换的具体物品');
      }
      if (faceValue < 0 || faceValue > FACE_VALUE_MAX) {
        throw BizException.badRequest(
          ReasonCode.INVALID_ADJUST_AMOUNT,
          `参考价值需在 0–${FACE_VALUE_MAX} 元`,
        );
      }
      threshold = 0;
    } else {
      if (!(faceValue > 0) || faceValue > FACE_VALUE_MAX) {
        throw BizException.badRequest(
          ReasonCode.INVALID_ADJUST_AMOUNT,
          `面值需在 0.01–${FACE_VALUE_MAX} 元`,
        );
      }
      if (threshold < 0) {
        throw BizException.badRequest(ReasonCode.INVALID_ADJUST_AMOUNT, '门槛不能为负');
      }
    }

    const self = await this.prisma.merchant.findUnique({
      where: { id: user.merchantId },
      select: { id: true, name: true, type: true, status: true, parentId: true },
    });
    if (!self || self.status !== MerchantStatus.APPROVED) {
      throw BizException.forbidden(ReasonCode.MERCHANT_NOT_ACTIVE, '商家未审核通过，无法建券');
    }

    const isMain = self.type === MerchantType.MAIN;
    if (!isMain) {
      const allowed = await this.subCanQuickCreate(self.id);
      if (!allowed) {
        throw BizException.forbidden(
          ReasonCode.SUB_MERCHANT_NOT_AUTHORIZED,
          '附属商家未被授权发券，无法快速建券',
        );
      }
    }

    const validDays = dto.validDays ?? 7;
    const totalStock = dto.totalStock;
    const name =
      dto.name?.trim() ||
      (benefitType === 'ITEM'
        ? `兑换：${itemName}`
        : threshold > 0
          ? `满${threshold}减${faceValue}`
          : `${faceValue}元无门槛券`);
    const subtitle =
      benefitType === 'ITEM' ? `到店兑换「${itemName}」` : '小程序快速建券';
    const description =
      benefitType === 'ITEM'
        ? `到店出示本券可兑换：${itemName}（领取后 ${validDays} 天内有效）`
        : `有效期领取后 ${validDays} 天`;

    // 主体券由自己创建；附属券归属自己，创建者记父主体（兼容 H1 字段语义）
    const creatorMerchantId = isMain ? self.id : self.parentId || self.id;
    const ownerType = isMain ? CouponOwnerType.MAIN_COUPON : CouponOwnerType.SUB_COUPON;
    const ownerMerchantId = self.id;

    // 券投放到哪个积分商城，由「适用商家」所在的联盟决定，不再退回父主体或兜底 1
    const { allianceId, scopeMerchantIds, scopeStoreIds } = await this.resolveScopeAlliance(
      self.id,
      dto,
    );

    // 停服闸门：盟主会员到期 → 联盟内停发券（与发分同一条规则）
    const alliance = await this.prisma.alliance.findUnique({
      where: { id: allianceId },
      select: { mainMerchantId: true },
    });
    if (alliance) {
      await this.subs.assertMainMemberActive(alliance.mainMerchantId, '发券');
    }

    const batchNo = `Q${Date.now().toString(36).toUpperCase()}`;

    const template = await this.prisma.$transaction(async (tx) => {
      const created = await tx.couponTemplate.create({
        data: {
          allianceId,
          creatorMerchantId,
          ownerMerchantId,
          ownerType,
          name,
          subtitle,
          couponType: 'VOUCHER',
          faceValue,
          thresholdAmount: threshold,
          pointsCost,
          exchangeEnabled,
          purchasePrice: 0,
          totalStock,
          validType: 'AFTER_RECEIVE_DAYS',
          validDays,
          applyScope: scopeStoreIds.length ? 'SPECIFIED_STORES' : 'ALL_STORES',
          perUserLimit,
          requireGreaterThanFace: false,
          applicableScope: {
            claimLimitMode: 'UNLIMITED',
            productScope: 'ALL',
            productIds: [],
            issueDeadlineType: 'PERMANENT',
            issueDeadline: null,
            source: 'QUICK_ISSUE',
            benefitType,
            ...(benefitType === 'ITEM' ? { itemName } : {}),
          } as Prisma.InputJsonValue,
          status: CouponTemplateStatus.PUBLISHED,
          description,
          rules: benefitType === 'ITEM' ? `兑换物品：${itemName}` : null,
        },
      });

      // 把「适用商家」展开的门店写进适用范围关系表，核销时才会真正限制门店
      if (scopeStoreIds.length) {
        await tx.couponTemplateStore.createMany({
          data: scopeStoreIds.map((storeId) => ({ templateId: created.id, storeId })),
          skipDuplicates: true,
        });
      }

      const batch = await tx.couponCodeBatch.create({
        data: {
          batchNo,
          templateId: created.id,
          quantity: totalStock,
          remark: 'quick-issue',
          operatorId: user.sub,
        },
      });

      let codes: string[] = [];
      for (let attempt = 1; attempt <= 3; attempt++) {
        codes = generateCouponCodes(totalStock);
        try {
          await tx.couponCode.createMany({
            data: codes.map((code) => ({
              code,
              templateId: created.id,
              batchNo,
              batchId: batch.id,
              status: CouponCodeStatus.UNISSUED,
            })),
          });
          break;
        } catch (e) {
          if (attempt >= 3) throw e;
          this.logger.warn(`quick-issue 券码碰撞重试 ${attempt}`);
        }
      }

      await this.audit.record(
        {
          operatorId: user.sub,
          operatorType: user.userType,
          operatorName: user.username,
          module: 'coupon',
          action: ACTION.quickIssue,
          targetType: 'coupon_template',
          targetId: created.id,
          before: null,
          after: {
            name,
            benefitType,
            itemName: benefitType === 'ITEM' ? itemName : null,
            faceValue,
            thresholdAmount: threshold,
            pointsCost,
            exchangeEnabled,
            perUserLimit,
            allianceId,
            applyScope: scopeStoreIds.length ? 'SPECIFIED_STORES' : 'ALL_STORES',
            scopeStoreIds,
            validDays,
            totalStock,
            ownerType,
            batchNo,
          },
          ip: ip ?? null,
          userAgent: ua ?? null,
        },
        tx,
      );

      return created;
    });

    // 立即发放：有目标商家 / 指定会员 / 明确 audience 时走现有 issueWithScope
    let issueResult: unknown = null;
    const hasMerchantScope =
      !!dto.allMerchants || (Array.isArray(dto.targetMerchantIds) && dto.targetMerchantIds.length > 0);
    const hasUserTarget = !!dto.userId || !!dto.phone;
    const audience =
      dto.audience ||
      (hasUserTarget ? 'USER' : hasMerchantScope ? 'MERCHANT_VISITORS' : undefined);
    const shouldIssue = !!audience;

    if (shouldIssue) {
      try {
        issueResult = await this.instances.issueWithScope(
          {
            templateId: template.id,
            quantity: dto.quantity ?? 1,
            audience,
            userId: dto.userId,
            phone: dto.phone,
            // allMerchants 已收敛成「本联盟内的商家 id」，传具体范围避免发放端
            // 再按 parentId 展开到别的联盟
            targetMerchantIds: scopeMerchantIds.length
              ? scopeMerchantIds
              : dto.targetMerchantIds?.length
                ? dto.targetMerchantIds
                : hasMerchantScope
                  ? undefined
                  : [self.id],
            allMerchants: dto.allMerchants && !scopeMerchantIds.length,
            merchantId: isMain && dto.targetMerchantIds?.[0] ? dto.targetMerchantIds[0] : undefined,
            remark: '小程序快速建券并发放',
          },
          user,
          ip,
          ua,
        );
      } catch (e) {
        // 模板已建好；发放失败不回滚建券，把原因带回
        this.logger.warn(
          `quick-issue 建券成功但发放失败 template#${template.id}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
        const benefitLabel =
          benefitType === 'ITEM'
            ? `「${itemName}」兑换券`
            : `${faceValue} 元${threshold > 0 ? `满${threshold}` : '无门槛'}券`;
        return {
          templateId: template.id,
          allianceId: template.allianceId,
          name: template.name,
          benefitType,
          itemName: benefitType === 'ITEM' ? itemName : null,
          faceValue: Number(template.faceValue),
          thresholdAmount: Number(template.thresholdAmount),
          pointsCost: Number(template.pointsCost),
          exchangeEnabled: template.exchangeEnabled,
          perUserLimit: Number(template.perUserLimit),
          applyScope: template.applyScope,
          scopeStoreIds,
          validDays,
          totalStock,
          status: template.status,
          issued: false,
          issueError: e instanceof Error ? e.message : String(e),
          message: `券模板已创建并上架（库存 ${totalStock}），但发放失败：${
            e instanceof Error ? e.message : String(e)
          }`,
          benefitLabel,
        };
      }
    }

    const benefitLabel =
      benefitType === 'ITEM'
        ? `「${itemName}」兑换券`
        : `${faceValue} 元${threshold > 0 ? `满${threshold}` : '无门槛'}券`;

    return {
      templateId: template.id,
      allianceId: template.allianceId,
      name: template.name,
      benefitType,
      itemName: benefitType === 'ITEM' ? itemName : null,
      faceValue: Number(template.faceValue),
      thresholdAmount: Number(template.thresholdAmount),
      pointsCost: Number(template.pointsCost),
      exchangeEnabled: template.exchangeEnabled,
      perUserLimit: Number(template.perUserLimit),
      applyScope: template.applyScope,
      scopeStoreIds,
      validDays,
      totalStock,
      status: template.status,
      issued: shouldIssue,
      issue: issueResult,
      message: shouldIssue
        ? `已生成并发放：${totalStock} 张 ${benefitLabel}`
        : `已生成券模板「${name}」并上架，库存 ${totalStock} 张，可继续选择对象发放`,
    };
  }

  /** 附属：有启用中的「发主体券」授权即可快速建自己的附属券 */
  private async subCanQuickCreate(subMerchantId: number) {
    const auth = await this.prisma.merchantAuthorization.findFirst({
      where: { subMerchantId, status: 'ENABLED', authType: 'ISSUE_MAIN_COUPON' },
      select: { id: true },
    });
    return !!auth;
  }
}
