import { defineStore } from 'pinia';
import { dayText, fetchMyCoupons, type CouponCard } from '@/services/member';

export type WalletRow = { id: number; code: string; name: string; face: number; expire: string };

const FRESH_MS = 20000;
let flight: Promise<void> | null = null;

export function toWalletRow(row: CouponCard): WalletRow {
  return {
    id: row.id,
    code: row.code || '',
    name: row.name,
    face: row.faceValue,
    expire: dayText(row.expireAt),
  };
}

/** 首页预取的未使用卡包。只放内存，不把券码写入本地存储。 */
export const useWalletStore = defineStore('wallet', {
  state: () => ({
    rows: [] as WalletRow[],
    total: 0,
    ready: false,
    at: 0,
  }),
  actions: {
    paint(rows: WalletRow[], total: number) {
      this.rows = rows;
      this.total = total;
      this.ready = true;
      this.at = Date.now();
    },
    reset() {
      this.rows = [];
      this.total = 0;
      this.ready = false;
      this.at = 0;
      flight = null;
    },
    warm(force = false) {
      if (flight) return flight;
      if (!force && this.ready && Date.now() - this.at < FRESH_MS) return Promise.resolve();
      const job = fetchMyCoupons('UNUSED', 1, 10)
        .then((data) => {
          this.paint((data.list || []).map(toWalletRow), data.total);
        })
        .finally(() => {
          if (flight === job) flight = null;
        });
      flight = job;
      return job;
    },
  },
});
