import request, { http } from '@/utils/request';
import type { PageResult } from '@/types/api';
import type {
  RedemptionChannel,
  RedemptionRecord,
  RedemptionStatus,
  RedemptionSummary,
  VerifyCouponResult,
} from '@/types/business';

/**
 * 核销（真实后端 `/api/v1/redemptions/*`）
 *
 * `verify` 故意不走 `http()`：`http()` 会把业务异常丢成普通 Error，
 * 而 verify 失败时后端会在 `data` 里带回**券信息 + 逐项校验明细**
 * （HTTP 409 / 403 / 404 + redeemable=false），核销页要展示这些，
 * 所以这里直接用 axios 实例拿完整响应。
 */
export type VerifyOutcome =
  | { ok: true; data: VerifyCouponResult }
  | {
      ok: false;
      status: number;
      reasonCode: string | null;
      message: string;
      data: Partial<VerifyCouponResult> | null;
    };

export const redemptionApi = {
  async verify(payload: {
    code: string;
    storeId?: number;
    userId?: number;
    orderNo?: string;
    orderAmount?: number;
  }): Promise<VerifyOutcome> {
    try {
      const res = await request.request<unknown, { data: { code: number; data: VerifyCouponResult } }>({
        url: '/redemptions/verify',
        method: 'POST',
        data: payload,
      });
      return { ok: true, data: res.data.data };
    } catch (e: unknown) {
      const err = e as { response?: { status?: number; data?: Record<string, unknown> } };
      const body = err.response?.data;
      const data = (body?.data as Record<string, unknown>) ?? null;
      return {
        ok: false,
        status: err.response?.status ?? 0,
        reasonCode: (data?.reasonCode as string) ?? null,
        message: String(body?.message ?? '校验失败'),
        data: data as Partial<VerifyCouponResult> | null,
      };
    }
  },

  redeem(payload: {
    code: string;
    storeId?: number;
    orderNo: string;
    orderAmount?: number;
    channel?: RedemptionChannel;
    remark?: string;
  }) {
    return http<RedemptionRecord>({ url: '/redemptions', method: 'POST', data: payload });
  },

  list(
    params: {
      page?: number;
      pageSize?: number;
      code?: string;
      templateId?: number;
      userId?: number;
      storeId?: number;
      merchantId?: number;
      status?: RedemptionStatus;
      redeemedFrom?: string;
      redeemedTo?: string;
    } = {},
  ) {
    return http<PageResult<RedemptionRecord> & { summary: RedemptionSummary[] }>({
      url: '/redemptions',
      method: 'GET',
      params,
    });
  },

  reverse(id: number, reason: string) {
    return http<{ record: RedemptionRecord; couponStatus: string }>({
      url: `/redemptions/${id}/reverse`,
      method: 'POST',
      data: { reason },
    });
  },
};
