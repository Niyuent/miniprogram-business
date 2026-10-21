<script setup lang="ts">
import { ref } from 'vue';
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import EmptyState from '@/components/EmptyState.vue';
import ListSkeleton from '@/components/ListSkeleton.vue';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { dayText, fetchPointTransactions } from '@/services/member';
import { friendlyMessage } from '@/utils/errors';

const loading = ref(true);
const loadingMore = ref(false);
const errorText = ref('');
type PointRow = { id: number; label: string; amount: number; day: string };
const list = ref<PointRow[]>([]);
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
  } else {
    if (list.value.length >= 50) return;
    loadingMore.value = true;
  }
  try {
    const data = await fetchPointTransactions(reset ? 1 : page.value, 10);
    total.value = data.total;
    const rows = (data.list || []).map((row) => ({
      id: row.id,
      label: typeText[row.type] || row.type,
      amount: row.amount,
      day: dayText(row.createdAt),
    }));
    list.value = reset ? rows : list.value.concat(rows).slice(0, 50);
    errorText.value = '';
  } catch (error) {
    if (!list.value.length) errorText.value = friendlyMessage(error, '积分明细没有加载出来');
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
</script>

<template>
  <view class="page">
    <network-banner />
    <list-skeleton v-if="loading && !list.length" />
    <view v-else class="list">
      <view v-if="errorText && !list.length" class="fail">{{ errorText }}</view>
      <empty-state v-else-if="!list.length" title="还没有积分明细" hint="获得或使用积分后会出现在这里" />
      <template v-else>
        <view v-for="item in list" :key="item.id" class="row" hover-class="press" hover-start-time="20">
          <view class="row__main">
            <text class="row__label">{{ item.label }}</text>
            <text class="time">{{ item.day }}</text>
          </view>
          <text :class="item.amount >= 0 ? 'plus' : 'minus'">{{ item.amount > 0 ? '+' : '' }}{{ item.amount }}</text>
        </view>
        <text v-if="loadingMore" class="empty">正在加载…</text>
        <text v-else-if="list.length >= total || list.length >= 50" class="empty">没有更多了</text>
      </template>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx 32rpx; box-sizing: border-box; }
.list { padding-bottom: 40rpx; }
.row {
  background: #fff; border-radius: 16rpx; padding: 24rpx; margin-bottom: 16rpx;
  display: flex; justify-content: space-between; align-items: center;
}
.row__main { min-width: 0; }
.row__label { display: block; }
.time { display: block; margin-top: 6rpx; color: #94a3b8; font-size: 24rpx; }
.plus { color: #0f766e; font-weight: 700; }
.minus { color: #b91c1c; font-weight: 700; }
.empty, .fail { display: block; color: #64748b; padding: 20rpx 0; }
.fail { color: #b91c1c; font-weight: 700; }
</style>
