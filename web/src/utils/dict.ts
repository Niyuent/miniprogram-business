import type {
  ApplyScope,
  CouponCodeStatus,
  CouponInstanceStatus,
  CouponOwnerType,
  CouponSource,
  CouponTemplateStatus,
  MerchantStatus,
  MerchantType,
  PointTxnType,
  RedemptionChannel,
  RedemptionStatus,
  ValidType,
} from '@/types/business';

/** 商家状态 → 中文 + Element Tag 类型 */
export const MERCHANT_STATUS: Record<
  MerchantStatus,
  { label: string; type: 'success' | 'info' | 'warning' | 'danger' }
> = {
  PENDING: { label: '待审核', type: 'warning' },
  APPROVED: { label: '已通过', type: 'success' },
  SUSPENDED: { label: '已暂停', type: 'info' },
  REJECTED: { label: '已驳回', type: 'danger' },
};

/** 商家类型 → 中文 */
export const MERCHANT_TYPE: Record<MerchantType, string> = {
  MAIN: '主体商家',
  SUB: '附属商家',
};

/**
 * 表格里 row 的类型是 `any`，直接 `MERCHANT_STATUS[row.status]` 会触发 TS7053
 * （用 any 去做索引），所以统一走这两个显式函数：既保住类型，也不会因为脏数据报运行时错。
 */
export function statusLabel(status: MerchantStatus): string {
  return MERCHANT_STATUS[status]?.label ?? status;
}

export function statusTagType(status: MerchantStatus): 'success' | 'info' | 'warning' | 'danger' {
  return MERCHANT_STATUS[status]?.type ?? 'info';
}

export function typeLabel(type: MerchantType): string {
  return MERCHANT_TYPE[type] ?? type;
}

/** 入驻申请筛选下拉（后端按单个 status 精确过滤） */
export const APPLICATION_STATUS_OPTIONS = [
  { value: 'PENDING', label: '待审核' },
  { value: 'APPROVED', label: '已通过' },
  { value: 'REJECTED', label: '已驳回' },
  { value: 'SUSPENDED', label: '已暂停' },
];

/** 操作日志常见模块（后端 module 字段） */
export const AUDIT_MODULE_OPTIONS = [
  { value: 'merchant', label: '商家 / 入驻审核' },
  { value: 'authorization', label: '授权管理' },
  { value: 'coupon', label: '代金券' },
  { value: 'auth', label: '认证 / 账号' },
];

// ---------------------------------------------------------------- 代金券（S2.1）

/** 券模板状态 → 中文 + Tag 类型 */
export const COUPON_TEMPLATE_STATUS: Record<
  CouponTemplateStatus,
  { label: string; type: 'success' | 'info' | 'warning' | 'danger' }
> = {
  DRAFT: { label: '草稿', type: 'info' },
  PUBLISHED: { label: '已上架', type: 'success' },
  UNPUBLISHED: { label: '已下架', type: 'warning' },
  VOID: { label: '已作废', type: 'danger' },
};

/** 券归属类型 → 中文 */
export const COUPON_OWNER_TYPE: Record<CouponOwnerType, string> = {
  MAIN_COUPON: '主体券',
  SUB_COUPON: '附属商家券',
};

export const COUPON_VALID_TYPE: Record<ValidType, string> = {
  FIXED: '固定有效期',
  AFTER_RECEIVE_DAYS: '领取后 N 天',
};

export const COUPON_APPLY_SCOPE: Record<ApplyScope, string> = {
  ALL_STORES: '全部门店',
  SPECIFIED_STORES: '指定门店',
  SPECIFIED_MERCHANTS: '指定商家（未实现）',
};

export const COUPON_TEMPLATE_STATUS_OPTIONS = [
  { value: 'DRAFT', label: '草稿' },
  { value: 'PUBLISHED', label: '已上架' },
  { value: 'UNPUBLISHED', label: '已下架' },
  { value: 'VOID', label: '已作废' },
];

export const COUPON_OWNER_TYPE_OPTIONS = [
  { value: 'MAIN_COUPON', label: '主体券' },
  { value: 'SUB_COUPON', label: '附属商家券' },
];

