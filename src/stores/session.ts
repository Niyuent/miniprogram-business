import { defineStore } from 'pinia';
import { ROLE_KEY, TOKEN_KEY } from '@/utils/request';

export type MiniRole = 'member' | 'merchant';

export const MEMBER_HOME = '/pages/member/home/index';
export const MERCHANT_HOME = '/pages/merchant/workbench/index';
export const LOGIN_PAGE = '/pages/login/index';

export const MEMBER_TABS = ['home', 'wallet', 'mall', 'profile'] as const;
export const MERCHANT_TABS = ['workbench', 'verify', 'notification', 'profile'] as const;

export function homeOf(role: MiniRole): string {
  return role === 'merchant' ? MERCHANT_HOME : MEMBER_HOME;
}

/** 只接受 bootstrap 写过的角色。空字符串表示尚未登录分流。 */
export function readStoredRole(): MiniRole | '' {
  const value = uni.getStorageSync(ROLE_KEY);
  if (value === 'merchant' || value === 'member') return value;
  return '';
}

export const useSessionStore = defineStore('session', {
  state: () => ({
    token: (uni.getStorageSync(TOKEN_KEY) as string) || '',
    role: readStoredRole(),
    tabs: [] as string[],
    profileName: '',
    avatar: '',
  }),
  actions: {
    hydrate() {
      this.token = (uni.getStorageSync(TOKEN_KEY) as string) || '';
      this.role = readStoredRole();
      const tabs = uni.getStorageSync('mini_tabs');
      this.tabs = Array.isArray(tabs) ? tabs.map(String) : [];
      this.profileName = (uni.getStorageSync('mini_profile_name') as string) || '';
      this.avatar = (uni.getStorageSync('mini_avatar') as string) || '';
    },
    setToken(token: string) {
      this.token = token;
      uni.setStorageSync(TOKEN_KEY, token);
    },
    applyBootstrap(payload: { role: MiniRole; tabs?: string[]; profile?: { name?: string; avatar?: string | null } }) {
      this.role = payload.role;
      this.tabs = payload.tabs?.length
        ? payload.tabs
        : [...(payload.role === 'merchant' ? MERCHANT_TABS : MEMBER_TABS)];
      this.profileName = payload.profile?.name || '';
      this.avatar = payload.profile?.avatar || '';
      uni.setStorageSync(ROLE_KEY, payload.role);
      uni.setStorageSync('mini_tabs', this.tabs);
      uni.setStorageSync('mini_profile_name', this.profileName);
      if (this.avatar) uni.setStorageSync('mini_avatar', this.avatar);
      else uni.removeStorageSync('mini_avatar');
    },
    clear() {
      this.token = '';
      this.role = '';
      this.tabs = [];
      this.profileName = '';
      this.avatar = '';
      uni.removeStorageSync(TOKEN_KEY);
      uni.removeStorageSync(ROLE_KEY);
      uni.removeStorageSync('mini_tabs');
      uni.removeStorageSync('mini_profile_name');
      uni.removeStorageSync('mini_avatar');
    },
  },
});
