import { request } from '@/utils/request';

export interface MemberQrTicket {
  ticket: string;
  expiresAt: string;
}

/** 会员码票据：5 分钟有效，扫 member-desk 时优先用它反查会员。 */
export function fetchMemberQrTicket() {
  return request<MemberQrTicket>({ url: '/mini/member-qr' });
}

export interface AlliancePointAccount {
  accountId: number;
  allianceId: number;
  allianceName: string;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  available: number;
  /** 通用积分（主体发分，可在所有店换券） */
  mainPoints?: number;
  /** 专属积分（附属发分，仅主体店换券） */
  subPoints?: number;
  main_points?: number;
  sub_points?: number;
}

export interface PointAccount {
  account: {
    balance: number;
    userName: string | null;
    allianceId?: number;
    allianceName?: string | null;
    mainPoints?: number;
    subPoints?: number;
    main_points?: number;
    sub_points?: number;
  };
  accounts?: AlliancePointAccount[];
  lastEarnAllianceId?: number | null;
  summary: {
    available: number;
    expiringSoon: number;
    totalBalance?: number;
    mainPoints?: number;
    subPoints?: number;
    main_points?: number;
    sub_points?: number;
  };
}

export interface CouponTemplate {
  id: number;
  name: string;
  subtitle: string | null;
  faceValue: number;
  thresholdAmount: number;
  pointsCost: number;
  remainingStock: number;
  /** 每人限兑张数，0 = 不限（后端 /h5/coupon-templates 已返回） */
  perUserLimit?: number;
  ownerType?: 'MAIN_COUPON' | 'SUB_COUPON';
  allianceId?: number;
  requiresMainPoints?: boolean;
}

export interface CouponCard {
  id: number;
  code: string | null;
  status: string;
  name: string;
  subtitle: string;
  faceValue: number;
  /** 券所属联盟名（后端补的，用于卡包显示「在哪家用」） */
  allianceName?: string | null;
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

export function fetchCouponTemplates(page: number, pageSize = 10, allianceId?: number) {
  const aid = allianceId && allianceId > 0 ? `&allianceId=${allianceId}` : '';
  return request<PageResult<CouponTemplate>>({
    url: `/h5/coupon-templates?page=${page}&pageSize=${pageSize}${aid}`,
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
  return request<
    PageResult<{
      id: number;
      type: string;
      amount: number;
      createdAt: string;
      remark: string | null;
      allianceId?: number;
      allianceName?: string | null;
      sourceRole?: 'MAIN' | 'SUB' | null;
      merchantId?: number | null;
      merchantName?: string | null;
    }>
  >({
    url: `/h5/points/transactions?page=${page}&pageSize=${pageSize}`,
  });
}

export function exchangeCoupon(body: {
  userId: number;
  allianceId: number;
  templateId: number;
  requestId: string;
}) {
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
