import { LOGIN_PAGE, MEMBER_HOME, MERCHANT_HOME, readStoredRole } from '@/stores/session';
import { TOKEN_KEY } from '@/utils/request';

type NavArgs = { url?: string };

function pathOf(url: string): string {
  return url.split('?')[0];
}

/**
 * 会员不能进入商家页，商家不能进入会员页。
 * 返回最终应打开的地址；调用方写回本次跳转的 url。
 */
export function resolveRoute(url: string): string {
  const path = pathOf(url);
  if (!path || path === LOGIN_PAGE || path.startsWith('/pages/apply/')) return url || LOGIN_PAGE;

  const token = uni.getStorageSync(TOKEN_KEY) as string;
  const role = readStoredRole();
  if (!token || !role) return LOGIN_PAGE;

  if (role === 'member' && path.startsWith('/pages/merchant/')) return MEMBER_HOME;
  if (role === 'merchant' && path.startsWith('/pages/member/')) return MERCHANT_HOME;
  return url;
}

export function installRouteGuard() {
  const methods = ['navigateTo', 'redirectTo', 'reLaunch', 'switchTab'] as const;
  methods.forEach((method) => {
    uni.addInterceptor(method, {
      invoke(args: NavArgs) {
        const next = resolveRoute(args?.url || '');
        args.url = next;
        return args;
      },
    });
  });
}
