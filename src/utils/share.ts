import { API_BASE_URL } from '@/utils/request';

const MEMBER_ID_KEY = 'mini_member_id';

export function rememberMember(userId: number) {
  if (userId) uni.setStorageSync(MEMBER_ID_KEY, String(userId));
}

export function memberInviteCode(): string {
  const id = String(uni.getStorageSync(MEMBER_ID_KEY) || '');
  return id ? `U${id}` : '';
}

export function merchantInviteCode(merchantId: number | null | undefined): string {
  return merchantId ? `SM${merchantId}` : '';
}

export function enableShareMenu() {
  try {
    uni.showShareMenu({
      withShareTicket: true,
      menus: ['shareAppMessage', 'shareTimeline'],
      fail() {},
    });
  } catch {
    /* H5 没有微信分享菜单 */
  }
}

export function memberSharePath(): string {
  const parts = ['from=share'];
  const invite = memberInviteCode();
  const storeId = Number(uni.getStorageSync('mini_store_id') || 0);
  if (invite) parts.push(`invite=${encodeURIComponent(invite)}`);
  if (storeId) parts.push(`storeId=${storeId}`);
  return `/pages/member/home/index?${parts.join('&')}`;
}

export function applySharePath(invite: string): string {
  const query = invite ? `?invite=${encodeURIComponent(invite)}` : '';
  return `/pages/apply/index${query}`;
}

/** 网关域名上的入驻申请页，邀请码放在 query 里。 */
export function applyPageUrl(invite: string): string {
  const origin = API_BASE_URL.replace(/\/api\/v1\/?$/, '');
  const query = invite ? `?invite=${encodeURIComponent(invite)}` : '';
  return `${origin}/apply${query}`;
}

export function acceptInviteQuery(query?: Record<string, string | undefined>) {
  const invite = String(query?.invite || '');
  const storeId = Number(query?.storeId || 0);
  if (invite) uni.setStorageSync('mini_from_invite', invite);
  if (storeId) uni.setStorageSync('mini_store_id', storeId);
  return { invite, storeId };
}
