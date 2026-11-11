import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';

export interface PurchaseItem {
  id: number;
  purchaseNo: string;
  mainMerchantId: number;
  mainMerchantName: string | null;
  subMerchantId: number;
  subMerchantName: string | null;
  templateId: number;
  templateName: string | null;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  settleStatus: string;
  settleRemark: string | null;
  purchasedAt: string;
  createdAt: string;
}

export const purchaseApi = {
  list(params: {
    page?: number;
    pageSize?: number;
    subMerchantId?: number;
    settleStatus?: string;
    from?: string;
    to?: string;
  } = {}) {
    return http<PageResult<PurchaseItem>>({ url: '/purchases', method: 'GET', params });
  },
  create(payload: {
    subMerchantId?: number;
    mainMerchantId?: number;
    templateId: number;
    quantity: number;
    unitPrice: number;
    totalAmount?: number;
    purchasedAt?: string;
    remark?: string;
  }) {
    return http<{ id: number; purchaseNo: string; totalAmount: number; settleStatus: string }>({
      url: '/purchases',
      method: 'POST',
      data: payload,
    });
  },
  settle(id: number, payload: { settleRemark?: string } = {}) {
    return http<{ id: number; settleStatus: string; settleRemark: string | null }>({
      url: `/purchases/${id}/settle`,
      method: 'PATCH',
      data: payload,
    });
  },
};
