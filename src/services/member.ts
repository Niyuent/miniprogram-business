import { request } from '@/utils/request';

export interface PointAccount {
  account: { balance: number; userName: string | null };
  summary: { available: number; expiringSoon: number };
}

export interface CouponTemplate {
  id: number;
  name: string;
  subtitle: string | null;
  faceValue: number;
  thresholdAmount: number;
  pointsCost: number;
  remainingStock: number;
}

export interface CouponCard {
  id: number;
  code: string | null;
  status: string;
  name: string;
  subtitle: string;
  faceValue: number;
  expireAt: string;
}

export interface PageResult<T> {
  list: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MemberProfile {
  id: number;
  nickname: string | null;
  avatar: string | null;
  phone: string | null;
}

export function fetchPointAccount() {
  return request<PointAccount>({ url: '/h5/points/account' });
}

export function fetchCouponTemplates(page: number, pageSize = 10) {
  return request<PageResult<CouponTemplate>>({
    url: `/h5/coupon-templates?page=${page}&pageSize=${pageSize}`,
  });
}

export function fetchMyCoupons(status: 'UNUSED' | 'USED' | 'EXPIRED', page: number, pageSize = 10) {
  return request<PageResult<CouponCard>>({
    url: `/h5/my/coupons?status=${status}&page=${page}&pageSize=${pageSize}`,
  });
}

export function fetchMe() {
  return request<MemberProfile>({ url: '/h5/me' });
}

export function fetchPointTransactions(page: number, pageSize = 10) {
  return request<PageResult<{ id: number; type: string; amount: number; createdAt: string; remark: string | null }>>({
    url: `/h5/points/transactions?page=${page}&pageSize=${pageSize}`,
  });
}

export function exchangeCoupon(body: { userId: number; templateId: number; requestId: string }) {
  return request<{ instanceId?: number; pointsCost?: number }>({
    url: '/h5/points/exchange',
    method: 'POST',
    data: { ...body, channel: 'H5' },
    redirectOn401: false,
  });
}

export function dayText(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}
