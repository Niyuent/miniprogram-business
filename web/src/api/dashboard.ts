import { http } from '@/utils/request';
import type { DashboardStats } from '@/types/business';

export const dashboardApi = {
  stats() {
    return http<DashboardStats>({ url: '/dashboard/stats', method: 'GET' });
  },
  trend(days = 7) {
    return http<{
      dates: string[];
      orders: number[];
      redemptions: number[];
      exchanges: number[];
    }>({ url: '/dashboard/trend', method: 'GET', params: { days } });
  },
};
