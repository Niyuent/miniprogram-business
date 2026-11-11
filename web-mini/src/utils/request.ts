import { IS_DEV } from '@/utils/env';

/**
 * 接口地址解析：
 * - 开发者工具默认走 127.0.0.1:3000（DEV_API_PORT）；真机预览/调试走局域网 IP（DEV_LAN_HOST），也可用 storage 覆盖 key=`mini_api_host`；
 * - 发布构建优先用构建时注入的生产域名 `VITE_API_ORIGIN`（见 .env.example），不填才回退局域网 IP（供体验版联调）。
 *
 * 查看本机 IPv4：`ipconfig` 取 IPv4 地址，改 DEV_LAN_HOST。
 * 生产环境必须在微信后台配置 request 合法域名（https）。
 */

/**
 * 本地直连后端的端口。
 * 开发态默认 3000（本项目 NestJS 端口）；裸 IP 会被补上该端口，
 * 所以开发者工具里默认请求 `http://127.0.0.1:3000/api/v1`。
 * 若改为经 nginx 80 网关访问（docker compose 全栈），设 `VITE_API_PORT=` 置空即可。
 */
const DEV_API_PORT = String(import.meta.env.VITE_API_PORT ?? '3000').replace(/\D/g, '');

/** 给裸 IP / localhost 补端口；已带端口的原样返回，域名一律不动（生产域名不该被追加端口） */
function withDevPort(host: string) {
  if (!host || !DEV_API_PORT) return host;
  if (/:\d+$/.test(host)) return host;
  const isIpOrLoopback = /^(localhost|(\d{1,3}\.){3}\d{1,3}|\[[0-9a-f:]+\])$/i.test(host);
  return isIpOrLoopback ? `${host}:${DEV_API_PORT}` : host;
}

/**
 * 局域网调试 IP（已含端口），真机预览时使用；storage 优先，key=`mini_api_host`。
 * 只在开发构建里存在：发布包中该常量会被折叠成空串，避免把开发者内网地址带进产物。
 *
 * 注意：这是 DHCP 地址，换网络后会变。真机连不上时先用 `ipconfig` 看当前 IPv4 改这里，
 * 或直接在登录页调试面板的输入框里填 `当前IP:3000` 后点「应用」（优先级更高，不用改代码）。
 */
export const DEV_LAN_HOST = import.meta.env.DEV ? withDevPort('10.3.20.252') : '';

/** 发布构建的生产源（如 https://api.example.com）；构建时由 VITE_API_ORIGIN 注入，仅 release 生效 */
const RELEASE_API_ORIGIN = String(import.meta.env.VITE_API_ORIGIN || '').replace(/\/+$/, '');

function isWechatDevtools() {
  try {
    return uni.getSystemInfoSync().platform === 'devtools';
  } catch {
    return false;
  }
}

function resolveHost() {
  // storage 覆盖只对开发构建生效，避免体验版/正式版被遗留的本机地址带偏
  if (import.meta.env.DEV) {
    try {
      const override = String(uni.getStorageSync('mini_api_host') || '').trim();
      if (override) return withDevPort(override.replace(/^https?:\/\//, '').replace(/\/$/, ''));
    } catch {
      /* storage 不可用时忽略 */
    }
  }
  if (!import.meta.env.DEV && RELEASE_API_ORIGIN) {
    return RELEASE_API_ORIGIN.replace(/^https?:\/\//, '');
  }
  if (!import.meta.env.DEV) {
    // 发布构建既没注入 VITE_API_ORIGIN：回环地址必然不通（和用内网 IP 一样连不上），
    // 但至少不把开发者内网结构打进包里。真机联调请配 .env 的 VITE_API_ORIGIN。
    return '127.0.0.1';
  }
  return isWechatDevtools() ? withDevPort('127.0.0.1') : DEV_LAN_HOST;
}

function resolveApiBase() {
  if (!import.meta.env.DEV && RELEASE_API_ORIGIN) {
    return `${RELEASE_API_ORIGIN}/api/v1`;
  }
  return `http://${resolveHost()}/api/v1`;
}

/** 兼容旧引用的常量（模块加载时求值）；地址变更后请用 apiBaseUrl() 动态获取。 */
export const API_BASE_URL = resolveApiBase();

export function apiBaseUrl() {
  return resolveApiBase();
}

export function apiHost() {
  return resolveHost();
}

/** 真机调试临时把接口指到某个 IP；传空串恢复默认。仅开发构建可用（发布构建不再暴露改写能力）。 */
export function setApiHost(host: string) {
  if (!IS_DEV) return;
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

/** 探活 /health */
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
          detail: err.errMsg || '请求失败',
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
  /** 传 false 表示公共接口，不带 token（如登录） */
  auth?: boolean;
  /** 传 false 表示 401 时不自动跳登录页（调用方自行处理） */
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
 * 统一请求：自动带 JWT，解析 { code, message, data } 信封，401 跳登录页。
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
            : `请求失败（状态码 ${status}）`;
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
        reject(new HttpError(0, err.errMsg || '网络请求失败'));
      },
    });
  });
}

export function isUnimplemented(error: unknown): boolean {
  if (!(error instanceof HttpError)) return false;
  return error.status === 404 || error.status === 501;
}
