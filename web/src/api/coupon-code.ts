import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';
import type {
  CouponCode,
  CouponCodeBatch,
  CouponCodeStats,
  CouponCodeStatus,
  GenerateCodesPayload,
} from '@/types/business';

/**
 * 券码（真实后端 `/api/v1/coupon-templates/:id/codes`）
 *
 * 券码是**有价凭证**，接口不提供导出全部明文之外的能力；
 * 越权访问（看不到模板）后端直接 404，前端不需要再判断。
 */
export const couponCodeApi = {
  /** 预生成券码；同批次重复会 409 BATCH_ALREADY_EXISTS */
  generate(templateId: number, data: GenerateCodesPayload) {
    return http<{ batchNo: string; batchId: number; templateId: number; quantity: number; codes: string[] }>({
      url: `/coupon-templates/${templateId}/codes`,
      method: 'POST',
      data,
    });
  },

  /** S2.4：券码列表支持按批次筛选（batchNo 或 batchId 二选一即可） */
  list(
    templateId: number,
    params: {
      page?: number;
      pageSize?: number;
      status?: CouponCodeStatus;
      batchNo?: string;
      batchId?: number;
      code?: string;
    } = {},
  ) {
    return http<PageResult<CouponCode> & { stats: CouponCodeStats }>({
      url: `/coupon-templates/${templateId}/codes`,
      method: 'GET',
      params,
    });
  },

  batches(templateId: number) {
    return http<{ list: CouponCodeBatch[] }>({
      url: `/coupon-templates/${templateId}/batches`,
      method: 'GET',
    });
  },
};
