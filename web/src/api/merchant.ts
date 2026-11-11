import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';
import type {
  ApproveResult,
  Merchant,
  MerchantApplication,
  MerchantDetail,
  MerchantStatus,
  MerchantType,
} from '@/types/business';

/** 商家 / 入驻审核（真实后端 /api/v1/merchants/*） */
export const merchantApi = {
  /** 入驻申请列表：后端默认只返回 PENDING */
  applications(params: { page?: number; pageSize?: number; status?: MerchantStatus } = {}) {
    return http<PageResult<MerchantApplication>>({
      url: '/merchants/applications',
      method: 'GET',
      params,
    });
  },
  approve(id: number, data: { auditRemark?: string; createAccount?: boolean } = {}) {
    return http<ApproveResult>({
      url: `/merchants/applications/${id}/approve`,
      method: 'POST',
      data,
    });
  },
  reject(id: number, data: { auditRemark: string }) {
    return http<{ merchant: MerchantDetail }>({
      url: `/merchants/applications/${id}/reject`,
      method: 'POST',
      data,
    });
  },
  list(
    params: {
      page?: number;
      pageSize?: number;
      status?: MerchantStatus;
      type?: MerchantType;
      keyword?: string;
    } = {},
  ) {
    return http<PageResult<Merchant>>({ url: '/merchants', method: 'GET', params });
  },
  detail(id: number) {
    return http<MerchantDetail>({ url: `/merchants/${id}`, method: 'GET' });
  },
  updateStatus(id: number, data: { status: 'APPROVED' | 'SUSPENDED'; remark?: string }) {
    return http<Merchant>({ url: `/merchants/${id}/status`, method: 'PATCH', data });
  },
};
