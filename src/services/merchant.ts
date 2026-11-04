import { request } from '@/utils/request';
import { parseScannedMember, type ScannedMember } from '@/utils/memberQr';

export interface WorkbenchData {
  greeting: string;
  bossName: string;
  storeName: string;
  storeId: number | null;
  merchantId: number;
  merchantName: string;
  merchantType?: 'MAIN' | 'SUB';
  today: { redemptions: number; pointsIssued: number };
}

export interface IssueMerchantOption {
  id: number;
  name: string;
  role: 'MAIN' | 'SUB';
}

export interface IssueOptions {
  merchantType: 'MAIN' | 'SUB';
  merchantId: number;
  merchantName: string;
  onlyMainCoupons: boolean;
  /** 主体或已授权附属可快速新建券 */
  canQuickCreate?: boolean;
  merchants: IssueMerchantOption[];
}

export function quickIssueCoupon(body: {
  name?: string;
  /** VOUCHER=金额减免；ITEM=到店兑换物品 */
  benefitType?: 'VOUCHER' | 'ITEM';
  itemName?: string;
  faceValue?: number;
  thresholdAmount?: number;
  validDays: number;
  totalStock: number;
  targetMerchantIds?: number[];
  audience?: 'USER' | 'MERCHANT_VISITORS';
  userId?: number;
  phone?: string;
  quantity?: number;
  allMerchants?: boolean;
}) {
  return request<{
    templateId: number;
    name: string;
    benefitType?: 'VOUCHER' | 'ITEM';
    itemName?: string | null;
    faceValue: number;
    thresholdAmount: number;
    validDays: number;
    totalStock: number;
    status: string;
    issued: boolean;
    message: string;
    issueError?: string;
    issue?: unknown;
  }>({
    url: '/coupons/quick-issue',
    method: 'POST',
    data: body,
    redirectOn401: false,
  });
}

export function fetchIssueOptions() {
  return request<IssueOptions>({ url: '/mini/issue-options', redirectOn401: false });
}

export interface FinanceCheckup {
  bound: boolean;
  has_data: boolean;
  score: number | null;
  cash_months: number | null;
}

export interface CouponPreview {
  faceValue: number;
  userPhone: string | null;
  templateName: string | null;
  thresholdAmount: number;
}

export interface MemberDeskCoupon {
  id: number;
  code: string | null;
  expireAt: string;
  templateId: number;
  name: string;
  faceValue: number;
  thresholdAmount: number;
}

export interface MemberDeskTemplate {
  id: number;
  name: string;
  faceValue: number;
  thresholdAmount: number;
  pointsCost: number;
  remainingStock: number;
}

export interface MemberDesk {
  member: { userId: number; name: string; phone: string };
  storeId: number | null;
  storeName: string;
  merchantId: number;
  pointsAvailable: number;
  coupons: MemberDeskCoupon[];
  exchangeTemplates: MemberDeskTemplate[];
}

export function fetchWorkbench() {
  return request<WorkbenchData>({ url: '/mini/workbench' });
}

/** 扫会员码后的收银台。优先传票据（5 分钟有效）；userId 仅兼容旧版永久码。 */
export function fetchMemberDesk(target: ScannedMember) {
  const query = target.ticket
    ? `ticket=${encodeURIComponent(target.ticket)}`
    : `userId=${target.userId}`;
  return request<MemberDesk>({
    url: `/mini/member-desk?${query}`,
    redirectOn401: false,
  });
}

/** 把扫码原文解析成会员标识；不是会员码返回 null。 */
export function toScannedMember(raw: string): ScannedMember | null {
  return parseScannedMember(raw);
}

export function exchangeForMember(body: {
  userId: number;
  allianceId: number;
  templateId: number;
  requestId: string;
}) {
  return request<{
    code?: string | null;
    couponInstanceId?: number;
    pointsCost?: number;
  }>({
    url: '/points/exchange',
    method: 'POST',
    data: { ...body, channel: 'WEB' },
    redirectOn401: false,
  });
}

