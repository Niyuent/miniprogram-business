/**
 * 会员码编解码（前后端契约）。
 *
 * SM_TICKET:{jwt}  —— 5 分钟短时效票据，防截图/拍照转发盗刷（首选）。
 * SM_MEMBER:{id}   —— 旧版永久会员编号，保留解析兼容，新码不再生成。
 */

export const MEMBER_PREFIX = 'SM_MEMBER:';
export const TICKET_PREFIX = 'SM_TICKET:';

export interface ScannedMember {
  ticket?: string;
  userId?: number;
}

export function buildTicketPayload(ticket: string): string {
  return `${TICKET_PREFIX}${ticket}`;
}

/** @deprecated 仅兼容历史二维码，新码一律用 buildTicketPayload */
export function buildLegacyPayload(userId: number): string {
  return `${MEMBER_PREFIX}${userId}`;
}

/** 解析扫码结果；不是会员码返回 null（调用方按券码继续处理）。 */
export function parseScannedMember(raw: string): ScannedMember | null {
  const text = String(raw || '').trim();
  if (text.startsWith(TICKET_PREFIX)) {
    const ticket = text.slice(TICKET_PREFIX.length).trim();
    return ticket ? { ticket } : null;
  }
  if (text.startsWith(MEMBER_PREFIX)) {
    const id = Number(text.slice(MEMBER_PREFIX.length));
    return Number.isInteger(id) && id > 0 ? { userId: id } : null;
  }
  return null;
}
