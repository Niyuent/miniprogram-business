import type { ChatIntent } from '../tools/tool-registry';

export const WRITE_REFUSE =
  '我只做数据查询，不能直接改账。发积分请用扫码录单，核销券请到后台核销页操作。';

export const QUOTA_EXCEEDED = '今日提问次数已用完，明天再来';

/** 从回答中抽出数字（含小数、百分号前的数、千分位） */
export function extractNumbers(text: string): number[] {
  const cleaned = text.replace(/,/g, '');
  const matches = cleaned.match(/-?\d+(?:\.\d+)?/g) ?? [];
  return matches.map((m) => Number(m)).filter((n) => Number.isFinite(n));
}

/** 收集 facts 里允许出现在回答中的数字白名单 */
export function factNumbers(facts: Record<string, unknown>): Set<number> {
  const out = new Set<number>();
  const walk = (v: unknown) => {
    if (typeof v === 'number' && Number.isFinite(v)) {
      out.add(v);
      out.add(Number(v.toFixed(1)));
      out.add(Math.round(v));
      return;
    }
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    if (v && typeof v === 'object') {
      Object.values(v as Record<string, unknown>).forEach(walk);
    }
  };
  walk(facts);
  return out;
}

/**
 * 数值校验：回答里的数字必须落在 facts 白名单（允许差 0.05 的浮点）。
 * 对不上 → 丢弃模型文案。
 */
export function numbersMatchFacts(answer: string, facts: Record<string, unknown>): boolean {
  const allowed = factNumbers(facts);
  if (!allowed.size) {
    // 无数字事实时，回答也不该有业务数字（允许年份式数字过严，故放宽：无 facts 数字则跳过校验）
    return true;
  }
  const found = extractNumbers(answer);
  for (const n of found) {
    let ok = false;
    for (const a of allowed) {
      if (Math.abs(a - n) < 0.051) {
        ok = true;
        break;
      }
    }
    if (!ok) return false;
  }
  return true;
}

export function renderTemplate(
  intent: ChatIntent,
  facts: Record<string, unknown>,
  truncated: boolean,
): string {
  if (intent === 'write_request') return WRITE_REFUSE;

  if (facts.error) {
    return '数据暂时读不到，请稍后再试。';
  }

  if (intent === 'cashflow') {
    return String(facts.note ?? '尚未接入财务诊断');
  }

  if (intent === 'unknown') {
    return '我可以帮你查营收、订单、券核销、积分和流失老客。试试问「我昨天赚了多少」。';
  }

  const truncNote = truncated ? '（仅展示前若干条）' : '';

  if (intent === 'revenue_summary' || intent === 'order_summary' || intent === 'point_summary') {
    const revenue = num(facts.revenue);
    const orders = num(facts.orders);
    const redemptions = num(facts.redemptions);
    const pointsIssued = num(facts.pointsIssued);
    const pointsSpent = num(facts.pointsSpent);
    const dod = facts.dodPct == null ? null : num(facts.dodPct);
    const from = String(facts.from ?? '');
    const to = String(facts.to ?? '');
    const range = from === to ? from : `${from}～${to}`;
    const dodText = dod == null ? '对比期无基数' : `比对比期 ${dod > 0 ? '+' : ''}${dod}%`;

    if (intent === 'order_summary') {
      return `${range} 共 ${orders} 笔订单，营业额 ${fmtMoney(revenue)} 元，核销 ${redemptions} 笔。${dodText}。`;
    }
    if (intent === 'point_summary') {
      return `${range} 积分发行 ${pointsIssued}、消耗 ${pointsSpent}；同期订单 ${orders} 笔、营业额 ${fmtMoney(revenue)} 元。`;
    }
    return `${range} 营业额 ${fmtMoney(revenue)} 元，共 ${orders} 笔订单，核销 ${redemptions} 笔。${dodText}。`;
  }

  if (intent === 'coupon_performance') {
    const items = Array.isArray(facts.items) ? (facts.items as Array<Record<string, unknown>>) : [];
    if (!items.length) return `近几日暂无券核销数据。${truncNote}`;
    const top = items.slice(0, 3).map((it, i) => {
      const name = String(it.name ?? `券${i + 1}`);
      const redeemed = num(it.redeemed);
      const rate = num(it.redeemRate);
      const traffic = num(it.trafficDriven);
      return `${i + 1}. ${name}：核销 ${redeemed}，核销率 ${rate}%，带动客流 ${traffic}`;
    });
    const from = facts.from ? String(facts.from) : '';
    const to = facts.to ? String(facts.to) : '';
    const range = from && to ? `${from}～${to}` : '近几日';
    return `${range} 券表现：\n${top.join('\n')}${truncNote}`;
  }

  if (intent === 'lost_members') {
    const total = num(facts.total);
    const items = Array.isArray(facts.items) ? (facts.items as Array<Record<string, unknown>>) : [];
    if (!items.length) return '暂无超过 45 天未到店的老客。';
    const lines = items.slice(0, 5).map((it, i) => {
      return `${i + 1}. 会员#${it.userId}：${num(it.daysSince)} 天未到，历史消费 ${fmtMoney(num(it.historicalSpend))} 元`;
    });
    return `超过 45 天未到店共 ${total} 人（按历史消费排序）：\n${lines.join('\n')}${truncNote}`;
  }

  return '暂时无法理解这个问题，请换个问法试试。';
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n: number): string {
  return n.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
}
