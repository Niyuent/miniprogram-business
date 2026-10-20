import { defineStore } from 'pinia';

/** 当前底栏停留的面板。同一页内切换，避免 reLaunch 白屏。 */
export const useDeskStore = defineStore('desk', {
  state: () => ({
    member: 'home',
    merchant: 'workbench',
    pull: 0,
    reach: 0,
    scrollTop: 0,
  }),
});
