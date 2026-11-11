import { defineStore } from 'pinia';
import { ref } from 'vue';
import { notificationApi } from '@/api/notification';

/**
 * 站内信未读数（S5.4-B2 第 5 步）
 *
 * 为什么抽成 store 而不是各组件各自拉：
 *   发布成功 / 标记已读 / 全部已读后，需要**同时**更新「页面头部徽标」和（第 6 步的）铃铛红点。
 *   各处各自请求容易出现口径不一致（徽标说 3、铃铛说 5）。
 *
 * 数据流：`setCount()` 由列表接口顺带刷新（省一次请求）；`refresh()` 用于发布后等主动同步；
 *        `decrement()` 用于标记已读后的本地乐观更新。
 */
export const useNotificationStore = defineStore('notification', () => {
  const unreadCount = ref(0);
  /** 是否已成功拉取过（false 时徽标不显示，避免开局闪 0） */
  const loaded = ref(false);

  function setCount(n: number) {
    unreadCount.value = Math.max(0, n);
    loaded.value = true;
  }

  async function refresh() {
    try {
      const res = await notificationApi.unreadCount();
      setCount(res.unreadCount);
    } catch {
      // 拉取失败保持原值：未读数是展示态，不该因为一次网络抖动把红点清零
    }
  }

  /** 本地乐观扣减（标记已读 1 条 = -1） */
  function decrement(n = 1) {
    unreadCount.value = Math.max(0, unreadCount.value - n);
  }

  /**
   * SSE 收到 `notification:new` 时 +1（S7）
   *
   * 刻意不再拉接口：推送本身已经证明「多了一条未读」，
   * 这里只做乐观累加，下一次进通知中心列表时会自然校正。
   */
  function increment(n = 1) {
    unreadCount.value = Math.max(0, unreadCount.value + n);
    loaded.value = true;
  }

  /** 全部已读 */
  function clear() {
    unreadCount.value = 0;
  }

  /**
   * 已读状态变更计数器（S5.4-B2 第 6 步）
   *
   * 铃铛在**任何页面**都能标记已读/全部已读，而收件箱列表在另一个组件里。
   * 让页面去 watch 未读数不可靠（数值可能不变），因此用单调递增的版本号：
   * 铃铛改一次 → +1 → 通知中心页监听它并重拉列表。
   */
  const readStateVersion = ref(0);
  function bumpReadState() {
    readStateVersion.value += 1;
  }

  return { unreadCount, loaded, readStateVersion, setCount, refresh, increment, decrement, clear, bumpReadState };
});