export function couponStatusLabel(status: CouponTemplateStatus): string {
  return COUPON_TEMPLATE_STATUS[status]?.label ?? status;
}

export function couponStatusTagType(
  status: CouponTemplateStatus,
): 'success' | 'info' | 'warning' | 'danger' {
  return COUPON_TEMPLATE_STATUS[status]?.type ?? 'info';
}

/** 券码状态 → 中文 + Tag 类型（S2.2） */
export const COUPON_CODE_STATUS: Record<
  CouponCodeStatus,
  { label: string; type: 'success' | 'info' | 'warning' | 'danger' }
> = {
  UNISSUED: { label: '未发放', type: 'info' },
  ISSUED: { label: '已发放', type: 'warning' },
  REDEEMED: { label: '已核销', type: 'success' },
  VOID: { label: '已作废', type: 'danger' },
};

export const COUPON_CODE_STATUS_OPTIONS = [
  { value: 'UNISSUED', label: '未发放' },
  { value: 'ISSUED', label: '已发放' },
  { value: 'REDEEMED', label: '已核销' },
  { value: 'VOID', label: '已作废' },
];

/** 券实例状态 → 中文 + Tag 类型（S2.2） */
export const COUPON_INSTANCE_STATUS: Record<
  CouponInstanceStatus,
  { label: string; type: 'success' | 'info' | 'warning' | 'danger' }
> = {
  UNUSED: { label: '未使用', type: 'success' },
  USED: { label: '已核销', type: 'info' },
  EXPIRED: { label: '已过期', type: 'warning' },
  FROZEN: { label: '已冻结', type: 'danger' },
};

export const COUPON_INSTANCE_STATUS_OPTIONS = [
  { value: 'UNUSED', label: '未使用' },
  { value: 'USED', label: '已核销' },
  { value: 'EXPIRED', label: '已过期' },
  { value: 'FROZEN', label: '已冻结' },
];

export const COUPON_SOURCE: Record<CouponSource, string> = {
  EXCHANGE: '积分兑换',
  MERCHANT_ISSUE: '商家发放',
  GIFT: '活动赠送',
};

export function couponCodeStatusLabel(status: CouponCodeStatus): string {
  return COUPON_CODE_STATUS[status]?.label ?? status;
}

export function couponCodeStatusTagType(
  status: CouponCodeStatus,
): 'success' | 'info' | 'warning' | 'danger' {
  return COUPON_CODE_STATUS[status]?.type ?? 'info';
}

export function couponInstanceStatusLabel(status: CouponInstanceStatus): string {
  return COUPON_INSTANCE_STATUS[status]?.label ?? status;
}

export function couponInstanceStatusTagType(
  status: CouponInstanceStatus,
): 'success' | 'info' | 'warning' | 'danger' {
  return COUPON_INSTANCE_STATUS[status]?.type ?? 'info';
}

/** 核销记录状态 → 中文 + Tag 类型（S2.3） */
export const REDEMPTION_STATUS: Record<
  RedemptionStatus,
  { label: string; type: 'success' | 'info' | 'warning' | 'danger' }
> = {
  SUCCESS: { label: '核销成功', type: 'success' },
  REVERSED: { label: '已冲正', type: 'danger' },
};

export const REDEMPTION_STATUS_OPTIONS = [
  { value: 'SUCCESS', label: '核销成功' },
  { value: 'REVERSED', label: '已冲正' },
];

export const REDEMPTION_CHANNEL: Record<RedemptionChannel, string> = {
  MANUAL: '手输券码',
  SCAN: '扫码',
  API: '开放接口',
};

export function redemptionStatusLabel(status: RedemptionStatus): string {
  return REDEMPTION_STATUS[status]?.label ?? status;
}

export function redemptionStatusTagType(
  status: RedemptionStatus,
): 'success' | 'info' | 'warning' | 'danger' {
  return REDEMPTION_STATUS[status]?.type ?? 'info';
}

// ---------------------------------------------------------------- 积分（S3.1）

/** 积分流水类型 → 中文 + Tag 类型。正数类型（EARN/REFUND）用绿色，负数用灰/红 */
export const POINT_TXN_TYPE: Record<
  PointTxnType,
  { label: string; type: 'success' | 'info' | 'warning' | 'danger' }
