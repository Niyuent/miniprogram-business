import { request } from '@/utils/request';

export interface AiChatQuota {
  usedToday: number;
  limit: number;
}

export interface AiChatResult {
  sessionId: string;
  answer: string;
  intent: string;
  facts: Record<string, unknown>;
  card: Record<string, unknown> | null;
  fallbackUsed: boolean;
  quota: AiChatQuota;
}

export interface BusinessSummaryCard {
  from: string;
  to: string;
  revenue: number;
  orders: number;
  redemptions: number;
  pointsIssued: number;
  pointsSpent: number;
  dodPct: number | null;
}

export function chatAi(message: string, sessionId?: string | null) {
  return request<AiChatResult>({
    url: '/ai/chat',
    method: 'POST',
    data: { message, ...(sessionId ? { sessionId } : {}) },
  });
}

/** 降级静态卡片：昨日营收摘要 */
export function fetchYesterdaySummary() {
  const y = yesterdayYmd();
  return request<{ items: BusinessSummaryCard[]; meta: Record<string, unknown> }>({
    url: `/ai-tools/business-summary?from=${y}&to=${y}`,
  });
}

function yesterdayYmd(): string {
  const d = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
  return parts;
}

export function formatSummaryCard(card: BusinessSummaryCard): string {
  const dod =
    card.dodPct == null ? '对比期无基数' : `比对比期 ${card.dodPct > 0 ? '+' : ''}${card.dodPct}%`;
  return (
    `AI 暂时不可用，下面是你的数据\n` +
    `${card.from} 营业额 ${card.revenue} 元，订单 ${card.orders} 笔，核销 ${card.redemptions} 笔。${dod}。`
  );
}
