/**
 * 金额与账期格式化。
 *
 * 刻意不用 Number.prototype.toLocaleString('zh-CN')：小程序在部分 iOS 版本上
 * 会忽略 locale 参数直接返回原值（4860 而不是 4,860），收银与结算界面不能赌这个。
 */

/** 千分位金额：整数不带小数，有角分才显示两位 */
export function money(n: number): string {
  const v = Number(n);
  if (!Number.isFinite(v)) return '0';
  const neg = v < 0;
  const [int, dec] = Math.abs(v).toFixed(2).split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const tail = dec === '00' ? '' : `.${dec}`;
  return `${neg ? '-' : ''}${grouped}${tail}`;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function md(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

function ymd(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

/** 短账期：10.01 – 10.31（同年时省略年份） */
export function periodShort(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return '';
  if (s.getFullYear() === e.getFullYear()) return `${md(start)} – ${md(end)}`;
  return `${ymd(start)} – ${ymd(end)}`;
}

/** 完整账期：2026.10.01 – 2026.10.31 */
export function periodFull(start: string, end: string): string {
  return `${ymd(start)} – ${ymd(end)}`;
}
