import { request } from '@/utils/request';

/** 与后端 common/billing/plans.ts 保持一致，字段由接口返回，前端不再自行推导 */
export interface SubTierStatus {
  tier: 'PRIMARY' | 'ADVANCED';
  name: string;
  color: string;
  allianceLimit: number;
  allianceUsed: number;
  allianceRemaining: number;
  paid: boolean;
  expiresAt: string | null;
  price: number;
}

export interface Billing {
  merchantId: number;
  merchantName: string;
  subTier: SubTierStatus;
  mainMember: {
    active: boolean;
    trial: boolean;
    blocked: boolean;
    expiresAt: string | null;
  };
}

export interface PlanCatalog {
  currency: string;
  subTier: {
    items: Array<{
      tier: 'PRIMARY' | 'ADVANCED';
      name: string;
      color: string;
      price: number;
      period: string;
      allianceLimit: number;
      desc: string;
    }>;
  };
  mainMember: {
    trialDays: number;
    items: Array<{ period: string; name: string; months: number; price: number }>;
  };
}

export interface SubscriptionOrder {
  id: number;
  merchantId: number;
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
  remark: string | null;
  createdAt: string;
}

export function fetchCatalog() {
  return request<PlanCatalog>({ url: '/subscriptions/catalog' });
}

export function fetchBilling() {
  return request<Billing>({ url: '/subscriptions/me' });
}

export function fetchOrders() {
  return request<{ total: number; items: SubscriptionOrder[] }>({
    url: '/subscriptions',
    data: { page: 1, pageSize: 20 },
  });
}

export function submitSubscription(body: {
  planType: 'MAIN_MEMBER' | 'SUB_TIER';
  period?: string;
  tier?: 'ADVANCED';
  remark?: string;
}) {
  return request<SubscriptionOrder>({ url: '/subscriptions', method: 'POST', data: body });
}

/** 联盟列表：附带档位与用量，供加盟页展示 x/y */
export interface AllianceItem {
  allianceId: number;
  name: string;
  role: 'MAIN' | 'SUB';
  mainMerchantId: number;
  sampleMerchants: Array<{ merchantId: number; name: string; role: 'MAIN' | 'SUB' }>;
  peerMerchantCount: number;
}

export function fetchMerchantAlliances(merchantId: number) {
  return request<{ merchantId: number; merchantName: string; billing: Billing; items: AllianceItem[] }>({
    url: `/merchants/${merchantId}/alliances`,
  });
}

export function joinAlliance(merchantId: number, allianceId: number) {
  return request<{ allianceId: number; allianceName: string; billing: Billing }>({
    url: `/merchants/${merchantId}/alliances`,
    method: 'POST',
    data: { allianceId },
  });
}

export function quitAlliance(merchantId: number, allianceId: number) {
  return request<{ allianceId: number; billing: Billing }>({
    url: `/merchants/${merchantId}/alliances/${allianceId}`,
    method: 'DELETE',
  });
}
