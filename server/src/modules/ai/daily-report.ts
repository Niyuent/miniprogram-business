/** 上海时区的自然日窗口。中国无夏令时，用 +08:00 字面量，避免 UTC 比较滑出当天。 */
export function shanghaiDay(offsetDays = 0): { ymd: string; from: Date; to: Date; bizId: number } {
  const anchor = new Date(Date.now() + offsetDays * 24 * 60 * 60 * 1000);
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(anchor);
  const from = new Date(`${ymd}T00:00:00+08:00`);
  const to = new Date(from.getTime() + 24 * 60 * 60 * 1000);
  return { ymd, from, to, bizId: Number(ymd.replace(/-/g, '')) };
}

export function changePct(today: number, base: number): number | null {
  if (base === 0) return today === 0 ? 0 : null;
  return Number((((today - base) / base) * 100).toFixed(1));
}

export type ReportStatus = '优秀' | '正常' | '需关注';

/** Laya 不可用时的规则兜底：只看数字，不编造原因。 */
export function fallbackStatus(input: {
  orderChange: number | null;
  redeemChange: number | null;
  churnCount: number;
}): ReportStatus {
  const orderDown = input.orderChange != null && input.orderChange <= -15;
  const redeemDown = input.redeemChange != null && input.redeemChange <= -15;
  if (orderDown || redeemDown || input.churnCount >= 3) return '需关注';
  const orderUp = input.orderChange != null && input.orderChange >= 10;
  const redeemOk = input.redeemChange == null || input.redeemChange >= 0;
  if (orderUp && redeemOk && input.churnCount === 0) return '优秀';
  return '正常';
}

export function templateCopy(input: {
  status: ReportStatus;
  merchantName: string;
  orders: number;
  orderChange: number | null;
  redemptions: number;
  redeemChange: number | null;
  pointsIssued: number;
  pointsSpent: number;
  highValue: number;
  churn: number;
}): { summary: string; suggestions: string[] } {
  const orderText = input.orderChange == null ? '昨日无订单，无法比较' : `较昨日 ${signed(input.orderChange)}`;
  const redeemText = input.redeemChange == null ? '昨日无核销' : `较昨日 ${signed(input.redeemChange)}`;
  const summary = `${input.merchantName}今日 ${input.status}：订单 ${input.orders} 笔（${orderText}），核销 ${input.redemptions} 笔（${redeemText}），积分发行 ${input.pointsIssued}、消耗 ${input.pointsSpent}。高价值客户 ${input.highValue} 人，45 天未到店 ${input.churn} 人。`;
  const suggestions: string[] = [];
  if (input.churn > 0) suggestions.push(`${input.churn} 位老客户已超过 45 天未到店，可定向发券召回`);
  if (input.orderChange != null && input.orderChange <= -15) suggestions.push('今日订单较昨日下降超过 15%，建议核对是否有门店未录单');
  if (input.highValue > 0) suggestions.push(`近 90 天有 ${input.highValue} 位高价值客户，可优先维护`);
  if (!suggestions.length) suggestions.push('今日波动在正常范围内，保持现有积分与核销节奏');
  return { summary, suggestions: suggestions.slice(0, 3) };
}

function signed(n: number): string {
  return `${n > 0 ? '+' : ''}${n}%`;
}

/** 站内信正文。通知列表只展示纯文本，不发 JSON。 */
export function formatDailyReport(input: { status: string; summary: string; suggestions: string[] }): string {
  const suggestions = input.suggestions.map((s) => s.trim()).filter(Boolean).slice(0, 3);
  const lines = [`【状态】${input.status}`, `【摘要】${input.summary.trim()}`, '【建议】'];
  if (!suggestions.length) lines.push('1. 今日按现有节奏经营即可');
  else suggestions.forEach((item, index) => lines.push(`${index + 1}. ${item}`));
  const text = lines.join('\n');
  return text.length > 900 ? `${text.slice(0, 897)}...` : text;
}
