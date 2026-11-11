/** 列表超过一屏后只渲染视口附近的行，避免一次 setData 整表。 */
const ROW_PX = 112;
const WINDOW = 18;
const FULL_LIMIT = 40;

export function sliceWindow<T>(list: T[], scrollTop: number): { items: T[]; padTop: number; padBottom: number } {
  if (list.length <= FULL_LIMIT) {
    return { items: list, padTop: 0, padBottom: 0 };
  }
  const start = Math.max(0, Math.floor(scrollTop / ROW_PX) - 4);
  const end = Math.min(list.length, start + WINDOW);
  return {
    items: list.slice(start, end),
    padTop: start * ROW_PX,
    padBottom: Math.max(0, list.length - end) * ROW_PX,
  };
}
