import { defineStore } from 'pinia';
import { fetchCouponTemplates, type CouponTemplate } from '@/services/member';

export type MallRow = { id: number; name: string; face: number; cost: number; rule: string };

const FRESH_MS = 15000;
const PAGE_SIZE = 10;
const MAX_ROWS = 50;
const flights = new Map<string, Promise<void>>();

export function toMallRow(row: CouponTemplate): MallRow {
  return {
    id: row.id,
    name: row.name,
    face: row.faceValue,
    cost: row.pointsCost,
    rule: row.thresholdAmount > 0 ? `满 ${row.thresholdAmount} 可用` : '无门槛',
  };
}

/** SWR：商城模板列表。首页预取后，进商城直接画缓存。 */
export const useMallStore = defineStore('mall', {
  state: () => ({
    rows: [] as MallRow[],
    total: 0,
    page: 1,
    ready: false,
    at: 0,
  }),
  actions: {
    reset() {
      this.rows = [];
      this.total = 0;
      this.page = 1;
      this.ready = false;
      this.at = 0;
      flights.clear();
    },
    warm(force = false) {
      return this.loadPage(1, { force, append: false });
    },
    loadPage(page: number, opts: { force?: boolean; append?: boolean } = {}) {
      const key = `${page}:${opts.append ? 'a' : 'r'}`;
      if (!opts.force && !opts.append && this.ready && Date.now() - this.at < FRESH_MS) {
        return Promise.resolve();
      }
      const existing = flights.get(key);
      if (existing) return existing;

      const job = fetchCouponTemplates(page, PAGE_SIZE)
        .then((data) => {
          const rows = (data.list || []).map(toMallRow);
          let merged: MallRow[];
          let keptPage = page;
          if (opts.append) {
            merged = this.rows.concat(rows).slice(0, MAX_ROWS);
          } else if (!opts.force && this.page > 1 && this.rows.length > PAGE_SIZE) {
            merged = rows.concat(this.rows.slice(PAGE_SIZE)).slice(0, MAX_ROWS);
            keptPage = this.page;
          } else {
            merged = rows;
          }
          this.rows = merged;
          this.total = data.total;
          this.page = keptPage;
          this.ready = true;
          this.at = Date.now();
        })
        .finally(() => {
          if (flights.get(key) === job) flights.delete(key);
        });
      flights.set(key, job);
      return job;
    },
  },
});
