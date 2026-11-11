/**
 * 业务类型定义
 *
 * ⚠️ S1.4 起**对齐真实后端**（NestJS + Prisma），不再是前期 Mock 时期的臆测结构：
 *  - 所有日期字段后端返回 ISO 字符串
 *  - 分页统一 `{ list, total, page, pageSize }`
 *  - 金额类字段（faceValue 等）后端 Decimal 序列化为 number
 */

export type MerchantType = 'MAIN' | 'SUB';
export type MerchantStatus = 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REJECTED';
export type AdminUserType = 'PLATFORM' | 'MERCHANT' | 'STORE';
export type AuthStatus = 'ENABLED' | 'DISABLED';
export type TemplateScope = 'ALL' | 'SPECIFIED';

// ---------------------------------------------------------------- 积分（S3.1）

/** 积分流水类型：获取 / 消耗 / 过期 / 回退 / 人工调整 */
export type PointTxnType = 'EARN' | 'SPEND' | 'EXPIRE' | 'REFUND' | 'ADJUST';

/** 积分账户（列表项） */
export interface PointAccount {
  id: number;
  userId: number;
  userName: string | null;
  userPhone: string | null;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  totalExpired: number;
  /** 30 天内过期的可用积分（运营提醒用） */
  expiringSoon: number;
  /** 乐观锁版本号：并发写冲突时后端据此重试 / 报 409 */
  version: number;
  updatedAt: string;
}

/** 积分批次（账户详情里的明细） */
export interface PointBatch {
  id: number;
  type: PointTxnType;
  amount: number;
  remainingAmount: number;
  expireAt: string | null;
  /** 未过期 = 可用于 FIFO 消耗；已过期即便有剩余也不能花 */
  usable: boolean;
  merchantId: number | null;
  merchantName: string | null;
  storeId: number | null;
  createdAt: string;
  remark: string | null;
}

/** 积分账户详情 */
export interface PointAccountDetail {
  account: PointAccount;
  summary: {
    /** 真正能花的（未过期批次剩余之和），与 balance 的差额 = 已过期待清理 */
    available: number;
    expiringSoon: number;
    expiredPending: number;
    batchCount: number;
  };
  batches: PointBatch[];
}

/** 积分流水 */
export interface PointTransaction {
  id: number;
  userId: number;
  userName: string | null;
  userPhone: string | null;
  type: PointTxnType;
  /** 带符号：EARN/REFUND 为正，SPEND/EXPIRE 为负，ADJUST 同传入符号 */
  amount: number;
  /** 该批次剩余可消耗积分（FIFO 扣减对象） */
  remainingAmount: number;
  balanceAfter: number;
  expireAt: string | null;
  merchantId: number | null;
  merchantName: string | null;
  storeId: number | null;
  relatedOrderId: number | null;
  relatedCouponInstanceId: number | null;
  /** EXPIRE 流水指回的原 EARN 批次 id（S3.3，幂等键） */
  sourceTransactionId: number | null;
  /** SPEND/REFUND 流水关联的原 EARN 批次 id（S4 收口） */
  originBatchId: number | null;
  operatorId: number | null;
  operatorName: string | null;
  remark: string | null;
  createdAt: string;
}

/** 积分规则：merchantId=0 表示平台级默认 */
export interface PointRule {
  id: number;
  merchantId: number;
  level: 'PLATFORM' | 'MERCHANT';
  earnRatio: number;
  minAmount: number;
  pointsValidMonths: number;
  expireMode: 'FIXED_MONTHS' | 'YEAR_END';
  status: number;
  effectiveAt: string;
  updatedAt: string;
}

/** 积分兑换记录（S3.2） */
export interface ExchangeRecord {
  id: number;
  userId: number;
  userName: string | null;
  userPhone: string | null;
  templateId: number;
  templateName: string | null;
  faceValue: number | null;
  couponInstanceId: number | null;
  code: string | null;
  couponStatus: string | null;
  couponExpireAt: string | null;
  pointsCost: number;
  requestId: string;
  channel: string;
  operatorId: number | null;
  remark: string | null;
  createdAt: string;
}

