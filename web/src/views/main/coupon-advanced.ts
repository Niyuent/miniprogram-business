/**
 * 券模板「高级营销配置」——前端先行落在 rules 字段（`[ADV]...[/ADV]`），
 * 后端 schema 扩展后可平滑迁移为独立列。
 */

export type ClaimLimitMode = 'UNLIMITED' | 'PER_USER' | 'NEW_CUSTOMER';
export type ProductScope = 'ALL' | 'SPECIFIED' | 'EXCLUDE_SALE';
export type IssueDeadlineType = 'PERMANENT' | 'DATE';

export interface CouponAdvancedConfig {
  claimLimitMode: ClaimLimitMode;
  /** claimLimitMode=PER_USER 时有效 */
  perUserLimitN: number;
  productScope: ProductScope;
  /** productScope=SPECIFIED 时的本店商品 ID */
  productIds: string[];
  /** 核销时要求实付金额 > 面值（商家自选，默认关） */
  requirePaidGreaterThanFace: boolean;
  issueDeadlineType: IssueDeadlineType;
  /** issueDeadlineType=DATE 时 YYYY-MM-DD */
  issueDeadline: string | null;
}

export const DEFAULT_ADVANCED: CouponAdvancedConfig = {
  claimLimitMode: 'PER_USER',
  perUserLimitN: 1,
  productScope: 'ALL',
  productIds: [],
  requirePaidGreaterThanFace: false,
  issueDeadlineType: 'PERMANENT',
  issueDeadline: null,
};

const ADV_RE = /\[ADV\]([\s\S]*?)\[\/ADV\]/;

export function parseAdvancedFromRules(rules: string | null | undefined): {
  advanced: CouponAdvancedConfig;
  humanRules: string;
} {
  if (!rules) return { advanced: { ...DEFAULT_ADVANCED }, humanRules: '' };
  const m = rules.match(ADV_RE);
  if (!m) return { advanced: { ...DEFAULT_ADVANCED }, humanRules: rules };
  try {
    const parsed = JSON.parse(m[1]) as Partial<CouponAdvancedConfig>;
    return {
      advanced: { ...DEFAULT_ADVANCED, ...parsed, productIds: parsed.productIds ?? [] },
      humanRules: rules.replace(ADV_RE, '').trim(),
    };
  } catch {
    return { advanced: { ...DEFAULT_ADVANCED }, humanRules: rules };
  }
}

export function serializeRules(humanRules: string, advanced: CouponAdvancedConfig): string {
  const blob = `[ADV]${JSON.stringify(advanced)}[/ADV]`;
  const text = humanRules.trim();
  return text ? `${blob}\n${text}` : blob;
}

/** 面值 ≥ 10 且无门槛 → 展示羊毛警示（不拦截提交） */
export function showWoolWarning(faceValue: number, thresholdAmount: number): boolean {
  return Number(faceValue) >= 10 && Number(thresholdAmount) === 0;
}
