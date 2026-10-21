/**
 * 微信公众平台「订阅消息」模板 ID（上架前在公众平台申请后填入）。
 * 目前留空：仍会弹出业务引导；用户点「允许」时若未配置会提示「订阅模板还未配置」。
 */
export const TMPL_MERCHANT_REDEEM = '';
export const TMPL_MEMBER_EXCHANGE = '';

import { apiHost, DEV_LAN_HOST } from '@/utils/request';

/**
 * Zero（智店助手 / 小Z）默认 8001。
 * 与商盟 API 共用同一 host（含 storage `mini_api_host` 覆盖），避免真机只改了商盟地址、Zero 仍打旧 IP。
 */
export function zeroApiBase() {
  return `http://${apiHost()}:8001`;
}

/** @deprecated 请用 zeroApiBase() */
export const ZERO_API_BASE = `http://${DEV_LAN_HOST}:8001`;
export const ZERO_ENABLED = true;

/**
 * Zero 商家演示账号（与 docs/store_profile_curl.md 一致）。
 * 四大金刚（海报/记账/拍菜单）需要 Zero JWT。
 */
export const ZERO_ACCOUNT = 'content_demo';
export const ZERO_PASSWORD = 'demo123456';

export const ZERO_TOKEN_KEY = 'zero_token';