/** 积分兑换结果（幂等重复提交时 idempotent=true 且返回上次那张券） */
export interface ExchangeResult {
  idempotent: boolean;
  exchangeId?: number;
  couponInstanceId?: number;
  code?: string | null;
  expireAt?: string | null;
  pointsCost?: number;
  balance?: number;
  deductions?: Array<{ txnId: number; amount: number; expireAt: string | null }>;
}

/** 消费录单送积分结果 */
export interface EarnPointsResult {
  earned: boolean;
  points: number;
  reasonCode?: 'BELOW_MIN_AMOUNT' | 'POINTS_ZERO';
  message?: string;
  transactionId?: number;
  expireAt?: string;
  balance?: number;
  rule?: { merchantId: number | null; earnRatio: number; minAmount: number };
}

export interface LoginParams {
  username: string;
  password: string;
}

/** POST /auth/login 的返回（后端 AuthService.LoginResult） */
export interface LoginResult {
  accessToken: string;
  expiresIn: string;
  user: {
    id: number;
    username: string;
    realName: string | null;
    phone: string | null;
    userType: AdminUserType;
    merchantId: number | null;
    merchantName: string | null;
    storeId: number | null;
    storeName: string | null;
    lastLoginAt: string | null;
  };
  roles: string[];
  permissions: string[];
  /** true = 系统生成的初始账号还没改过密，前端需提示改密 */
  mustChangePassword: boolean;
}

/** GET /auth/profile 的返回 */
export interface UserProfile {
  id: number;
  username: string;
  realName: string | null;
  phone: string | null;
  userType: AdminUserType;
  status: string;
  lastLoginAt: string | null;
  merchant: {
    id: number;
    name: string;
    code: string;
    type: MerchantType;
    status: MerchantStatus;
  } | null;
  store: { id: number; name: string } | null;
  roles: string[];
  permissions: string[];
}

export interface DashboardStats {
  cards: Array<{
    key: string;
    label: string;
    value: number;
    unit?: string;
    trend?: number;
  }>;
  todo: {
    pendingMerchants: number;
    abnormalOrders: number;
    unreadNotifications: number;
  };
}

// ---------------------------------------------------------------- 商家 / 入驻审核

/** GET /merchants/applications 列表项 */
export interface MerchantApplication {
  id: number;
  code: string;
  name: string;
  contactName: string | null;
  contactPhone: string | null;
  licenseNo: string | null;
  licenseImages: string[] | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  status: MerchantStatus;
  auditRemark: string | null;
  auditedAt: string | null;
  createdAt: string;
}

/** GET /merchants 列表项 */
export interface Merchant {
  id: number;
  code: string;
  name: string;
  type: MerchantType;
  contactName: string | null;
  contactPhone: string | null;
  status: MerchantStatus;
  auditRemark: string | null;
  createdAt: string;
  parent: { id: number; name: string } | null;
  _count: { stores: number; adminUsers: number };
}

/** GET /merchants/:id 详情 */
export interface MerchantDetail extends Omit<Merchant, '_count'> {
  parentId: number | null;
  licenseNo: string | null;
  licenseImages: string[] | null;
  province: string | null;
  city: string | null;
  district: string | null;
  address: string | null;
  settleContact: string | null;
  auditorId: number | null;
  auditedAt: string | null;
  stores: Array<{ id: number; name: string; code: string; status: string }>;
  adminUsers: Array<{
    id: number;
    username: string;
    realName: string | null;
    userType: AdminUserType;
    status: string;
  }>;
}

/** 审核通过返回（含一次性初始口令） */
export interface ApproveResult {
  merchant: MerchantDetail;
  account: { username: string; password: string; adminUserId: number } | null;
  hint: string | null;
}

// ---------------------------------------------------------------- 授权

