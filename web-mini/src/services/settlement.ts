import { request } from '@/utils/request';

export type SettlementTone = 'good' | 'warn' | 'info';

export interface SettlementPoint {
  tone: SettlementTone;
  text: string;
}

export interface SettlementBillRow {
  id: number;
  reportNo: string;
  periodStart: string;
  periodEnd: string;
  status: string;
  totalAmount: number;
  totalCount: number;
}

export interface SettlementAmountPair {
  count: number;
  amount: number;
}

export interface SettlementInsight {
  headline: string;
  /** llm = 模型润色，template = 本地模板（模型未配置或输出违规时） */
  source: 'llm' | 'template';
  points: SettlementPoint[];
}

export interface SettlementOverview {
  pending: SettlementAmountPair;
  confirmed: SettlementAmountPair;
  disputed: SettlementAmountPair;
  latest: SettlementBillRow | null;
  latestDelta: number | null;
  /** 近 6 期，正序（左旧右新），用于趋势条 */
  trend: SettlementBillRow[];
  /** 最近 20 条，倒序，用于列表 */
  bills: SettlementBillRow[];
  insight: SettlementInsight;
}

export interface SettlementCheck {
  level: 'ok' | 'info' | 'warn';
  /** 严重项：出现则不建议直接确认 */
  critical?: boolean;
  title: string;
  detail: string;
}

export interface BillInsight {
  bill: {
    id: number;
    reportNo: string;
    merchantName: string | null;
    status: string;
    periodStart: string;
    periodEnd: string;
    totalAmount: number;
    totalCount: number;
    disputeReason: string | null;
    confirmedAt: string | null;
  };
  /** 24 个小时的核销笔数，前端按 4 小时聚合成 6 段展示 */
  hourly: number[];
  byStore: Array<{ name: string; count: number; amount: number }>;
  checks: SettlementCheck[];
  verdict: { canConfirm: boolean; reason: string };
  /** 有严重异常时预填的异议理由，无异常为空串 */
  disputeDraft: string;
  prevCompare: {
    amount: number;
    delta: number | null;
    periodStart: string;
    periodEnd: string;
  } | null;
  insight: SettlementInsight;
}

/** 结算总览：待确认/已确认/异议 + 近 6 期趋势 + AI 解读（后端一次返回，避免多次往返） */
export function fetchSettlementOverview() {
  return request<SettlementOverview>({
    url: '/ai/assist/settlement/overview',
    redirectOn401: false,
  });
}

/** 单张账单核查：门店/时段分布 + 异常项 + 是否可直接确认 */
export function fetchBillInsight(id: number) {
  return request<BillInsight>({
    url: `/ai/assist/settlement/${id}/insight`,
    redirectOn401: false,
  });
}

/**
 * 确认或提异议。confirm=false 时 disputeReason 必填（≥5 字，后端强校验）。
 *
 * 用 POST 而非 PATCH：微信小程序 wx.request 的 method 白名单里没有 PATCH，
 * 后端同一 handler 同时挂了 PATCH 与 POST，两者权限与校验完全一致。
 */
export function confirmSettlement(id: number, body: { confirm: boolean; disputeReason?: string }) {
  return request<{ id: number; status: string }>({
    url: `/settlements/${id}/confirm`,
    method: 'POST',
    data: body,
    redirectOn401: false,
  });
}
