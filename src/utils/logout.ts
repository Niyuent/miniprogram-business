import { cancelPendingLogin } from '@/services/auth';
import { useSessionStore } from '@/stores/session';
import { useWalletStore } from '@/stores/wallet';
import { dropSticky } from '@/utils/sticky';

export function logoutToLogin() {
  cancelPendingLogin();
  try {
    useWalletStore().reset();
  } catch {
    /* 退出时内存卡包清不掉也不影响登录页 */
  }
  dropSticky('mini_workbench_card');
  dropSticky('mini_member_card');
  try {
    useSessionStore().clear();
  } catch {
    uni.removeStorageSync('mini_token');
    uni.removeStorageSync('mini_role');
  }
  const jump = () => {
    uni.reLaunch({ url: '/pages/login/index' });
  };
  const native = (globalThis as { wx?: { reLaunch?: (opts: { url: string }) => void } }).wx;
  if (typeof native?.reLaunch === 'function') native.reLaunch({ url: '/pages/login/index' });
  else jump();
}
