import { request } from '@/utils/request';

/** 「逛商家」列表里的一家店 */
export interface NearbyShop {
  merchantId: number;
  name: string;
  address: string;
  hours: string;
  storeId: number | null;
  storeName: string;
  /** null = 未授权定位或这家店没有经纬度 */
  distanceMeters: number | null;
  distanceText: string;
  /** 我在这家店攒的、还没花掉的积分（兑换时只扣这部分） */
  availablePoints: number;
  earnedPoints: number;
}

export interface NearbyResult {
  located: boolean;
  total: number;
  list: NearbyShop[];
}

/** 某家商家兑换区里的一张券 */
export interface ShopCoupon {
  id: number;
  name: string;
  subtitle: string | null;
  faceValue: number;
  thresholdAmount: number;
  pointsCost: number;
  remainingStock: number;
  perUserLimit: number;
  ownerMerchantId: number;
  ownerMerchantName: string;
  scopeText: string;
  affordable: boolean;
  ownedCount: number;
  limitReached: boolean;
}

export interface ShopExchangeView {
  merchant: { id: number; name: string; address: string; hours: string };
  availablePoints: number;
  list: ShopCoupon[];
}

/** 附近商家：带上手机定位就按距离由近到远，没定位也能用（服务端兜底排序） */
export function fetchNearbyShops(lng?: number, lat?: number) {
  const qs = lng !== undefined && lat !== undefined ? `?lng=${lng}&lat=${lat}` : '';
  return request<NearbyResult>({ url: `/h5/merchants/nearby${qs}` });
}

/** 这家商家专属的积分兑换区（不同商家返回不同清单） */
export function fetchShopCoupons(merchantId: number) {
  return request<ShopExchangeView>({ url: `/h5/merchants/${merchantId}/exchange-templates` });
}

/** 用这家店攒的积分兑换；联盟、扣分账户都由后端按进入的商家决定 */
export function exchangeAtShop(merchantId: number, templateId: number) {
  const requestId = `shop${Date.now()}${Math.floor(Math.random() * 10000)}`;
  return request<{ idempotent?: boolean; pointsCost?: number; code?: string }>({
    url: `/h5/merchants/${merchantId}/exchange`,
    method: 'POST',
    data: { templateId, requestId },
    redirectOn401: false,
  });
}