export function fetchFinance() {
  return request<FinanceCheckup>({ url: '/mini/finance/checkup' });
}

export function verifyCoupon(body: { code: string; storeId?: number | null; orderAmount?: number; orderNo?: string }) {
  return request<{
    redeemable: boolean;
    coupon: {
      faceValue: number;
      userPhone: string | null;
      templateName: string | null;
      thresholdAmount: number;
    };
    store: { id: number; name: string } | null;
  }>({
    url: '/redemptions/verify',
    method: 'POST',
    data: {
      code: body.code,
      ...(body.storeId ? { storeId: body.storeId } : {}),
      ...(body.orderAmount != null ? { orderAmount: body.orderAmount } : {}),
      ...(body.orderNo ? { orderNo: body.orderNo } : {}),
    },
    redirectOn401: false,
  });
}

export function redeemCoupon(body: {
  code: string;
  storeId?: number | null;
  orderAmount: number;
  orderNo: string;
  /** 幂等键：一次确认生成一个，重试复用；同键返回首次结果（idempotent:true）而非 409 */
  requestId?: string;
}) {
  return request<{ id: number; idempotent?: boolean }>({
    url: '/redemptions',
    method: 'POST',
    data: {
      code: body.code,
      orderAmount: body.orderAmount,
      orderNo: body.orderNo,
      ...(body.storeId ? { storeId: body.storeId } : {}),
      ...(body.requestId ? { requestId: body.requestId } : {}),
      channel: 'SCAN',
      orderSource: 'APPLET',
    },
    redirectOn401: false,
  });
}

export async function findUserIdByPhone(phone: string): Promise<number | null> {
  const data = await request<{ list: Array<{ id: number; phone: string }> }>({
    url: `/users?phone=${encodeURIComponent(phone)}&pageSize=20`,
  });
  const hit = (data?.list || []).find((row) => row.phone === phone);
  return hit?.id ?? null;
}

export function createConsumeOrder(body: {
  orderNo: string;
  userId: number;
  storeId?: number | null;
  totalAmount: number;
}) {
  return request<{ order: { id: number; orderNo: string } }>({
    url: '/orders',
    method: 'POST',
    data: {
      orderNo: body.orderNo,
      userId: body.userId,
      storeId: body.storeId ?? undefined,
      totalAmount: body.totalAmount,
      payAmount: body.totalAmount,
      source: 'APPLET',
    },
    redirectOn401: false,
  });
}

export interface MerchantAllianceItem {
  allianceId: number;
  name: string;
  role: 'MAIN' | 'SUB';
  mainMerchantId: number;
  sampleMerchants: { merchantId: number; name: string; role: 'MAIN' | 'SUB' }[];
  peerMerchantCount: number;
}

export function fetchMerchantAlliances(merchantId: number) {
  return request<{
    merchantId: number;
    merchantName: string;
    items: MerchantAllianceItem[];
  }>({
    url: `/merchants/${merchantId}/alliances`,
    redirectOn401: false,
  });
}

export function earnPoints(body: {
  userId: number;
  amount: number;
  allianceId: number;
  orderId?: number;
  requestId?: string;
  storeId?: number | null;
}) {
  return request<{
    earned: boolean;
    points: number;
    allianceId?: number;
    allianceName?: string;
    sourceRole?: string;
    reasonCode?: string;
    message?: string;
  }>({
    url: '/points/earn',
    method: 'POST',
    data: {
      userId: body.userId,
      amount: body.amount,
      allianceId: body.allianceId,
      ...(body.orderId ? { orderId: body.orderId } : {}),
      ...(body.requestId ? { requestId: body.requestId } : {}),
      storeId: body.storeId ?? undefined,
      remark: '扫码录单送积分',
    },
    redirectOn401: false,
  });
}
