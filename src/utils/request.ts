/**
 * 后端网关。
 * - 开发者工具模拟器：127.0.0.1（指电脑本机）
 * - 真机预览/扫码调试：必须用电脑局域网 IP（手机上的 127.0.0.1 是手机自己）
 *
 * 换网后执行 `ipconfig` 看 IPv4，改 DEV_LAN_HOST 后重新编译预览。
 * 上架改为 https 正式域名。
 */
/** 真机默认局域网 IP；换网后改这里，或在登录页用 storage 覆盖 key=`mini_api_host` */
export const DEV_LAN_HOST = '10.5.89.38';

function isWechatDevtools() {
  try {
    return uni.getSystemInfoSync().platform === 'devtools';
  } catch {
    return false;
  }
}

function resolveHost() {
  try {
    const override = String(uni.getStorageSync('mini_api_host') || '').trim();
    if (override) return override.replace(/^https?:\/\//, '').replace(/\/$/, '');
  } catch {
    /* storage 未就绪时忽略 */
  }
  return isWechatDevtools() ? '127.0.0.1' : DEV_LAN_HOST;
}

function resolveApiBase() {
  return `http://${resolveHost()}/api/v1`;
}

/** 每次请求时解析，避免模块加载时拿不到 platform */
export const API_BASE_URL = resolveApiBase();

export function apiBaseUrl() {
  return resolveApiBase();
}

export function apiHost() {
  return resolveHost();
}

/** 登录页覆盖接口主机（真机调试用 127.0.0.1，预览码用局域网 IP） */
export function setApiHost(host: string) {
  const cleaned = host.replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim();
  if (!cleaned) {
    try {
      uni.removeStorageSync('mini_api_host');
    } catch {
      /* ignore */
    }
    return;
  }
  uni.setStorageSync('mini_api_host', cleaned);
}

/** 探活：能否打到网关 /health */
export function probeApi(): Promise<{ ok: boolean; ms: number; detail: string }> {
  const started = Date.now();
  const url = `${apiBaseUrl().replace(/\/api\/v1\/?$/, '')}/api/v1/health`;
  return new Promise((resolve) => {
    uni.request({
      url,
      method: 'GET',
      timeout: 8000,
      success(res) {
        const ms = Date.now() - started;
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve({ ok: true, ms, detail: `通 ${ms}ms` });
          return;
        }
        resolve({ ok: false, ms, detail: `HTTP ${res.statusCode}` });
      },
      fail(err) {
        resolve({
          ok: false,
          ms: Date.now() - started,
          detail: err.errMsg || '网络不可用',
        });
      },
    });
  });
}

export const TOKEN_KEY = 'mini_token';
export const ROLE_KEY = 'mini_role';

const LOGIN_URL = '/pages/login/index';

export class HttpError extends Error {
  status: number;
  reasonCode?: string;
  payload?: unknown;

  constructor(status: number, message: string, reasonCode?: string, payload?: unknown) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.reasonCode = reasonCode;
    this.payload = payload;
  }
}

export interface RequestOptions {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  data?: UniApp.RequestOptions['data'];
  /** 为 false 时不带 token，登录接口使用 */
  auth?: boolean;
  /** 为 false 时 401 只抛错，不跳登录（避免登录页死循环） */
  redirectOn401?: boolean;
}

interface Envelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

function currentRoute(): string {
  const pages = getCurrentPages();
  const last = pages[pages.length - 1] as { route?: string } | undefined;
  return last?.route ? `/${last.route}` : '';
}

function redirectToLogin() {
  uni.removeStorageSync(TOKEN_KEY);
  uni.removeStorageSync(ROLE_KEY);
  uni.removeStorageSync('mini_tabs');
  uni.removeStorageSync('mini_profile_name');
  uni.removeStorageSync('mini_avatar');
  if (currentRoute() === LOGIN_URL) return;
  uni.reLaunch({ url: LOGIN_URL });
}

/**
 * 统一请求：注入 JWT，解开 { code, message, data }，401 回到微信登录页。
 */
export function request<T>(options: RequestOptions): Promise<T> {
  const auth = options.auth !== false;
  const redirectOn401 = options.redirectOn401 !== false;
  const header: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (auth) {
    const token = uni.getStorageSync(TOKEN_KEY) as string;
    if (token) header.Authorization = `Bearer ${token}`;
  }

  return new Promise((resolve, reject) => {
    uni.request({
      url: `${apiBaseUrl()}${options.url.startsWith('/') ? options.url : `/${options.url}`}`,
      method: options.method ?? 'GET',
      data: options.data,
      header,
      timeout: 15000,
      success(res) {
        const status = res.statusCode || 0;
        const body = res.data as Envelope<T> | T | undefined;
        const message =
          body && typeof body === 'object' && 'message' in body && typeof body.message === 'string'
            ? body.message
            : `请求失败（${status}）`;
        const payload = body && typeof body === 'object' && 'data' in body ? body.data : undefined;
        const reasonCode =
          payload && typeof payload === 'object' && payload && 'reasonCode' in payload
            ? String((payload as { reasonCode?: string }).reasonCode || '')
            : undefined;

        if (status === 401) {
          if (redirectOn401) redirectToLogin();
          reject(new HttpError(401, message || '登录已失效', reasonCode, payload));
          return;
        }
        if (status < 200 || status >= 300) {
          reject(new HttpError(status, message, reasonCode, payload));
          return;
        }
        if (body && typeof body === 'object' && 'data' in body && 'code' in body) {
          resolve((body as Envelope<T>).data as T);
          return;
        }
        resolve(body as T);
      },
      fail(err) {
        reject(new HttpError(0, err.errMsg || '网络不可用'));
      },
    });
  });
}

export function isUnimplemented(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  return error.status === 404 || error.status === 501;
}
