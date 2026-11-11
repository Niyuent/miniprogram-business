import { defineStore } from 'pinia';
import { ROLE_KEY, TOKEN_KEY } from '@/utils/request';

export type MiniRole = 'member' | 'merchant';

export const MEMBER_HOME = '/pages/member/home/index';
export const MERCHANT_HOME = '/pages/merchant/workbench/index';
export const LOGIN_PAGE = '/pages/login/index';

/** 积分商城已取消：兑换入口改为「逛商家」，藏进每家商家的页面里 */
export const MEMBER_TABS = ['home', 'wallet', 'shops', 'profile'] as const;
export const MERCHANT_TABS = ['workbench', 'ai', 'verify', 'profile'] as const;

/**
 * 老版本把底部菜单的 tabs 缓存在 mini_tabs 里：可能是 3 项（没有商城入口），
 * 也可能还留着 'mall'。不纠正的话，用户更新到新包后「逛商家」入口会凭空消失，
 * 看起来就像「积分商城没被换掉」。会员端一律收敛到 4 项固定菜单。
 */
export function normalizeMemberTabs(input: readonly string[]): string[] {
  const mapped = input
    .map((key) => (key === 'mall' || key === 'market' ? 'shops' : key))
    .filter((key, index, arr) => arr.indexOf(key) === index)
    .filter((key) => (MEMBER_TABS as readonly string[]).includes(key));
  if (!mapped.includes('shops')) {
    const at = mapped.indexOf('wallet');
    mapped.splice(at >= 0 ? at + 1 : mapped.length, 0, 'shops');
  }
  return mapped.length ? mapped : [...MEMBER_TABS];
}

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
    /** 手机号在另一侧也有账号：会员端显示「切到商家端」，商家端显示「切到会员端」 */
    switchable: uni.getStorageSync('mini_switchable') === true,
    /**
     * 商家当前选中的联盟。发分 / 发券默认落在这个联盟，可在联盟页切换。
     * 列表加载时会校验该 id 仍在已加入联盟中，失效自动清空。
     */
    currentAllianceId: Number(uni.getStorageSync('mini_current_alliance') || 0),
  }),
  actions: {
    hydrate() {
      this.token = (uni.getStorageSync(TOKEN_KEY) as string) || '';
      this.role = readStoredRole();
      const tabs = uni.getStorageSync('mini_tabs');
      const stored = Array.isArray(tabs) ? tabs.map(String) : [];
      this.tabs = this.role === 'member' ? normalizeMemberTabs(stored) : stored;
      if (this.role === 'member' && this.tabs.join('|') !== stored.join('|')) {
        uni.setStorageSync('mini_tabs', this.tabs);
      }
      this.profileName = (uni.getStorageSync('mini_profile_name') as string) || '';
      this.avatar = (uni.getStorageSync('mini_avatar') as string) || '';
      this.switchable = uni.getStorageSync('mini_switchable') === true;
      this.currentAllianceId = Number(uni.getStorageSync('mini_current_alliance') || 0);
    },
    setToken(token: string) {
      this.token = token;
      uni.setStorageSync(TOKEN_KEY, token);
    },
    applyBootstrap(payload: {
      role: MiniRole;
      tabs?: string[];
      profile?: { name?: string; avatar?: string | null };
      switchable?: boolean;
    }) {
      this.role = payload.role;
      this.tabs =
        payload.role === 'merchant'
          ? payload.tabs?.length
            ? payload.tabs
            : [...MERCHANT_TABS]
          : normalizeMemberTabs(payload.tabs?.length ? payload.tabs : [...MEMBER_TABS]);
      this.profileName = payload.profile?.name || '';
      this.avatar = payload.profile?.avatar || '';
      this.switchable = payload.switchable === true;
      uni.setStorageSync(ROLE_KEY, payload.role);
      uni.setStorageSync('mini_tabs', this.tabs);
      uni.setStorageSync('mini_profile_name', this.profileName);
      uni.setStorageSync('mini_switchable', this.switchable);
      if (this.avatar) uni.setStorageSync('mini_avatar', this.avatar);
      else uni.removeStorageSync('mini_avatar');
    },
    /** 设置商家当前联盟；0 = 不指定，沿用各页面原有逻辑 */
    setCurrentAlliance(allianceId: number) {
      const id = Number(allianceId) > 0 ? Number(allianceId) : 0;
      this.currentAllianceId = id;
      if (id) uni.setStorageSync('mini_current_alliance', id);
      else uni.removeStorageSync('mini_current_alliance');
    },
    clear() {
      this.token = '';
      this.role = '';
      this.tabs = [];
      this.profileName = '';
      this.avatar = '';
      this.switchable = false;
      this.currentAllianceId = 0;
      uni.removeStorageSync(TOKEN_KEY);
      uni.removeStorageSync(ROLE_KEY);
      uni.removeStorageSync('mini_tabs');
      uni.removeStorageSync('mini_profile_name');
      uni.removeStorageSync('mini_avatar');
      uni.removeStorageSync('mini_switchable');
      uni.removeStorageSync('mini_current_alliance');
    },
  },
});
