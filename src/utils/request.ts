/** 商盟后端网关。微信开发者工具需勾选不校验合法域名（manifest 已关 urlCheck）。 */
export const API_BASE_URL = 'http://127.0.0.1/api/v1';

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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
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
      url: `${API_BASE_URL}${options.url.startsWith('/') ? options.url : `/${options.url}`}`,
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
