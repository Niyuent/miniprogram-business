/**
 * 券模板高级营销配置
 * - 前端过渡期仍可能把 ADV 塞进 rules 的 `[ADV]...[/ADV]`
 * - 创建/更新时解析后写入独立列，rules 只保留人类可读备注
 */

export type ClaimLimitMode = 'UNLIMITED' | 'PER_USER' | 'NEW_CUSTOMER';
export type ProductScope = 'ALL' | 'SPECIFIED' | 'EXCLUDE_SALE';
export type IssueDeadlineType = 'PERMANENT' | 'DATE';

export interface CouponApplicableScope {
  claimLimitMode: ClaimLimitMode;
  productScope: ProductScope;
  productIds: string[];
  issueDeadlineType: IssueDeadlineType;
  issueDeadline: string | null;
}

export interface ParsedCouponAdvanced {
  /** 写入 perUserLimit：0=不限 */
  perUserLimit: number;
  requireGreaterThanFace: boolean;
  applicableScope: CouponApplicableScope;
  /** 剥离 ADV 后的人类备注 */
  humanRules: string | null;
  /** 是否从 rules 解析到了 ADV 块 */
  fromAdv: boolean;
}

const ADV_RE = /\[ADV\]([\s\S]*?)\[\/ADV\]/;

const DEFAULT_SCOPE: CouponApplicableScope = {
  claimLimitMode: 'PER_USER',
  productScope: 'ALL',
  productIds: [],
  issueDeadlineType: 'PERMANENT',
  issueDeadline: null,
};

export function parseApplicableScope(raw: unknown): CouponApplicableScope | null {
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  return {
    claimLimitMode: (o.claimLimitMode as ClaimLimitMode) || 'PER_USER',
    productScope: (o.productScope as ProductScope) || 'ALL',
    productIds: Array.isArray(o.productIds) ? o.productIds.map(String) : [],
    issueDeadlineType: (o.issueDeadlineType as IssueDeadlineType) || 'PERMANENT',
    issueDeadline: (o.issueDeadline as string) || null,
  };
}

/**
 * 从 DTO.rules（可能含 ADV）+ 显式字段 合成落库值。
 * 显式字段优先于 ADV。
 */
export function resolveAdvancedFromDto(input: {
  rules?: string | null;
  perUserLimit?: number;
  requireGreaterThanFace?: boolean;
  applicableScope?: CouponApplicableScope | null;
}): ParsedCouponAdvanced {
  let fromAdv = false;
  let humanRules: string | null = input.rules?.trim() || null;
  let adv: Partial<{
    claimLimitMode: ClaimLimitMode;
    perUserLimitN: number;
    productScope: ProductScope;
    productIds: string[];
    requirePaidGreaterThanFace: boolean;
    issueDeadlineType: IssueDeadlineType;
    issueDeadline: string | null;
  }> = {};

  if (humanRules) {
    const m = humanRules.match(ADV_RE);
    if (m) {
      fromAdv = true;
      try {
        adv = JSON.parse(m[1]);
      } catch {
        adv = {};
      }
      humanRules = humanRules.replace(ADV_RE, '').trim() || null;
    }
  }

  const claimLimitMode: ClaimLimitMode =
    input.applicableScope?.claimLimitMode ||
    adv.claimLimitMode ||
    (input.perUserLimit === 0 ? 'UNLIMITED' : 'PER_USER');

  let perUserLimit: number;
  if (input.perUserLimit !== undefined && input.perUserLimit !== null && !fromAdv) {
    perUserLimit = Math.max(0, Number(input.perUserLimit));
  } else if (claimLimitMode === 'UNLIMITED') {
    perUserLimit = 0;
  } else if (claimLimitMode === 'NEW_CUSTOMER') {
    perUserLimit = 1;
  } else {
    perUserLimit = Math.max(1, Number(adv.perUserLimitN ?? input.perUserLimit ?? 1));
  }

  const requireGreaterThanFace =
    input.requireGreaterThanFace ??
    Boolean(adv.requirePaidGreaterThanFace) ??
    false;

  const applicableScope: CouponApplicableScope = {
    claimLimitMode,
    productScope:
      input.applicableScope?.productScope ||
      adv.productScope ||
      DEFAULT_SCOPE.productScope,
    productIds:
      input.applicableScope?.productIds ||
      adv.productIds ||
      DEFAULT_SCOPE.productIds,
    issueDeadlineType:
      input.applicableScope?.issueDeadlineType ||
      adv.issueDeadlineType ||
      DEFAULT_SCOPE.issueDeadlineType,
    issueDeadline:
      input.applicableScope?.issueDeadline !== undefined
        ? input.applicableScope.issueDeadline
        : adv.issueDeadline ?? null,
  };

  return {
    perUserLimit,
    requireGreaterThanFace: Boolean(requireGreaterThanFace),
    applicableScope,
    humanRules,
    fromAdv,
  };
}
