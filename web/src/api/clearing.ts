import { http } from '@/utils/request';

/**
 * 商家互结清分（「从哪家店兑换 → 该店补发券商家多少钱」）。
 * 与 settlement.ts 的「平台 → 商家对账单」是两套独立的账。
 */

export type ClearingBillStatus = 'UNSETTLED' | 'SETTLED';
export type ClearingPeriodStatus = 'GENERATED' | 'CLOSED';

export interface ClearingPeriod {
  id: number;
  /** YYYY-MM，北京时间自然月，按核销时间归期 */
  periodKey: string;
  periodStart: string;
  periodEnd: string;
  billCount: number;
  itemCount: number;
  netTotal: number;
  status: ClearingPeriodStatus;
  generatedAt: string;
  recalculatedAt: string | null;
}

export interface ClearingBill {
  id: number;
  periodId: number;
  periodKey: string;
  payerMerchantId: number;
  payerMerchantName: string;
  receiverMerchantId: number;
  receiverMerchantName: string;
  /** 净额方向上的原始合计 */
  grossForward: number;
  /** 反方向原始合计（被抵扣掉的部分） */
  grossReverse: number;
  netAmount: number;
  forwardCount: number;
  reverseCount: number;
  status: ClearingBillStatus;
  settledAt: string | null;
  settledBy: number | null;
  settleRemark: string | null;
  createdAt: string;
}

export interface ClearingItem {
  id: number;
  redemptionId: number;
  exchangeRecordId: number | null;
  couponInstanceId: number;
  templateId: number;
  templateName: string | null;
  code: string | null;
  faceValue: number;
  pointsCost: number;
  /** ADD = 计入这张账单的应付；OFFSET = 反向抵扣 */
  effect: 'ADD' | 'OFFSET';
  /** A：兑换进入的商家 */
  payerMerchantId: number;
  payerMerchantName: string;
  /** B：发券商家 */
  receiverMerchantId: number;
  receiverMerchantName: string;
  /** C：实际核销商家（仅追溯，不参与资金方向） */
  redeemMerchantId: number | null;
  redeemMerchantName: string;
  storeId: number | null;
  storeName: string;
  userId: number;
  redeemedAt: string;
}

export interface ClearingBillDetail extends ClearingBill {
  items: ClearingItem[];
}

export interface ClearingMyView {
  merchantId: number;
  merchantName: string;
  current: {
    periodKey: string;
    payable: number;
    receivable: number;
    net: number;
    billCount: number;
  } | null;
  totals: {
    payable: number;
    receivable: number;
    net: number;
    pendingCount: number;
    settledCount: number;
  };
  periods: Array<{
    periodKey: string;
    payable: number;
    receivable: number;
    net: number;
    billCount: number;
  }>;
  bills: ClearingBill[];
}

export const clearingApi = {
  periods() {
    return http<{ list: ClearingPeriod[] }>({ url: '/merchant-clearing/periods', method: 'GET' });
  },
  bills(params: {
    page?: number;
    pageSize?: number;
    periodKey?: string;
    status?: ClearingBillStatus;
    merchantId?: number;
  } = {}) {
    return http<{ list: ClearingBill[]; total: number; page: number; pageSize: number }>({
      url: '/merchant-clearing/bills',
      method: 'GET',
      params,
    });
  },
  billDetail(id: number) {
    return http<ClearingBillDetail>({ url: `/merchant-clearing/bills/${id}`, method: 'GET' });
  },
  /** 生成（幂等）/ 重算（已有账单已结算时会被后端拒绝） */
  generate(payload: { periodKey: string; recalculate?: boolean }) {
    return http<ClearingPeriod & { idempotent?: boolean; regenerated?: boolean; rawCount?: number }>({
      url: '/merchant-clearing/generate',
      method: 'POST',
      data: payload,
    });
  },
  settle(id: number, payload: { settled: boolean; remark?: string }) {
    return http<{ id: number; status: ClearingBillStatus; settledAt: string | null; idempotent: boolean }>({
      url: `/merchant-clearing/bills/${id}/settle`,
      method: 'POST',
      data: payload,
    });
  },
};
