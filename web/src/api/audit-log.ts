import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';
import type { AuditLogDetail, AuditLogItem } from '@/types/business';

/** 操作日志（真实后端 /api/v1/audit-logs/*，权限码 audit:view） */
export const auditLogApi = {
  list(
    params: {
      page?: number;
      pageSize?: number;
      module?: string;
      action?: string;
      operatorId?: number;
      operatorKeyword?: string;
      targetType?: string;
      targetId?: number;
      result?: string;
      from?: string;
      to?: string;
    } = {},
  ) {
    return http<PageResult<AuditLogItem>>({ url: '/audit-logs', method: 'GET', params });
  },
  detail(id: number) {
    return http<AuditLogDetail>({ url: `/audit-logs/${id}`, method: 'GET' });
  },
};
