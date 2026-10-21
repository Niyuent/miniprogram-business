import { defineStore } from 'pinia';
import { dayText, fetchMyCoupons, type CouponCard } from '@/services/member';

export type WalletTab = 'UNUSED' | 'USED' | 'EXPIRED';
export type WalletRow = { id: number; code: string; name: string; face: number; expire: string };

type Bucket = {
  rows: WalletRow[];
  total: number;
  page: number;
  ready: boolean;
  at: number;
};

const FRESH_MS = 15000;
const PAGE_SIZE = 10;
/** 已加载行数上限，防止无限拼接撑爆节点。 */
const MAX_ROWS = 50;
const flights = new Map<string, Promise<void>>();

function emptyBucket(): Bucket {
  return { rows: [], total: 0, page: 1, ready: false, at: 0 };
}

export function toWalletRow(row: CouponCard): WalletRow {
  return {
    id: row.id,
    code: row.code || '',
    name: row.name,
    face: row.faceValue,
    expire: dayText(row.expireAt),
  };
}

/** SWR：先读内存缓存秒开，再静默拉最新一页。券码不写本地存储。 */
export const useWalletStore = defineStore('wallet', {
  state: () => ({
    buckets: {
      UNUSED: emptyBucket(),
      USED: emptyBucket(),
      EXPIRED: emptyBucket(),
    } as Record<WalletTab, Bucket>,
  }),
  getters: {
    unusedReady: (state) => state.buckets.UNUSED.ready,
  },
  actions: {
    snapshot(status: WalletTab) {
      const bucket = this.buckets[status];
      return {
        rows: bucket.rows.slice(),
        total: bucket.total,
        page: bucket.page,
        ready: bucket.ready,
      };
    },
    reset() {
      this.buckets = {
        UNUSED: emptyBucket(),
        USED: emptyBucket(),
        EXPIRED: emptyBucket(),
      };
      flights.clear();
    },
    /** 预取 / 静默刷新第一页。有缓存时不挡界面。 */
    warm(status: WalletTab = 'UNUSED', force = false) {
      return this.loadPage(status, 1, { force, append: false });
    },
    /** 加载指定页；append=true 时拼到后面（上拉更多）。 */
    loadPage(status: WalletTab, page: number, opts: { force?: boolean; append?: boolean } = {}) {
      const key = `${status}:${page}:${opts.append ? 'a' : 'r'}`;
      const bucket = this.buckets[status];
      if (!opts.force && !opts.append && bucket.ready && Date.now() - bucket.at < FRESH_MS) {
        return Promise.resolve();
      }
      const existing = flights.get(key);
      if (existing) return existing;

      const job = fetchMyCoupons(status, page, PAGE_SIZE)
        .then((data) => {
          const rows = (data.list || []).map(toWalletRow);
          const next = this.buckets[status];
          let merged: WalletRow[];
          let keptPage = page;
          if (opts.append) {
            merged = next.rows.concat(rows).slice(0, MAX_ROWS);
          } else if (!opts.force && next.page > 1 && next.rows.length > PAGE_SIZE) {
            // 静默刷新只替换第一页，保留已上拉的后续页
            merged = rows.concat(next.rows.slice(PAGE_SIZE)).slice(0, MAX_ROWS);
            keptPage = next.page;
          } else {
            merged = rows;
          }
          this.buckets[status] = {
            rows: merged,
            total: data.total,
            page: keptPage,
            ready: true,
            at: Date.now(),
          };
        })
        .finally(() => {
          if (flights.get(key) === job) flights.delete(key);
        });
      flights.set(key, job);
      return job;
    },
  },
});
