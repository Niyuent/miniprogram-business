import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';

export type UserStatus = 'ACTIVE' | 'DISABLED';

export interface UserListItem {
  id: number;
  phone: string;
  nickname: string | null;
  avatar: string | null;
  status: UserStatus;
  registeredAt: string;
  /** 是否已绑定微信（C 端登录过） */
  bound: boolean;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  orderCount: number;
  couponCount: number;
  redemptionCount: number;
}

export interface UserDetail {
  profile: {
    id: number;
    phone: string;
    nickname: string | null;
    avatar: string | null;
    status: UserStatus;
    openid: string | null;
    unionid: string | null;
    registeredAt: string;
    createdAt: string;
  };
  account: { balance: number; totalEarned: number; totalSpent: number };
  coupons: Array<{ id: number; code: string; status: string; templateId: number; obtainedAt: string; expireAt: string | null; issuerMerchantId: number }>;
  orders: Array<{ id: number; orderNo: string; payAmount: number; status: string; consumeTime: string | null; merchantId: number; storeId: number | null }>;
  redemptions: Array<{ id: number; code: string; status: string; redeemedAt: string; merchantId: number; storeId: number | null }>;
  sourceMerchants: Array<{ id: number; name: string; type: string }>;
}

export interface QueryUsers {
  page?: number;
  pageSize?: number;
  phone?: string;
  keyword?: string;
  status?: UserStatus;
  registeredFrom?: string;
  registeredTo?: string;
}

/** 用户管理（S5.2，主体后台） */
export const userApi = {
  list(params: QueryUsers) {
    return http<PageResult<UserListItem>>({ url: '/users', method: 'GET', params });
  },
  detail(id: number) {
    return http<UserDetail>({ url: `/users/${id}`, method: 'GET' });
  },
  updateStatus(id: number, status: UserStatus) {
    return http<{ id: number; status: UserStatus; unchanged: boolean }>({
      url: `/users/${id}/status`,
      method: 'PATCH',
      data: { status },
    });
  },
  bindPhone(id: number, phone: string) {
    return http<{ id: number; phone: string; unchanged: boolean }>({
      url: `/users/${id}/bind-phone`,
      method: 'POST',
      data: { phone },
    });
  },
};
