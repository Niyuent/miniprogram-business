import { shanghaiDay } from '../daily-report';
import type { AiToolsService, CompareMode } from './ai-tools.service';

export const CHAT_INTENTS = [
  'revenue_summary',
  'order_summary',
  'coupon_performance',
  'point_summary',
  'lost_members',
  'cashflow',
  'write_request',
  'unknown',
] as const;

export type ChatIntent = (typeof CHAT_INTENTS)[number];

export interface IntentParams {
  from?: string;
  to?: string;
  compare?: CompareMode;
  days?: number;
  limit?: number;
  offset?: number;
}

export interface ToolCallRecord {
  name: string;
  params: IntentParams;
  ok: boolean;
  latencyMs: number;
  error?: string;
}

export function isChatIntent(v: unknown): v is ChatIntent {
  return typeof v === 'string' && (CHAT_INTENTS as readonly string[]).includes(v);
}

/** 关键词兜底表（模型不可用 / 意图解析失败时） */
export function matchByKeyword(message: string): { intent: ChatIntent; params: IntentParams } {
  const text = message.trim();
  if (/发积分|核销券|改价格|退款/.test(text)) return { intent: 'write_request', params: {} };
  if (/现金流|撑多久|资金/.test(text)) return { intent: 'cashflow', params: {} };
  if (/老客|流失|没来/.test(text)) return { intent: 'lost_members', params: { limit: 20, offset: 0 } };
  if (/积分/.test(text)) return { intent: 'point_summary', params: defaultDayRange(text) };
  if (/券|核销|优惠/.test(text)) return { intent: 'coupon_performance', params: { days: 7, limit: 20 } };
  if (/订单|单量/.test(text)) return { intent: 'order_summary', params: defaultDayRange(text) };
  if (/赚|营收|营业额|流水|卖了|收入/.test(text)) {
    return { intent: 'revenue_summary', params: defaultDayRange(text) };
  }
  return { intent: 'unknown', params: defaultDayRange(text) };
}

function defaultDayRange(text: string): IntentParams {
  if (/今天|今日/.test(text)) {
    const d = shanghaiDay(0).ymd;
    return { from: d, to: d, compare: 'prev_period' };
  }
  if (/本周|这周/.test(text)) {
    const today = shanghaiDay(0);
    const dow = new Date(`${today.ymd}T12:00:00+08:00`).getUTCDay(); // 0=Sun
    // 上海周一：若周日则回退 6 天
    const mondayOffset = dow === 0 ? -6 : 1 - dow;
    const from = shanghaiDay(mondayOffset).ymd;
    return { from, to: today.ymd, compare: 'prev_period' };
  }
  // 默认昨天
  const y = shanghaiDay(-1).ymd;
  return { from: y, to: y, compare: 'prev_period' };
}

/**
 * 按意图调用工具。merchantId 仅在此处注入。
 */
export async function runTool(
  tools: AiToolsService,
  intent: ChatIntent,
  params: IntentParams,
  merchantId: number,
): Promise<{ facts: Record<string, unknown>; toolCalls: ToolCallRecord[]; truncated: boolean }> {
  const toolCalls: ToolCallRecord[] = [];
  const started = Date.now();

  if (intent === 'write_request' || intent === 'unknown' || intent === 'cashflow') {
    if (intent === 'cashflow') {
      try {
        const hint = await tools.cashflowHint(merchantId);
        toolCalls.push({ name: 'cashflowHint', params, ok: true, latencyMs: Date.now() - started });
        return { facts: { ...hint }, toolCalls, truncated: false };
      } catch (e) {
        toolCalls.push({
          name: 'cashflowHint',
          params,
          ok: false,
          latencyMs: Date.now() - started,
          error: (e as Error).message,
        });
        return { facts: { available: false, note: '尚未接入财务诊断' }, toolCalls, truncated: false };
      }
    }
    return { facts: {}, toolCalls, truncated: false };
  }

  const from = params.from ?? shanghaiDay(-1).ymd;
  const to = params.to ?? from;
  const compare = params.compare ?? 'prev_period';
  const days = params.days ?? 7;
  const limit = params.limit ?? 20;
  const offset = params.offset ?? 0;

  try {
    if (intent === 'revenue_summary' || intent === 'order_summary' || intent === 'point_summary') {
      const res = await tools.businessSummary(merchantId, from, to, compare);
      toolCalls.push({
        name: 'businessSummary',
        params: { from, to, compare },
        ok: true,
        latencyMs: Date.now() - started,
      });
      const row = res.items[0] ?? {};
      return { facts: { ...row, intent }, toolCalls, truncated: !!res.meta.truncated };
    }

    if (intent === 'coupon_performance') {
      const res = await tools.couponPerformance(merchantId, days, limit);
      toolCalls.push({
        name: 'couponPerformance',
        params: { days, limit },
        ok: true,
        latencyMs: Date.now() - started,
      });
      return {
        facts: { items: res.items, from: res.meta.from, to: res.meta.to, truncated: res.meta.truncated },
        toolCalls,
        truncated: !!res.meta.truncated,
      };
    }

    if (intent === 'lost_members') {
      const res = await tools.lostMembers(merchantId, limit, offset);
      toolCalls.push({
        name: 'lostMembers',
        params: { limit, offset },
        ok: true,
        latencyMs: Date.now() - started,
      });
      return {
        facts: {
          items: res.items,
          total: res.meta.total,
          truncated: res.meta.truncated,
          limit,
          offset,
        },
        toolCalls,
        truncated: !!res.meta.truncated,
      };
    }
  } catch (e) {
    toolCalls.push({
      name: intent,
      params,
      ok: false,
      latencyMs: Date.now() - started,
      error: (e as Error).message,
    });
    return { facts: { error: (e as Error).message }, toolCalls, truncated: false };
  }

  return { facts: {}, toolCalls, truncated: false };
}
