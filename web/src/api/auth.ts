import { http } from '@/utils/request';
import type { LoginParams, LoginResult, UserProfile } from '@/types/business';

/** 认证相关接口（真实后端 /api/v1/auth/*） */
export const authApi = {
  login(data: LoginParams) {
    return http<LoginResult>({ url: '/auth/login', method: 'POST', data });
  },
  profile() {
    return http<UserProfile>({ url: '/auth/profile', method: 'GET' });
  },
  permissions() {
    return http<{ roles: string[]; permissions: string[] }>({
      url: '/auth/permissions',
      method: 'GET',
    });
  },
  updatePassword(data: { oldPassword: string; newPassword: string }) {
    return http<{ updated: boolean; mustChangePassword: boolean }>({
      url: '/auth/password',
      method: 'PUT',
      data,
    });
  },
};
