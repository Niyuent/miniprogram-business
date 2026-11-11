import { request } from '@/utils/request';

/**
 * 商家端「我的联盟」。
 * 商家登录后只看自己已加入的联盟；在该联盟可管理时看到全部成员的经营数字，
 * 普通成员只看到本店数字。接口与会员端 /mini/alliances 互不干扰。
 */

export interface AllianceShopStats {
  merchantId: number;
  /** 该联盟积分池里本店发出的积分 */
  issuedPoints: number;
  earnCount: number;
  /** 会员从本店兑换走的、归属该联盟的券 */
  exchangeCount: number;
  exchangePoints: number;
  /** 本店核销的该联盟券 */
  redeemCount: number;
  redeemAmount: number;
  templateCount: number;
  issuedCoupons: number;
}

export interface MyAllianceRow {
  allianceId: number;
  name: string;
  mainMerchantId: number;
  /** 可查看全联盟数字（界面叫「可管理」，不再出现主体/附属） */
  isManager: boolean;
  memberCount: number;
  storeCount: number;
  myStats: AllianceShopStats;
}

export interface MyAlliancesView {
  merchant: { id: number; name: string };
  total: number;
  list: MyAllianceRow[];
}

export interface AllianceMember {
  merchantId: number;
  name: string;
  status: string;
  address: string;
  isManager: boolean;
  isSelf: boolean;
  storeCount: number;
  stores: Array<{ id: number; name: string; address: string }>;
  /** 普通成员看不到别家的数字，为 null */
  stats: AllianceShopStats | null;
}

export interface AllianceClearingBill {
  id: number;
  periodKey: string;
  payerMerchantId: number;
  payerMerchantName: string;
  receiverMerchantId: number;
  receiverMerchantName: string;
  netAmount: number;
  status: string;
}

export interface AllianceMoney {
  scopeNote: string;
  payable: number;
  receivable: number;
  net: number;
  billCount: number;
  bills: AllianceClearingBill[];
  settlement: {
    reportCount: number;
    totalAmount: number;
    reports: Array<{
      id: number;
      reportNo: string;
      periodStart: string;
      periodEnd: string;
      totalAmount: number;
      status: string;
    }>;
  };
}

export interface AllianceDetailView {
  alliance: {
    id: number;
    name: string;
    mainMerchantId: number;
    mainMerchantName: string;
    memberCount: number;
    storeCount: number;
  };
  viewer: { merchantId: number; merchantName: string; isManager: boolean };
  scopeNote: string;
  members: AllianceMember[];
  myStats: AllianceShopStats;
  money: AllianceMoney;
}

export function fetchMyAlliances() {
  return request<MyAlliancesView>({ url: '/merchant-alliances/mine', redirectOn401: false });
}

export function fetchAllianceDetail(allianceId: number) {
  return request<AllianceDetailView>({
    url: `/merchant-alliances/${allianceId}`,
    redirectOn401: false,
  });
}
