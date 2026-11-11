import axios, { type AxiosRequestConfig, type InternalAxiosRequestConfig } from 'axios';
import type { ApiResponse } from '@/types/api';

/**
 * C 端 / H5 请求层（S5.1）
 *
 * 与后台请求层（`utils/request.ts`，用 `token`）**分离**：本层用 `userToken`（微信登录签发的 C 端 JWT），
 * 只访问 `/h5/**` 与 `/auth/user-login`；后台令牌访问 `/h5/**` 会被后端 403，反之亦然。
 */
// S5.1-Q2：C 端令牌 key 与后台 `admin_token` 显式分离；旧 key `userToken` 仅兜底读取
const TOKEN_KEY = 'user_token';
const LEGACY_TOKEN_KEY = 'userToken';
const USER_KEY = 'h5User';

const readToken = () => localStorage.getItem(TOKEN_KEY) || localStorage.getItem(LEGACY_TOKEN_KEY) || '';

export const h5Auth = {
  token: () => readToken(),
  isLogin: () => !!readToken(),
  set: (token: string, user: unknown) => {
    localStorage.setItem(TOKEN_KEY, token);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.setItem(USER_KEY, JSON.stringify(user ?? null));
  },
  user: <T = { id: number; nickname?: string | null; phone?: string | null }>(): T | null => {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? (JSON.parse(raw) as T) : null;
  },
  clear: () => {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(LEGACY_TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
};

const h5Request = axios.create({
  baseURL: import.meta.env.VITE_API_BASE || '/api/v1',
  timeout: 15000,
});

h5Request.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = h5Auth.token();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

h5Request.interceptors.response.use(
  (response) => response,
  (error) => {
    const status = error?.response?.status;
    if (status === 401) {
      h5Auth.clear();
      // 未登录 / 令牌失效 → 回 H5 登录页
      if (!window.location.pathname.startsWith('/h5/login')) {
        setTimeout(() => (window.location.href = '/h5/login'), 300);
      }
    }
    return Promise.reject(error);
  },
);

/** 业务请求：自动解包 data，失败抛出后端 message（含 reasonCode） */
export async function h5http<T>(config: AxiosRequestConfig): Promise<T> {
  const res = await h5Request.request<unknown, { data: ApiResponse<T> }>(config);
  const body = res.data;
  if (body.code >= 200 && body.code < 300) return body.data as T;
  throw new Error(body.message || '请求失败');
}

export default h5Request;
