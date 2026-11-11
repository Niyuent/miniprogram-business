/**
 * 统一 CSV 生成（S4.3 抽出，S4.2 对账导出同步复用，保证全站一个格式）
 *
 * 两条硬性约定，缺一个都会在 Excel 里出问题：
 *  1. 前缀 UTF-8 BOM（\uFEFF）—— 不加的话 Excel 打开 UTF-8 CSV 中文全乱码；
 *  2. 字段转义 —— 内部双引号按 RFC 4180 翻倍，**所有字段一律用双引号包裹**。
 *
 * 关于「一律加引号」：S4.2 对账导出的既有产物（docs/screenshots/s42-06-export-detail.csv）
 * 即全字段带引号；S4.3 抽出本工具时若改成「按需加引号」，会静默改变 S4.2 的导出格式
 * （S4.2 用例5 断言的正是「字段被双引号包裹」）。故这里统一为「一律加引号」，全站一个格式。
 */
export function toCsv(headers: string[], rows: unknown[][]): string {
  const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  return '\uFEFF' + [headers, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
}
