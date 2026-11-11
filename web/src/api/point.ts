import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';
import type {
  EarnPointsResult,
  ExchangeRecord,
  ExchangeResult,
  PointAccount,
  PointAccountDetail,
  PointRule,
  PointTransaction,
  PointTxnType,
} from '@/types/business';

/**
 * 积分（S3.1，真实后端 `/api/v1/point-*` 与 `/api/v1/points/*`）
 */
export const pointApi = {
  /** 积分账户列表（含临期积分） */
  accounts(
    params: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      minBalance?: number;
      expiringSoon?: boolean;
    } = {},
  ) {
    return http<PageResult<PointAccount>>({ url: '/point-accounts', method: 'GET', params });
  },

  /** 积分账户详情：余额 + 批次明细（FIFO 视角） */
  accountDetail(userId: number) {
    return http<PointAccountDetail>({ url: `/point-accounts/${userId}`, method: 'GET' });
  },

  /** 积分流水：类型 / 用户 / 商家 / 门店 / 时间筛选 */
  transactions(
    params: {
      page?: number;
      pageSize?: number;
      userId?: number;
      type?: PointTxnType;
      merchantId?: number;
      storeId?: number;
      from?: string;
      to?: string;
    } = {},
  ) {
    return http<PageResult<PointTransaction>>({ url: '/point-transactions', method: 'GET', params });
  },

  /**
   * 消费录单送积分
   *
   * 注意：后端对「未达起送金额」返回 **201 + earned=false**（业务规则不是错误），
   * 前端要按 `earned` 展示，不能只看 HTTP 状态码。
   */
  earn(payload: {
    userId: number;
    amount: number;
    orderId?: number;
    orderNo?: string;
    merchantId?: number;
    storeId?: number;
    remark?: string;
  }) {
    return http<EarnPointsResult>({ url: '/points/earn', method: 'POST', data: payload });
  },

  /**
   * 积分兑换代金券
   *
   * `requestId` 是幂等键（前端生成 UUID）：按钮防重 + 后端唯一索引双保险，
   * 重复提交会拿到**上次那张券**（`idempotent: true`），不会多扣积分也不会多发票。
   */
  exchange(payload: {
    userId: number;
    templateId: number;
    requestId: string;
    channel?: 'H5' | 'WEB';
    remark?: string;
  }) {
    return http<ExchangeResult>({ url: '/points/exchange', method: 'POST', data: payload });
  },

  /** 兑换记录（H5 传自己的 userId） */
  exchangeRecords(
    params: { page?: number; pageSize?: number; userId?: number; templateId?: number; from?: string; to?: string } = {},
  ) {
    return http<PageResult<ExchangeRecord>>({ url: '/points/exchange-records', method: 'GET', params });
  },

  /** 人工调整积分（正增负减，原因 ≥5 字符） */
  adjust(payload: { userId: number; amount: number; reason: string; expireAt?: string }) {
    return http<{
      adjusted: boolean;
      amount: number;
      transactionId: number;
      expireAt: string | null;
      balance: number;
      deductions: Array<{ txnId: number; amount: number; expireAt: string | null }>;
    }>({ url: '/points/adjust', method: 'POST', data: payload });
  },

  rules() {
    return http<{ list: PointRule[] }>({ url: '/point-rules', method: 'GET' });
  },
};
