import { http } from '@/utils/request';
import type { PageResult } from '@/types/api';
import type {
  AuthorizationItem,
  AuthorizationLogItem,
  AuthStatus,
  AvailableTemplate,
  CreateAuthorizationPayload,
  MeAuthorization,
} from '@/types/business';

/** 授权管理（真实后端 /api/v1/authorizations/*） */
export const authorizationApi = {
  list(
    params: { page?: number; pageSize?: number; subMerchantId?: number; status?: AuthStatus } = {},
  ) {
    return http<PageResult<AuthorizationItem>>({
      url: '/authorizations',
      method: 'GET',
      params,
    });
  },
  /** 可选主体券模板（seed 里固定为 1001 / 1002 / 1003） */
  availableTemplates() {
    return http<{ mainMerchantId: number; templates: AvailableTemplate[] }>({
      url: '/authorizations/available-templates',
      method: 'GET',
    });
  },
  create(data: CreateAuthorizationPayload) {
    return http<{ authorization: AuthorizationItem; reactivated: boolean }>({
      url: '/authorizations',
      method: 'POST',
      data,
    });
  },
  /** 关闭授权（幂等，重复调用返回 200 + alreadyDisabled=true） */
  disable(id: number, data: { revokeReason?: string } = {}) {
    return http<{ authorization: AuthorizationItem; alreadyDisabled: boolean }>({
      url: `/authorizations/${id}/disable`,
      method: 'PATCH',
      data,
    });
  },
  logs(params: { page?: number; pageSize?: number; subMerchantId?: number; action?: string } = {}) {
    return http<PageResult<AuthorizationLogItem>>({
      url: '/authorizations/logs',
      method: 'GET',
      params,
    });
  },
};

/**
 * 附属商家自视授权（`/me/authorizations`）
 *
 * 与 `/authorizations` 的区别：这个接口**不加 `authorization:view` 权限码**，
 * 附属商家靠它知道「我能发哪些主体券」，S2.2 发放页用它展示授权范围。
 */
export const meAuthorizationApi = {
  me() {
    return http<MeAuthorization>({ url: '/me/authorizations', method: 'GET' });
  },
};
