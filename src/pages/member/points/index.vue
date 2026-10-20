<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPageScroll, onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import EmptyState from '@/components/EmptyState.vue';
import ListSkeleton from '@/components/ListSkeleton.vue';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { fetchPointTransactions } from '@/services/member';
import { dayText } from '@/services/member';
import { friendlyMessage } from '@/utils/errors';
import { sliceWindow } from '@/utils/windowList';

const loading = ref(true);
const loadingMore = ref(false);
const errorText = ref('');
type PointRow = { id: number; label: string; amount: number; day: string };
const list = ref<PointRow[]>([]);
const scrollTop = ref(0);
const windowed = computed(() => sliceWindow(list.value, scrollTop.value));
const page = ref(1);
const total = ref(0);

const typeText: Record<string, string> = {
  EARN: '获得',
  SPEND: '使用',
  EXPIRE: '过期',
  ADJUST: '调整',
};

async function load(reset: boolean) {
  if (reset) {
    page.value = 1;
    loading.value = list.value.length === 0;
  } else loadingMore.value = true;
  try {
    const data = await fetchPointTransactions(reset ? 1 : page.value, 10);
    total.value = data.total;
    const rows = (data.list || []).map((row) => ({
      id: row.id,
      label: typeText[row.type] || row.type,
      amount: row.amount,
      day: dayText(row.createdAt),
    }));
    list.value = reset ? rows : list.value.concat(rows);
    errorText.value = '';
  } catch (error) {
    errorText.value = friendlyMessage(error, '积分明细没有加载出来');
  } finally {
    loading.value = false;
    loadingMore.value = false;
    uni.stopPullDownRefresh();
  }
}

function more() {
  if (loading.value || loadingMore.value || list.value.length >= total.value) return;
  page.value += 1;
  load(false);
}

onShow(() => load(true));
onPullDownRefresh(() => load(true));
onReachBottom(() => more());
onPageScroll((event) => {
  const top = event.scrollTop || 0;
  if (Math.abs(top - scrollTop.value) < 80) return;
  scrollTop.value = top;
});
</script>

<template>
  <view class="page">
    <network-banner />
    <list-skeleton v-if="loading" />
    <view v-else class="list">
      <view v-if="errorText" class="fail">{{ errorText }}</view>
      <empty-state v-else-if="!list.length" title="还没有积分明细" hint="获得或使用积分后会出现在这里" />
      <view :style="{ height: windowed.padTop + 'px' }" />
      <view v-for="item in windowed.items" :key="item.id" class="row" hover-class="press">
        <view>
          <view>{{ item.label }}</view>
          <view class="time">{{ item.day }}</view>
        </view>
        <view :class="item.amount >= 0 ? 'plus' : 'minus'">{{ item.amount > 0 ? '+' : '' }}{{ item.amount }}</view>
      </view>
      <view :style="{ height: windowed.padBottom + 'px' }" />
      <view v-if="loadingMore" class="empty">正在加载…</view>
      <view v-else-if="list.length && list.length >= total" class="empty">没有更多了</view>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx 32rpx; box-sizing: border-box; }
.list { padding-bottom: 40rpx; }
.row { background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 16rpx; display: flex; justify-content: space-between; align-items: center; }
.time { margin-top: 6rpx; color: #94a3b8; font-size: 24rpx; }
.plus { color: #0f766e; font-weight: 700; }
.minus { color: #b91c1c; font-weight: 700; }
.empty, .fail { color: #64748b; padding: 20rpx 0; }
.fail { color: #b91c1c; font-weight: 700; }
.skel { height: 140rpx; background: #e2e8f0; border-radius: 16rpx; }
</style>
