import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';

export type StoreStatus = 'OPEN' | 'CLOSED' | 'SUSPENDED';
export type ChangeStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export interface StoreBrief {
  id: number;
  merchantId: number;
  name: string;
  code: string | null;
  contactName?: string | null;
  contactPhone?: string | null;
  address?: string | null;
  businessHours?: string | null;
  status: StoreStatus;
}

/** 变更项：{ old, new } */
export interface ChangeEntry {
  old: unknown;
  new: unknown;
}

export interface StoreChangeRequest {
  id: number;
  storeId: number;
  merchantId: number;
  applicantId: number | null;
  changes: Record<string, ChangeEntry>;
  reason: string | null;
  status: ChangeStatus;
  reviewerId: number | null;
  reviewRemark: string | null;
  reviewedAt: string | null;
  createdAt: string;
  store?: { id: number; name: string; code: string | null; merchantId: number };
}

/** 可变更字段（与后端白名单一致） */
export interface StoreChangePayload {
  name?: string;
  contactName?: string;
  contactPhone?: string;
  province?: string;
  city?: string;
  district?: string;
  address?: string;
  lng?: number;
  lat?: number;
  businessHours?: string;
  logo?: string;
  reason?: string;
}

export interface QueryStoreChanges {
  page?: number;
  pageSize?: number;
  status?: ChangeStatus;
  storeId?: number;
  merchantId?: number;
}

/** 变更字段中文名 */
export const CHANGE_FIELD_LABELS: Record<string, string> = {
  name: '门店名称',
  contactName: '联系人',
  contactPhone: '联系电话',
  province: '省',
  city: '市',
  district: '区',
  address: '地址',
  lng: '经度',
  lat: '纬度',
  businessHours: '营业时间',
  logo: 'Logo',
};

/** 门店变更申请（S5.3） */
export const storeApi = {
  // 附属：本商家门店
  listMyStores(keyword?: string) {
    return http<StoreBrief[]>({ url: '/sub/stores', method: 'GET', params: { keyword } });
  },
  getStore(id: number) {
    return http<StoreBrief>({ url: `/sub/stores/${id}`, method: 'GET' });
  },

  // 附属：本门店的变更申请
  listStoreChanges(storeId: number) {
    return http<StoreChangeRequest[]>({ url: `/stores/${storeId}/change-requests`, method: 'GET' });
  },
  submitChange(storeId: number, data: StoreChangePayload) {
    return http<StoreChangeRequest>({ url: `/stores/${storeId}/change-requests`, method: 'POST', data });
  },
  cancelChange(id: number) {
    return http<{ id: number; cancelled: boolean }>({ url: `/stores/change-requests/${id}/cancel`, method: 'POST' });
  },

  // 主体：审核
  reviewList(params: QueryStoreChanges) {
    return http<PageResult<StoreChangeRequest>>({ url: '/stores/change-requests', method: 'GET', params });
  },
  reviewDetail(id: number) {
    return http<StoreChangeRequest>({ url: `/stores/change-requests/${id}`, method: 'GET' });
  },
  review(id: number, decision: 'APPROVE' | 'REJECT', remark?: string) {
    return http<StoreChangeRequest>({
      url: `/stores/change-requests/${id}/review`,
      method: 'POST',
      data: { decision, remark },
    });
  },
};