> = {
  EARN: { label: '消费获得', type: 'success' },
  SPEND: { label: '兑换消耗', type: 'warning' },
  EXPIRE: { label: '过期清零', type: 'danger' },
  REFUND: { label: '退款回退', type: 'success' },
  ADJUST: { label: '人工调整', type: 'danger' },
};

export const POINT_TXN_TYPE_OPTIONS = [
  { value: 'EARN', label: '消费获得' },
  { value: 'SPEND', label: '兑换消耗' },
  { value: 'EXPIRE', label: '过期清零' },
  { value: 'REFUND', label: '退款回退' },
  { value: 'ADJUST', label: '人工调整' },
];

export function pointTxnTypeLabel(type: PointTxnType): string {
  return POINT_TXN_TYPE[type]?.label ?? type;
}

export function pointTxnTypeTagType(type: PointTxnType): 'success' | 'info' | 'warning' | 'danger' {
  return POINT_TXN_TYPE[type]?.type ?? 'info';
}

/** 带符号积分的展示：正数加 +，负数本身就是 -123 */
export function pointAmountText(amount: number): string {
  return amount > 0 ? `+${amount}` : String(amount);
}

/** 有效期文案：DTO / 列表 / 详情共用一种口径，避免前端各自解释 */
export function validPeriodText(row: {
  validType: ValidType;
  validStart: string | null;
  validEnd: string | null;
  validDays: number;
}): string {
  if (row.validType === 'FIXED') {
    if (!row.validStart || !row.validEnd) return '未设置';
    return `${formatDateTime(row.validStart).slice(0, 10)} ~ ${formatDateTime(row.validEnd).slice(0, 10)}`;
  }
  return `领取后 ${row.validDays} 天内有效`;
}

/** 统一时间格式：2026-10-06 14:03:12 */
export function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

/**
 * 手机号脱敏（S5.5-1 附属订单列表用）：138****1234
 *
 * 后端 `GET /orders` 返回的是完整手机号（主体端订单页需要），
 * 附属侧只应看到脱敏值，故在前端展示层统一收敛（不改接口，避免影响既有页面与用例）。
 */
export function maskPhone(phone?: string | null): string {
  if (!phone) return '-';
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 7) return phone; // 位数不足视为非手机号，原样返回
  return `${digits.slice(0, 3)}****${digits.slice(-4)}`;
}

/** ISO 时间串：给后端的 from/to（带时区偏移，避免前后端时区不一致导致筛选错位） */
export function toIso(value: string | null | undefined, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return undefined;
  // 'YYYY-MM-DD' 这种只到日期的值，截止时间要补到当天最后一毫秒，否则当天日志会被漏掉
  if (endOfDay && value.length === 10) {
    d.setHours(23, 59, 59, 999);
  }
  return d.toISOString();
}

// ---------------------------------------------------------------- 对账账单（S4.2）

/**
 * 对账单状态 → 中文 + Tag 类型
 * GENERATING 生成中（灰）→ GENERATED 待确认（蓝）→ CONFIRMED 已确认（绿）/ DISPUTED 有异议（红）
 * key 用 string 而非联合类型：状态由后端下发，脏数据时不至于运行时报错。
 */
export const SETTLEMENT_STATUS: Record<
  string,
  { label: string; type: 'success' | 'info' | 'warning' | 'danger' | 'primary' }
> = {
  GENERATING: { label: '生成中', type: 'info' },
  GENERATED: { label: '待确认', type: 'primary' },
  CONFIRMED: { label: '已确认', type: 'success' },
  DISPUTED: { label: '有异议', type: 'danger' },
};

export const SETTLEMENT_STATUS_OPTIONS = [
  { value: 'GENERATING', label: '生成中' },
  { value: 'GENERATED', label: '待确认' },
  { value: 'CONFIRMED', label: '已确认' },
  { value: 'DISPUTED', label: '有异议' },
];

export function settlementStatusLabel(status: string): string {
  return SETTLEMENT_STATUS[status]?.label ?? status;
}

export function settlementStatusTagType(
  status: string,
): 'success' | 'info' | 'warning' | 'danger' | 'primary' {
  return SETTLEMENT_STATUS[status]?.type ?? 'info';
}
