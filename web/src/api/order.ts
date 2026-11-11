import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';

/** 订单列表项 */
export interface OrderListItem {
  id: number;
  orderNo: string;
  userId: number;
  userName: string | null;
  userPhone: string | null;
  merchantId: number;
  merchantName: string | null;
  storeId: number | null;
  storeName: string | null;
  orderType: string;
  totalAmount: number;
  payAmount: number;
  pointsEarned: number;
  status: string;
  abnormalType: string | null;
  couponInstanceId: number | null;
  couponCode: string | null;
  couponStatus: string | null;
  handleResult: string | null;
  handledAt: string | null;
  consumeTime: string;
  createdAt: string;
}

/** 订单详情 */
export interface OrderDetail {
  order: OrderListItem & {
    discountAmount: number;
    abnormalRemark: string | null;
    handledBy: number | null;
    source: string;
    couponInstance: {
      id: number;
      code: string;
      status: string;
      templateName: string | null;
      faceValue: number;
    } | null;
  };
  redemptions: Array<{
    id: number;
    code: string;
    status: string;
    faceValue: number;
    discountAmount: number;
    redeemedAt: string;
    reverseReason: string | null;
    reversedAt: string | null;
  }>;
  pointTxns: Array<{
    id: number;
    type: string;
    amount: number;
    remainingAmount: number;
    balanceAfter: number;
    sourceTransactionId: number | null;
    originBatchId: number | null;
    relatedOrderId: number | null;
    relatedCouponInstanceId: number | null;
    remark: string | null;
    createdAt: string;
  }>;
}

export interface OrderQuery {
  page?: number;
  pageSize?: number;
  status?: string;
  orderNo?: string;
  userId?: number;
  storeId?: number;
  from?: string;
  to?: string;
}

export const orderApi = {
  list(params: OrderQuery = {}) {
    return http<PageResult<OrderListItem>>({ url: '/orders', method: 'GET', params });
  },
  abnormal(params: Omit<OrderQuery, 'status'> = {}) {
    return http<PageResult<OrderListItem>>({ url: '/orders/abnormal', method: 'GET', params });
  },
  detail(id: number) {
    return http<OrderDetail>({ url: `/orders/${id}`, method: 'GET' });
  },
  create(payload: {
    orderNo: string;
    userId: number;
    merchantId?: number;
    storeId?: number;
    orderType?: 'CONSUME' | 'EXCHANGE';
    totalAmount: number;
    discountAmount?: number;
    payAmount?: number;
    source?: 'APPLET' | 'WEB' | 'IMPORT';
    amount?: number;
    remark?: string;
  }) {
    return http<{ order: { id: number; orderNo: string; status: string }; points: unknown }>({
      url: '/orders',
      method: 'POST',
      data: payload,
    });
  },
  markAbnormal(id: number, payload: { abnormalType: string; abnormalRemark: string }) {
    return http({ url: `/orders/${id}/abnormal`, method: 'PATCH', data: payload });
  },
  handle(id: number, payload: { handleType: 'CANCEL' | 'AMOUNT_ERROR' | 'DISPUTE'; result?: string }) {
    return http({ url: `/orders/${id}/handle`, method: 'POST', data: payload });
  },
};
