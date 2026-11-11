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
  /** 真正可兑：本联盟批次 + 同时属于本联盟的商家所发积分（桥店口径） */
  spendable?: number;
  /** 通用积分（主体发分，可在所有店换券） */
  mainPoints?: number;
  /** 专属积分（附属发分，仅主体店换券） */
  subPoints?: number;
  main_points?: number;
  sub_points?: number;
}

/** 按发分商家拆开的可用积分：在哪家消费就在哪家获得积分 */
export interface MerchantPointBucket {
  merchantId: number;
  merchantName: string;
  role: 'MAIN' | 'SUB' | null;
  pointKind: 'UNIVERSAL' | 'EXCLUSIVE';
  /** 「主体积分」/「附属积分」 */
  kindName: string;
  /** 「可兑主体商品与全部附属商品」/「仅可兑主体商家商品」 */
  exchangeScope: string;
  available: number;
  expired: number;
  expiringSoon: number;
  /** 这些分能在哪些联盟花（桥店：发分商家同属多个联盟） */
  allianceIds: number[];
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
  /** 按商家分组的可用积分（C 端「我的积分」按店展示） */
  byMerchant?: MerchantPointBucket[];
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
  /** 券所属联盟（卡包按联盟分组，避免拿着联盟A的券跑到联盟B的店） */
  allianceId?: number;
  /** 券所属联盟名（兼容旧版，界面已不再展示联盟） */
  allianceName?: string | null;
  /** 适用范围文案，例如「仅限 城南旗舰店 使用」 */
  scopeText?: string;
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

/** 可兑商品：哪几家店的分能兑它 */
export interface ExchangeOptionItem {
  templateId: number;
  name: string;
  subtitle: string | null;
  ownerType: 'MAIN_COUPON' | 'SUB_COUPON';
  ownerMerchantId: number;
  ownerMerchantName: string | null;
  faceValue: number;
  thresholdAmount: number;
  pointsCost: number;
  validDays: number;
  remainingStock: number;
  perUserLimit: number;
  owned: number;
  /** MAIN=只认主体分；BOTH=两种分都行 */
  payWith: 'MAIN' | 'BOTH';
  payWithText: string;
  usablePoints: number;
  affordable: boolean;
  limitReached: boolean;
  eligibleMerchants: Array<{
    merchantId: number;
    merchantName: string;
    role: 'MAIN' | 'SUB';
    points: number;
  }>;
}

export interface ExchangeOptions {
  userId: number;
  allianceId: number;
  allianceName: string;
  pool: { mainPoints: number; subPoints: number; total: number };
  viewAsSub: boolean;
  items: ExchangeOptionItem[];
  affordableCount: number;
}

/**
 * 可兑商品清单（按我的可用积分过滤）
 *
 * `merchantId` 是「当前在哪家店逛」的上下文：传附属商家时只会返回主体商家的券。
 */
export function fetchExchangeOptions(params?: { allianceId?: number; merchantId?: number }) {
  const qs: string[] = [];
  if (params?.allianceId) qs.push(`allianceId=${params.allianceId}`);
  if (params?.merchantId) qs.push(`merchantId=${params.merchantId}`);
  return request<ExchangeOptions>({
    url: `/h5/points/exchange-options${qs.length ? `?${qs.join('&')}` : ''}`,
  });
}

export function fetchMyCoupons(
  status: 'UNUSED' | 'USED' | 'EXPIRED',
  page: number,
  pageSize = 10,
  allianceId?: number,
) {
  const aid = allianceId && allianceId > 0 ? `&allianceId=${allianceId}` : '';
  return request<PageResult<CouponCard>>({
    url: `/h5/my/coupons?status=${status}&page=${page}&pageSize=${pageSize}${aid}`,
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
