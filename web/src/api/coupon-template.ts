import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';
import type {
  CouponEffectDetailRow,
  CouponOwnerType,
  CouponTemplate,
  CouponTemplateDetail,
  CouponTemplateStatus,
  CreateCouponTemplatePayload,
  UpdateCouponTemplatePayload,
} from '@/types/business';

/**
 * 券模板（真实后端 /api/v1/coupon-templates/*）
 *
 * S2 起的工作流是「后端先行」：接口先在 Swagger（http://localhost/docs）验证通过，
 * 前端再直接接，不存在任何 mock 分支。
 */
export const couponTemplateApi = {
  list(
    params: {
      page?: number;
      pageSize?: number;
      keyword?: string;
      ownerType?: CouponOwnerType;
      status?: CouponTemplateStatus;
      ownerMerchantId?: number;
    } = {},
  ) {
    return http<PageResult<CouponTemplate>>({ url: '/coupon-templates', method: 'GET', params });
  },

  detail(id: number) {
    return http<CouponTemplateDetail>({ url: `/coupon-templates/${id}`, method: 'GET' });
  },

  /** 创建后固定为 DRAFT，需显式 publish 才能被发放 */
  create(data: CreateCouponTemplatePayload) {
    return http<{ template: CouponTemplate }>({ url: '/coupon-templates', method: 'POST', data });
  },

  /** 仅 DRAFT / UNPUBLISHED 可编辑，否则后端 409 TEMPLATE_NOT_EDITABLE */
  update(id: number, data: UpdateCouponTemplatePayload) {
    return http<{ template: CouponTemplate }>({ url: `/coupon-templates/${id}`, method: 'PUT', data });
  },

  publish(id: number) {
    return http<{ template: CouponTemplate }>({ url: `/coupon-templates/${id}/publish`, method: 'PATCH' });
  },

  unpublish(id: number) {
    return http<{ template: CouponTemplate }>({
      url: `/coupon-templates/${id}/unpublish`,
      method: 'PATCH',
    });
  },

  /** 券效果明细：核销用户与实付 */
  effectDetails(id: number, params: { page?: number; pageSize?: number } = {}) {
    return http<PageResult<CouponEffectDetailRow>>({
      url: `/coupon-templates/${id}/effect-details`,
      method: 'GET',
      params,
    });
  },
};
