import { request } from '@/utils/request';

/**
 * 商家互结清分：会员从本店（A）兑换了别家（B）发的券并核销后，
 * 每个自然月按券面值轧差，算出「谁该补谁多少钱」。
 * 与「智能结算」（平台→商家对账单）完全独立。
 */

export interface ClearingBill {
  id: number;
  periodKey: string;
  payerMerchantId: number;
  payerMerchantName: string;
  receiverMerchantId: number;
  receiverMerchantName: string;
  grossForward: number;
  grossReverse: number;
  netAmount: number;
  forwardCount: number;
  reverseCount: number;
  status: 'UNSETTLED' | 'SETTLED';
  settledAt: string | null;
  settleRemark: string | null;
}

export interface ClearingPeriodRow {
  periodKey: string;
  /** 本商家作为付款方（该补给别人的） */
  payable: number;
  /** 本商家作为收款方（别人该补我的） */
  receivable: number;
  net: number;
  billCount: number;
}

export interface ClearingMyView {
  merchantId: number;
  merchantName: string;
  current: ClearingPeriodRow | null;
  totals: {
    payable: number;
    receivable: number;
    net: number;
    pendingCount: number;
    settledCount: number;
  };
  periods: ClearingPeriodRow[];
  bills: ClearingBill[];
}

export interface ClearingItem {
  id: number;
  code: string | null;
  templateName: string | null;
  faceValue: number;
  pointsCost: number;
  /** ADD = 计入本账单应付，OFFSET = 反向抵扣 */
  effect: 'ADD' | 'OFFSET';
  payerMerchantName: string;
  receiverMerchantName: string;
  redeemMerchantName: string;
  storeName: string;
  redeemedAt: string;
}

export interface ClearingBillDetail extends ClearingBill {
  items: ClearingItem[];
}

/** 我的应付 / 应收汇总（后端按登录商家强制隔离，只看与自己相关的） */
export function fetchMyClearing() {
  return request<ClearingMyView>({ url: '/merchant-clearing/my', redirectOn401: false });
}

export function fetchClearingBills(params: { periodKey?: string; page?: number; pageSize?: number } = {}) {
  return request<{ list: ClearingBill[]; total: number; page: number; pageSize: number }>({
    url: '/merchant-clearing/bills',
    data: params,
    redirectOn401: false,
  });
}

export function fetchClearingBillDetail(id: number) {
  return request<ClearingBillDetail>({
    url: `/merchant-clearing/bills/${id}`,
    redirectOn401: false,
  });
}
