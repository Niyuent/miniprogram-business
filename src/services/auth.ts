import { homeOf, useSessionStore, type MiniRole } from '@/stores/session';
import { request } from '@/utils/request';

interface LoginResult {
  accessToken: string;
}

export interface BootstrapResult {
  role: MiniRole;
  profile?: { name?: string; avatar?: string | null; phone?: string | null };
  merchant?: { id: number; name: string; storeId: number | null } | null;
  tabs?: string[];
}

function mockWxCode() {
  return `dev_mock_${Date.now()}`;
}

/** 开发者工具未登录微信时 uni.login 会报 access_token missing；后端 WX_MODE=mock 时改用假 code。 */
function wxCode(): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof uni.login !== 'function') {
      resolve(mockWxCode());
      return;
    }
    uni.login({
      provider: 'weixin',
      success(res) {
        if (res.code) resolve(res.code);
        else resolve(mockWxCode());
      },
      fail(err) {
        const msg = String(err?.errMsg || '');
        if (/access_token missing|需要重新登录|login:fail|not support/i.test(msg)) {
          resolve(mockWxCode());
          return;
        }
        reject(new Error(msg || 'uni.login 失败'));
      },
    });
  });
}

/** 种子数据里的后台账号，仅供开发者工具切换商家端。 */
export const MERCHANT_TEST_ACCOUNTS = [
  { username: 'admin', label: '王主体', hint: '主体商家' },
  { username: 'sub01', label: '陈城南', hint: '城南旗舰店' },
  { username: 'clerk01', label: '赵店长', hint: '中心店店员' },
] as const;

const DEMO_PASSWORD = 'Test@123456';

let authEpoch = 0;

/** 退出时作废还没返回的微信登录，避免清掉 token 后又被送回会员页。 */
export function cancelPendingLogin() {
  authEpoch += 1;
}

async function enterWithToken(accessToken: string, epoch: number): Promise<void> {
  if (epoch !== authEpoch) return;
  const session = useSessionStore();
  session.setToken(accessToken);
  let boot: BootstrapResult;
  try {
    boot = await request<BootstrapResult>({
      url: '/mini/bootstrap',
      redirectOn401: false,
    });
  } catch (error) {
    session.clear();
    throw error;
  }
  if (boot?.role !== 'merchant' && boot?.role !== 'member') {
    session.clear();
    throw new Error('bootstrap 未返回角色');
  }
  if (epoch !== authEpoch) {
    session.clear();
    return;
  }
  session.applyBootstrap(boot);
  await new Promise<void>((resolve, reject) => {
    uni.reLaunch({
      url: homeOf(boot.role),
      success: () => resolve(),
      fail: (err) => reject(new Error(err.errMsg || '页面跳转失败')),
    });
  });
}

/** 商家测试：走后台账号登录，再由 bootstrap 判定为商家。 */
export function loginMerchantAndRoute(username: string): Promise<void> {
  const epoch = authEpoch;
  return request<LoginResult>({
    url: '/auth/login',
    method: 'POST',
    data: { username, password: DEMO_PASSWORD },
    auth: false,
    redirectOn401: false,
  }).then((logged) => {
    if (epoch !== authEpoch) return;
    if (!logged?.accessToken) throw new Error('登录响应缺少 accessToken');
    return enterWithToken(logged.accessToken, epoch);
  });
}

/** 微信登录成功后只按 /mini/bootstrap 的 role 进入对应首页。 */
export async function loginAndRoute(): Promise<void> {
  const epoch = authEpoch;
  const code = await wxCode();
  if (epoch !== authEpoch) return;
  const logged = await request<LoginResult>({
    url: '/auth/user-login',
    method: 'POST',
    data: { code },
    auth: false,
    redirectOn401: false,
  });
  if (epoch !== authEpoch) return;
  if (!logged?.accessToken) throw new Error('登录响应缺少 accessToken');
  await enterWithToken(logged.accessToken, epoch);
}