export interface AuthorizationItem {
  id: number;
  mainMerchantId: number;
  mainMerchantName: string | null;
  subMerchantId: number;
  subMerchantName: string | null;
  authType: string;
  status: AuthStatus;
  templateScope: TemplateScope;
  templateIds: number[];
  grantedBy: number | null;
  grantedAt: string | null;
  revokedBy: number | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface AvailableTemplate {
  id: number;
  name: string;
  couponType: string;
  faceValue: number;
  thresholdAmount: number;
  pointsCost: number;
  totalStock: number;
  issuedCount: number;
  validEnd: string | null;
}

export interface CreateAuthorizationPayload {
  subMerchantId: number;
  templateScope: TemplateScope;
  authType?: string;
  templateIds?: number[];
}

/** GET /me/authorizations —— 附属商家自视的生效授权（S2.2 发放页用它展示授权范围） */
export interface MeAuthorization {
  issueMainCoupon: {
    authorizationId: number;
    mainMerchantId: number;
    templateScope: TemplateScope;
    allowsAllTemplates: boolean;
    templateIds: number[];
    grantedAt: string | null;
  } | null;
  authorizations: AuthorizationItem[];
}

export interface AuthorizationLogItem {
  id: number;
  action: string;
  result: string;
  targetType: string | null;
  targetId: number | null;
  operatorId: number | null;
  operatorType: string | null;
  operatorName: string | null;
  ip: string | null;
  before: Record<string, any> | null;
  after: Record<string, any> | null;
  createdAt: string;
}

// ---------------------------------------------------------------- 操作日志

export interface AuditLogItem {
  id: number;
  module: string;
  action: string;
  result: string;
  targetType: string | null;
  targetId: number | null;
  operatorId: number | null;
  operatorType: string | null;
  operatorName: string | null;
  ip: string | null;
  hasDetail: boolean;
  createdAt: string;
}

/** GET /audit-logs/:id 详情（before/after 已由后端脱敏） */
export interface AuditLogDetail extends AuditLogItem {
  operatorUsername: string | null;
  userAgent: string | null;
  before: unknown;
  after: unknown;
}

// ---------------------------------------------------------------- 代金券（S2.1）

/** 券归属类型：主体券 / 附属商家券 */
export type CouponOwnerType = 'MAIN_COUPON' | 'SUB_COUPON';

/** 有效期类型：固定区间 / 领取后 N 天 */
export type ValidType = 'FIXED' | 'AFTER_RECEIVE_DAYS';

/** 适用范围：全部门店 / 指定门店 / 指定商家（S4 预留，后端暂不支持） */
export type ApplyScope = 'ALL_STORES' | 'SPECIFIED_STORES' | 'SPECIFIED_MERCHANTS';

/** 券模板状态 */
export type CouponTemplateStatus = 'DRAFT' | 'PUBLISHED' | 'UNPUBLISHED' | 'VOID';

/** 券模板（列表 / 详情共用，与后端 CouponTemplateView 对齐） */
export interface CouponTemplate {
  id: number;
  name: string;
  subtitle: string | null;
  ownerType: CouponOwnerType;
  ownerMerchantId: number;
  ownerMerchantName: string | null;
  creatorMerchantId: number;
  couponType: string;
  faceValue: number;
  thresholdAmount: number;
  pointsCost: number;
  /** 是否参与积分兑换（商家自选开关）：关掉即从兑换商城下架，已发出的券不受影响 */
  exchangeEnabled?: boolean;
  purchasePrice: number;
  totalStock: number;
  issuedCount: number;
  usedCount: number;
  remainingStock: number;
  validType: ValidType;
  validStart: string | null;
  validEnd: string | null;
  validDays: number;
  applyScope: ApplyScope;
  storeIds: number[];
  stores: Array<{ id: number; name: string }>;
  perUserLimit: number;
  /** 与 perUserLimit 同义（limit_per_user） */
  limitPerUser?: number;
  requireGreaterThanFace?: boolean;
  applicableScope?: {
    claimLimitMode?: 'UNLIMITED' | 'PER_USER' | 'NEW_CUSTOMER';
    productScope?: 'ALL' | 'SPECIFIED' | 'EXCLUDE_SALE';
    productIds?: string[];
    issueDeadlineType?: 'PERMANENT' | 'DATE';
    issueDeadline?: string | null;
  } | null;
  status: CouponTemplateStatus;
  /** 后端给好的结论：仅 DRAFT / UNPUBLISHED 为 true，前端直接用它决定编辑按钮 */
  editable: boolean;
  description: string | null;
  rules: string | null;
  createdAt: string;
  updatedAt: string;
  /**
   * S2.4：列表用的**实算**统计（后端按 coupon_instances groupBy 现算），用于「已发放 / 已核销」列。
   * 与冗余计数 `issuedCount / usedCount` 并列展示：`drift` 为 true 说明两者已经不一致
   * （历史数据 / 脚本修数 / 异常中断），前端会标出来而不是默默信任计数。
   * 注意与详情接口 `stats`（券码 / 券实例分状态统计）区分，两者命名刻意不同。
   */
  instanceStats?: {
    issuedCount: number;
    usedCount: number;
    unusedCount: number;
    frozenCount: number;
    expiredCount: number;
    drift: { issued: boolean; used: boolean };
  };
  /** 券效果看板 */
  effectStats?: {
    issuedCount: number;
    totalStock: number;
    redeemedCount: number;
    drivenPayAmount: number;
    discountTotal: number;
  };
}

/** 券实例详情（S2.2 字段 + S2.4 关联核销记录） */
export interface CouponInstanceRedemption {
  id: number;
  code: string | null;
  status: RedemptionStatus;
  channel: RedemptionChannel;
  storeId: number | null;
  storeName: string | null;
  operatorId: number | null;
  operatorName: string | null;
  orderId: number | null;
  orderNo: string | null;
  faceValue: number;
  discountAmount: number;
  reverseReason: string | null;
  reversedAt: string | null;
  redeemedAt: string;
}

export interface CouponInstanceDetail extends CouponInstance {
  faceValue: number;
  thresholdAmount: number;
  applyScope: ApplyScope;
  stores: Array<{ id: number; name: string }>;
  /** 这张券被核销过的记录（含已冲正），没有则为空数组 */
  redemptions: CouponInstanceRedemption[];
}

/** 券模板详情：列表字段 + 券码 / 券实例统计 */
export interface CouponTemplateStats {
  codes: Record<string, number>;
  instances: Record<string, number>;
}

export interface CouponTemplateDetail extends CouponTemplate {
  stats: CouponTemplateStats;
  effectStats?: CouponTemplate['effectStats'];
}

/** GET /coupon-templates/:id/effect-details */
export interface CouponEffectDetailRow {
  redemptionId: number;
  code: string;
  userId: number;
  userName: string | null;
  userPhone: string | null;
  faceValue: number;
  discountAmount: number;
  orderId: number | null;
  orderNo: string | null;
  payAmount: number | null;
  totalAmount: number | null;
  redeemedAt: string;
  storeId: number | null;
  merchantId: number | null;
}

/** POST /coupon-templates */
export interface CreateCouponTemplatePayload {
  ownerType: CouponOwnerType;
  ownerMerchantId?: number;
  name: string;
  subtitle?: string;
  couponType?: 'VOUCHER' | 'DISCOUNT';
  faceValue: number;
  thresholdAmount?: number;
  pointsCost?: number;
  /** 是否参与积分兑换（商家自选开关） */
  exchangeEnabled?: boolean;
  purchasePrice?: number;
  totalStock: number;
  validType?: ValidType;
  validStart?: string;
  validEnd?: string;
  validDays?: number;
  applyScope?: ApplyScope;
  storeIds?: number[];
  perUserLimit?: number;
  description?: string;
  rules?: string;
}

/** PUT /coupon-templates/:id（字段全可选） */
export type UpdateCouponTemplatePayload = Partial<Omit<CreateCouponTemplatePayload, 'ownerType' | 'ownerMerchantId'>>;

/** 门店简要信息（核销页选门店用，来自 /sub/stores） */
export interface StoreBrief {
  id: number;
  name: string;
  code: string | null;
  status: string;
}

// ---------------------------------------------------------------- 核销（S2.3）

export type RedemptionStatus = 'SUCCESS' | 'REVERSED';
export type RedemptionChannel = 'MANUAL' | 'SCAN' | 'API';

/** 逐项校验明细（后端 runChecks 产出，前端逐条展示「卡在哪一步」） */
export interface RedemptionCheck {
  item: string;
  passed: boolean;
  reasonCode?: string;
  message?: string;
}

export interface VerifyCouponResult {
  redeemable: boolean;
  reasonCode: string | null;
  reason: string | null;
  coupon: {
    instanceId: number;
    code: string | null;
    templateId: number;
    templateName: string | null;
    faceValue: number;
    thresholdAmount: number;
    status: string;
    userId: number;
    userName: string | null;
    userPhone: string | null;
    expireAt: string;
    applyScope: string | null;
    stores: Array<{ id: number; name: string }>;
  } | null;
  store: { id: number; name: string } | null;
  discountAmount: number | null;
  checks: RedemptionCheck[];
}

export interface RedemptionRecord {
  id: number;
  code: string;
  instanceId: number;
  templateId: number;
  templateName: string | null;
  userId: number;
  userName: string | null;
  userPhone: string | null;
  storeId: number | null;
  storeName: string | null;
  merchantId: number | null;
  merchantName: string | null;
  faceValue: number;
  discountAmount: number;
  orderId: number | null;
  /** S2.4：订单号（列表单独 join 取回，便于导出与追溯） */
  orderNo: string | null;
  channel: RedemptionChannel;
  status: RedemptionStatus;
  /** S2.4：冲正原因（≥5 字符，必填）与时间 */
  reverseReason: string | null;
  reversedAt: string | null;
  redeemedAt: string;
}

/** 按商家维度分组合计（主体看全平台时用） */
export interface RedemptionSummary {
  merchantId: number | null;
  merchantName: string | null;
  count: number;
  faceValueTotal: number;
  discountTotal: number;
}

// ---------------------------------------------------------------- 券码（S2.2）

/** 券码状态 */
export type CouponCodeStatus = 'UNISSUED' | 'ISSUED' | 'REDEEMED' | 'VOID';

export interface CouponCode {
  id: number;
  code: string;
  batchNo: string;
  batchId: number | null;
  templateId: number;
  status: CouponCodeStatus;
  instanceId: number | null;
  generatedAt: string;
}

export interface CouponCodeStats {
  unused: number;
  issued: number;
  redeemed: number;
}

/** 券码批次（S2.2）：S2.4 起每批带「未发放 / 已发放 / 已核销 / 作废」实算明细 */
export interface CouponCodeBatch {
  id: number;
  batchNo: string;
  templateId: number;
  quantity: number;
  actualCount: number;
  stats?: {
    UNISSUED: number;
    ISSUED: number;
    REDEEMED: number;
    VOID: number;
  };
  remark: string | null;
  operatorId: number | null;
  operatorName?: string | null;
  createdAt: string;
}

export interface GenerateCodesPayload {
  batchNo?: string;
  quantity: number;
  remark?: string;
}

// ---------------------------------------------------------------- 券实例（S2.2）

export type CouponInstanceStatus = 'UNUSED' | 'USED' | 'EXPIRED' | 'FROZEN';
export type CouponSource = 'EXCHANGE' | 'MERCHANT_ISSUE' | 'GIFT';

export interface CouponInstance {
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
  obtainedAt: string;
  expireAt: string;
  usedAt: string | null;
  createdAt: string;
}

export interface IssueCouponPayload {
  templateId: number;
  userId?: number;
  phone?: string;
  quantity?: number;
  remark?: string;
}

export interface IssueCouponResult {
  issued: CouponInstance[];
  quantity: number;
  expireAt: string;
}
