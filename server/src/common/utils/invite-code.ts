/**
 * 邀请码解析。
 *
 * 约定（与小程序 utils/share.ts 的 memberInviteCode/merchantInviteCode 对应）：
 *   U{userId}      C 端会员邀请（如 U1024）
 *   SM{merchantId} 主体商家邀请附属入驻（如 SM45）
 *
 * 解析失败一律返回 null，由调用方忽略——邀请码是可选归因信息，
 * 不应因为一个脏码让登录/入驻失败。
 */
export function parseUserInviteCode(code: string | undefined | null): number | null {
  const text = String(code ?? '').trim();
  if (!text) return null;
  const match = /^U(\d{1,10})$/.exec(text);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

export function parseMerchantInviteCode(code: string | undefined | null): number | null {
  const text = String(code ?? '').trim();
  if (!text) return null;
  const match = /^SM(\d{1,10})$/.exec(text);
  if (!match) return null;
  const id = Number(match[1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}
