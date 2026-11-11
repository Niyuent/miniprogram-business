import request from '@/utils/request';
import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';

/** 对账单状态机：GENERATED → CONFIRMED（冻结）/ DISPUTED（需重新生成） */
export type SettlementStatus = 'GENERATING' | 'GENERATED' | 'CONFIRMED' | 'DISPUTED';

export interface SettlementItem {
  id: number;
  reportNo: string;
  merchantId: number | null;
  merchantName: string | null;
  periodStart: string;
  periodEnd: string;
  status: SettlementStatus;
  totalAmount: number;
  totalCount: number;
  redemptionCount: number;
  purchaseCount: number;
  generatedAt: string;
  confirmedAt: string | null;
  /** 异议原因（S4.2 收口：提异议时同时落账单表，详情可回显；重新生成后清空） */
  disputeReason: string | null;
}

/** 快照里的核销明细行（生成时固化，后续数据变化不影响） */
export interface RedemptionSnapRow {
  id: number;
  code: string;
  userId: number;
  storeId: number | null;
  storeName: string | null;
  faceValue: number;
  discountAmount: number;
  redeemedAt: string;
}

/** 快照里的采购明细行 */
export interface PurchaseSnapRow {
  id: number;
  purchaseNo: string;
  templateName: string | null;
  quantity: number;
  totalAmount: number;
  settleStatus: string;
  purchasedAt: string;
}

export interface SettlementDetail extends SettlementItem {
  redemptions: RedemptionSnapRow[];
  purchases: PurchaseSnapRow[];
}

export const settlementApi = {
  /** 列表（隔离在后端：附属只看自己，主体看全部；periodStart / periodEnd 为「账期」筛选） */
  list(params: {
    page?: number;
    pageSize?: number;
    merchantId?: number;
    status?: string;
    periodStart?: string;
    periodEnd?: string;
  } = {}) {
    return http<PageResult<SettlementItem>>({ url: '/settlements', method: 'GET', params });
  },
  detail(id: number) {
    return http<SettlementDetail>({ url: `/settlements/${id}`, method: 'GET' });
  },
  /** 生成：新建返回 201，幂等命中返回 200 + idempotent:true */
  generate(payload: { merchantId?: number | null; periodStart: string; periodEnd: string }) {
    return http<{ id: number; reportNo: string; totalAmount: number; totalCount: number; idempotent?: boolean; regenerated?: boolean }>({
      url: '/settlements/generate',
      method: 'POST',
      data: payload,
    });
  },
  /** 确认 / 提异议（confirm=false 时 disputeReason 必填 ≥5 字符） */
  confirm(id: number, payload: { confirm: boolean; disputeReason?: string }) {
    return http<{ id: number; status: SettlementStatus }>({
      url: `/settlements/${id}/confirm`,
      method: 'PATCH',
      data: payload,
    });
  },
  /**
   * 导出单个对账单的核销明细 CSV（**走后端**，非前端拼装）。
   * 后端返回的是纯 CSV 文本（带 UTF-8 BOM），不经过 ApiResponse 包装，
   * 所以这里绕开 http<T> 的自动解包，直接拿 blob 落下载。
   */
  async exportCsv(id: number): Promise<void> {
    const res = await request.get(`/settlements/${id}/export`, { responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `settlement-${id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
};
