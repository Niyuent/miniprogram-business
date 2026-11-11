import { defineStore } from 'pinia';
import { authApi } from '@/api/auth';
import type { LoginParams, LoginResult, UserProfile } from '@/types/business';

// S5.1-Q2：后台令牌 key 与 C 端 `user_token` 显式分离；旧 key `token` 仅兜底读取
const TOKEN_KEY = 'admin_token';
const LEGACY_TOKEN_KEY = 'token';
const readToken = () => localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || '';

interface UserState {
  token: string;
  profile: UserProfile | null;
  /** 系统生成的初始账号未改过密时为 true，前端据此提示改密 */
  mustChangePassword: boolean;
}

/**
 * 登录态：token 存 Pinia，**同时落 localStorage**，
 * 保证刷新页面后仍能立刻从 localStorage 恢复并在路由守卫里补齐 profile。
 */
export const useUserStore = defineStore('user', {
  state: (): UserState => ({
    token: readToken(),
    profile: null,
    mustChangePassword: false,
  }),
  getters: {
    isLogin: (s) => !!s.token,
    permissions: (s) => s.profile?.permissions ?? [],
    roles: (s) => s.profile?.roles ?? [],
    isMainMerchant: (s) => s.profile?.merchant?.type === 'MAIN',
    merchantId: (s) => s.profile?.merchant?.id ?? null,
    displayName: (s) => s.profile?.realName || s.profile?.username || '',
  },
  actions: {
    /** 登录：拿 accessToken → 落盘 → 立即拉 profile（菜单/按钮权限依赖它） */
    async login(params: LoginParams): Promise<LoginResult> {
      const res = await authApi.login(params);
      this.token = res.accessToken;
      this.mustChangePassword = res.mustChangePassword;
      localStorage.setItem(TOKEN_KEY, res.accessToken);
      localStorage.removeItem(LEGACY_TOKEN_KEY); // 迁移旧 key
      await this.fetchProfile();
      return res;
    },
    async fetchProfile() {
      this.profile = await authApi.profile();
      return this.profile;
    },
    hasPermission(code: string | string[]) {
      const codes = Array.isArray(code) ? code : [code];
      return codes.some((c) => this.permissions.includes(c));
    },
    logout() {
      this.token = '';
      this.profile = null;
      this.mustChangePassword = false;
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(LEGACY_TOKEN_KEY);
    },
  },
});
