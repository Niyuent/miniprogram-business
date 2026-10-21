import { request } from '@/utils/request';

export interface WorkbenchData {
  greeting: string;
  bossName: string;
  storeName: string;
  storeId: number | null;
  merchantId: number;
  merchantName: string;
  today: { redemptions: number; pointsIssued: number };
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

export function fetchWorkbench() {
  return request<WorkbenchData>({ url: '/mini/workbench' });
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
}) {
  return request<{ id: number }>({
    url: '/redemptions',
    method: 'POST',
    data: {
      code: body.code,
      orderAmount: body.orderAmount,
      orderNo: body.orderNo,
      ...(body.storeId ? { storeId: body.storeId } : {}),
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

export function fetchMaskedMember(userId: number) {
  return request<{ name: string; phone: string; userId: number }>({
    url: `/users/${userId}/masked-info`,
    redirectOn401: false,
  });
}

export function earnPoints(body: {
  userId: number;
  amount: number;
  orderId?: number;
  requestId?: string;
  storeId?: number | null;
}) {
  return request<{ earned: boolean; points: number; reasonCode?: string; message?: string }>({
    url: '/points/earn',
    method: 'POST',
    data: {
      userId: body.userId,
      amount: body.amount,
      ...(body.orderId ? { orderId: body.orderId } : {}),
      ...(body.requestId ? { requestId: body.requestId } : {}),
      storeId: body.storeId ?? undefined,
      remark: '扫码录单送积分',
    },
    redirectOn401: false,
  });
}
