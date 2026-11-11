import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';
import type {
  CouponInstance,
  CouponInstanceDetail,
  CouponInstanceStatus,
  IssueCouponPayload,
  IssueCouponResult,
} from '@/types/business';

/**
 * 券实例（真实后端 `/api/v1/coupon-instances/*`）
 *
 * `issue` 是核心：发券方由后端按 JWT 推导，附属商家发主体券必须过授权校验，
 * 前端只负责收集 templateId / 用户 / 数量，不做任何「能不能发」的判断 ——
 * 判断全在后端（`checkAuthorization` + 库存 + 券码池）。
 */
export const couponInstanceApi = {
  issue(data: IssueCouponPayload) {
    return http<IssueCouponResult>({ url: '/coupon-instances/issue', method: 'POST', data });
  },

  list(
    params: {
      page?: number;
      pageSize?: number;
      templateId?: number;
      userId?: number;
      status?: CouponInstanceStatus;
      code?: string;
      expireFrom?: string;
      expireTo?: string;
      issuerMerchantId?: number;
    } = {},
  ) {
    return http<PageResult<CouponInstance>>({ url: '/coupon-instances', method: 'GET', params });
  },

  detail(id: number) {
    return http<{ instance: CouponInstanceDetail }>({ url: `/coupon-instances/${id}`, method: 'GET' });
  },

  freeze(id: number, frozen: boolean, reason?: string) {
    return http<{ instance: CouponInstance }>({
      url: `/coupon-instances/${id}/freeze`,
      method: 'PATCH',
      data: { frozen, reason },
    });
  },
};
