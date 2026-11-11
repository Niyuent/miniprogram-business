import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';

export interface SubscriptionItem {
  id: number;
  merchantId: number;
  merchantName: string | null;
  merchantCode: string | null;
  planType: 'MAIN_MEMBER' | 'SUB_TIER';
  tier: 'PRIMARY' | 'ADVANCED' | null;
  tierName: string | null;
  tierColor: string | null;
  period: string;
  periodName: string;
  months: number;
  amount: number;
  startsAt: string | null;
  endsAt: string | null;
  status: 'PENDING' | 'ACTIVE' | 'EXPIRED' | 'CANCELLED';
  orderNo: string;
  payChannel: string;
  payRemark: string | null;
  remark: string | null;
  createdAt: string;
}

export const subscriptionApi = {
  /** 后端分页返回的是 items，这里统一成前端的 PageResult（list），避免每个页面各写一套映射 */
  async list(
    params: {
      page?: number;
      pageSize?: number;
      planType?: string;
      status?: string;
      merchantId?: number;
    } = {},
  ): Promise<PageResult<SubscriptionItem>> {
    const res = await http<{
      total: number;
      page: number;
      pageSize: number;
      items: SubscriptionItem[];
    }>({ url: '/subscriptions', method: 'GET', params });
    return {
      list: res.items,
      total: res.total,
      page: res.page,
      pageSize: res.pageSize,
    };
  },
  confirm(id: number, payRemark?: string) {
    return http<SubscriptionItem>({
      url: `/subscriptions/${id}/confirm`,
      method: 'POST',
      data: { payRemark },
    });
  },
  cancel(id: number) {
    return http<SubscriptionItem>({ url: `/subscriptions/${id}/cancel`, method: 'POST', data: {} });
  },
};
