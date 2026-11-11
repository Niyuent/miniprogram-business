/** 报表页通用工具：关键词客户端过滤 + 金额/枚举格式化 */

/** 关键词过滤：在 rows 中按 fields 字段做不区分大小写的包含匹配（后端报表无 keyword 参数，前端二次过滤） */
export function filterByKeyword<T extends Record<string, unknown>>(
  rows: T[] | undefined,
  kw: string,
  fields: string[],
): T[] {
  if (!rows) return [];
  const k = (kw || '').trim().toLowerCase();
  if (!k) return rows;
  return rows.filter((r) => fields.some((f) => String(r[f] ?? '').toLowerCase().includes(k)));
}

/** 千分位 + 固定小数 */
export function money(v: number | null | undefined, digits = 2): string {
  if (v == null) return '-';
  return Number(v).toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export function num(v: number | null | undefined): string {
  if (v == null) return '-';
  return Number(v).toLocaleString('zh-CN');
}
