import request from '@/utils/request';
import { http } from '@/utils/request';

// ---------------------------------------------------- 工作台（dashboard）类型
export interface DashboardCard {
  key: string;
  label: string;
  value: number;
  unit: string;
  trend: number;
}
export interface DashboardTodo {
  pendingMerchants: number;
  abnormalOrders: number;
  unreadNotifications: number;
}
export interface DashboardStats {
  cards: DashboardCard[];
  todo: DashboardTodo;
}
export interface DashboardTrend {
  dates: string[];
  orders: number[];
  redemptions: number[];
  exchanges: number[];
}
export interface DashboardDistribution {
  couponTypes: Array<{ type: string; count: number }>;
  pointSources: Array<{ type: string; value: number }>;
}

// ---------------------------------------------------- 星系视图（galaxy）
export interface DashboardGalaxyCenter {
  id: number;
  name: string;
  type: 'PLATFORM' | 'MAIN';
  status: string | null;
  /** 本月交易额 */
  monthAmount: number;
  /** 今日交易额 */
  todayAmount: number;
  monthOrderCount: number;
  planetCount: number;
}
export interface DashboardGalaxyPlanet {
  id: number;
  name: string;
  code: string | null;
  status: string;
  /** 本月交易额（决定星球大小） */
  monthAmount: number;
  orderCount: number;
}
export interface DashboardGalaxyFlow {
  source: number;
  target: number;
  value: number;
}
export interface DashboardGalaxy {
  center: DashboardGalaxyCenter;
  planets: DashboardGalaxyPlanet[];
  flows: DashboardGalaxyFlow[];
}
export interface DashboardTopMerchant {
  merchantId: number;
  name: string;
  amount: number;
}

/** 报表通用查询参数（时间范围 + 商家筛选；keyword 在前端做客户端过滤，不进后端） */
export interface ReportQuery {
  from?: string;
  to?: string;
  merchantId?: number;
  page?: number;
  pageSize?: number;
}

export interface MerchantOnboardingData {
  summary: { total: number; PENDING: number; APPROVED: number; SUSPENDED: number; REJECTED: number };
  byStatus: Array<{ status: string; count: number }>;
  monthly: Array<{ month: string; count: number }>;
}

export interface OrdersSummaryData {
  summary: { count: number; totalAmount: number; payAmount: number; discountAmount: number };
  byStatus: Array<{ status: string; count: number; payAmount: number }>;
  byMerchant: Array<{ merchantId: number; merchantName: string; count: number; payAmount: number }>;
  daily: Array<{ date: string; count: number; payAmount: number }>;
}

export interface CouponSummaryData {
  summary: { total: number; used: number; unused: number; frozen: number; expired: number; usedRate: number };
  byStatus: Array<{ status: string; count: number }>;
  byTemplate: Array<{ templateId: number; templateName: string; count: number }>;
}

export interface PointsSummaryData {
  summary: { count: number; net: number; earned: number; spent: number; expired: number; refunded: number; adjusted: number };
  byType: Array<{ type: string; count: number; amount: number }>;
}

export interface StoreSettlementData {
  summary: { purchaseCount: number; purchaseAmount: number; redemptionCount: number; redemptionAmount: number };
  bySettleStatus: Array<{ settleStatus: string; count: number; totalAmount: number }>;
  byMerchant: Array<{
    merchantId: number;
    merchantName: string;
    purchaseCount: number;
    purchaseAmount: number;
    redemptionCount: number;
    redemptionAmount: number;
    diffAmount: number;
  }>;
}

export interface AuthorizationLogItem {
  id: number;
  mainMerchantId: number;
  mainMerchantName: string | null;
  subMerchantId: number;
  subMerchantName: string | null;
  status: string;
  templateScope: string;
  templateNames: string[];
  grantedAt: string | null;
  revokedAt: string | null;
  revokeReason: string | null;
}

export interface AuthorizationLogsData {
  total: number;
  page: number;
  pageSize: number;
  byStatus: Array<{ status: string; count: number }>;
  list: AuthorizationLogItem[];
}

export const reportApi = {
  merchantOnboarding(params: ReportQuery = {}) {
    return http<MerchantOnboardingData>({ url: '/reports/merchant-onboarding', method: 'GET', params });
  },
  ordersSummary(params: ReportQuery = {}) {
    return http<OrdersSummaryData>({ url: '/reports/orders-summary', method: 'GET', params });
  },
  couponSummary(params: ReportQuery = {}) {
    return http<CouponSummaryData>({ url: '/reports/coupon-summary', method: 'GET', params });
  },
  pointsSummary(params: ReportQuery = {}) {
    return http<PointsSummaryData>({ url: '/reports/points-summary', method: 'GET', params });
  },
  storeSettlement(params: ReportQuery = {}) {
    return http<StoreSettlementData>({ url: '/reports/store-settlement', method: 'GET', params });
  },
  authorizationLogs(params: ReportQuery = {}) {
    return http<AuthorizationLogsData>({ url: '/reports/authorization-logs', method: 'GET', params });
  },
  /** 导出 CSV（纯文本 blob，绕开 http<T> 解包） */
  async exportCsv(key: string, params: ReportQuery = {}) {
    const res = await request.get(`/reports/${key}/export`, { params, responseType: 'blob' });
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `report-${key}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  },
  // ---------------------------------------------------- 工作台（dashboard）
  dashboardStats() {
    return http<DashboardStats>({ url: '/dashboard/stats', method: 'GET' });
  },
  dashboardTrend(days = 7) {
    return http<DashboardTrend>({ url: '/dashboard/trend', method: 'GET', params: { days } });
  },
  dashboardDistribution() {
    return http<DashboardDistribution>({ url: '/dashboard/distribution', method: 'GET' });
  },
  dashboardTopMerchants() {
    return http<DashboardTopMerchant[]>({ url: '/dashboard/top-merchants', method: 'GET' });
  },
  dashboardGalaxy() {
    return http<DashboardGalaxy>({ url: '/dashboard/galaxy', method: 'GET' });
  },
};
