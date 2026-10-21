import { request } from '@/utils/request';

export interface GalaxyCenter {
  id: number;
  name: string;
  monthAmount: number;
  monthOrderCount: number;
  planetCount: number;
}

export interface GalaxyPlanet {
  id: number;
  name: string;
  status: string;
  kind?: 'merchant' | 'guest';
  monthAmount: number;
  orderCount: number;
  storeId?: number | null;
  storeName?: string;
  address?: string;
  hours?: string;
}

export interface GalaxyChart {
  mode: 'MAIN' | 'SUB';
  focusId?: number;
  center: GalaxyCenter;
  planets: GalaxyPlanet[];
}

export interface MemberPlace {
  storeId: number;
  merchantId: number;
  name: string;
  merchantName: string;
  address: string;
  hours: string;
  visited: boolean;
}

export interface AllianceMerchant {
  id: number;
  name: string;
  role: 'MAIN' | 'SUB';
  storeId: number | null;
  storeName: string;
  address: string;
  hours: string;
  storeCount: number;
}

export interface AllianceGroup {
  id: number;
  name: string;
  city: string;
  merchantCount: number;
  merchants: AllianceMerchant[];
}

export function fetchMerchantGalaxy() {
  return request<GalaxyChart>({ url: '/mini/galaxy' });
}

export function fetchMemberPlaces() {
  return request<{ places: MemberPlace[] }>({ url: '/mini/places' });
}

export function fetchMemberAlliances() {
  return request<{ total: number; alliances: AllianceGroup[] }>({ url: '/mini/alliances' });
}

export function fetchPublicGalaxy(merchantId: number) {
  return request<GalaxyChart>({ url: `/mini/galaxy/public?merchantId=${merchantId}` });
}

export function yuan(value: number) {
  const amount = Math.round(Number(value) || 0);
  return `¥${amount}`;
}
