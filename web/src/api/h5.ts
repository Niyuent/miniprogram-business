import { h5http } from '@/utils/h5Request';
import type { PageResult } from '@/types/api';
import type { ExchangeRecord, ExchangeResult, PointAccountDetail, PointTransaction, PointTxnType } from '@/types/business';

/** C 端（H5 / 小程序）接口（真实后端 /api/v1/h5/*，仅 C 端 JWT 可访问） */
export interface H5User {
  id: number;
  nickname: string | null;
  phone: string | null;
  openid: string | null;
  unionid: string | null;
}

/** 可兑换券（H5 视角，含 status 以便复用列表过滤） */
export interface H5Template {
  id: number;
  name: string;
  subtitle: string | null;
  status: string;
  faceValue: number;
  thresholdAmount: number;
  pointsCost: number;
  perUserLimit: number;
  totalStock: number;
  remainingStock: number;
}

export const h5Api = {
  /** 微信登录：code → C 端 token */
  login(code: string) {
    return h5http<{ accessToken: string; expiresIn: string; user: H5User }>({
      url: '/auth/user-login',
      method: 'POST',
      data: { code },
    });
  },
  me() {
    return h5http<H5User>({ url: '/h5/me', method: 'GET' });
  },
  account() {
    return h5http<PointAccountDetail>({ url: '/h5/points/account', method: 'GET' });
  },
  transactions(params: { page?: number; pageSize?: number; type?: PointTxnType } = {}) {
    return h5http<PageResult<PointTransaction>>({ url: '/h5/points/transactions', method: 'GET', params });
  },
  templates() {
    return h5http<{ list: H5Template[] }>({ url: '/h5/templates', method: 'GET' });
  },
  exchangeRecords(params: { page?: number; pageSize?: number } = {}) {
    return h5http<PageResult<ExchangeRecord>>({ url: '/h5/exchange-records', method: 'GET', params });
  },
  exchange(payload: { userId: number; templateId: number; requestId: string; channel?: 'H5' | 'WEB'; remark?: string }) {
    return h5http<ExchangeResult>({ url: '/h5/exchange', method: 'POST', data: payload });
  },
};
