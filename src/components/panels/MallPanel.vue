<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import ListSkeleton from '@/components/ListSkeleton.vue';
import { useSessionStore } from '@/stores/session';
import { exchangeCoupon, fetchCouponTemplates, fetchMe, type CouponTemplate } from '@/services/member';
import { friendlyMessage } from '@/utils/errors';
import { HttpError } from '@/utils/request';
import { rememberMember } from '@/utils/share';
import { useDeskStore } from '@/stores/desk';
import { sliceWindow } from '@/utils/windowList';
import { grantSubscribe } from '@/utils/subscribe';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const loadingMore = ref(false);
const refreshing = ref(false);
const errorText = ref('');
type MallRow = { id: number; name: string; face: number; cost: number; rule: string };
const list = ref<MallRow[]>([]);
const page = ref(1);
const total = ref(0);
const userId = ref(0);
const exchanging = ref(false);
const pageSize = 10;

async function load(reset: boolean) {
  if (reset) page.value = 1;
  else loadingMore.value = true;
  if (reset && !list.value.length) loading.value = true;
  errorText.value = '';
  try {
    const [me, data] = await Promise.all([
      reset ? fetchMe() : Promise.resolve(null),
      fetchCouponTemplates(reset ? 1 : page.value, pageSize),
    ]);
    if (me) {
      userId.value = me.id;
      rememberMember(me.id);
    }
    total.value = data.total;
    const rows = (data.list || []).map(toRow);
    list.value = reset ? rows : list.value.concat(rows);
  } catch (error) {
    errorText.value = friendlyMessage(error, '券列表没有加载出来');
  } finally {
    loading.value = false;
    loadingMore.value = false;
    refreshing.value = false;
    uni.stopPullDownRefresh();
  }
}

function more() {
  if (loading.value || loadingMore.value || list.value.length >= total.value) return;
  page.value += 1;
  load(false);
}

function toRow(row: CouponTemplate): MallRow {
  return {
    id: row.id,
    name: row.name,
    face: row.faceValue,
    cost: row.pointsCost,
    rule: row.thresholdAmount > 0 ? `满 ${row.thresholdAmount} 可用` : '无门槛',
  };
}

function ask(item: MallRow) {
  if (exchanging.value) return;
  uni.showModal({
    title: '确认兑换',
    content: `确认消耗 ${item.cost} 积分兑换此券吗？`,
    success: async (res) => {
      if (!res.confirm || exchanging.value) return;
      exchanging.value = true;
      uni.showLoading({ title: '正在兑换', mask: true });
      try {
        await exchangeCoupon({
          userId: userId.value,
          templateId: item.id,
          requestId: `ex${Date.now()}${Math.floor(Math.random() * 1000)}`,
        });
        uni.showModal({
          title: '兑换成功，已存入卡包',
          content: '可以去卡包亮码。打开服务通知后，发券或快过期时会提醒你。',
          confirmText: '允许接收通知',
          cancelText: '去卡包',
          success(next) {
            if (next.confirm) grantSubscribe('exchange');
            else useDeskStore().member = 'wallet';
          },
        });
      } catch (error) {
        const text = error instanceof HttpError && error.reasonCode === 'BALANCE_NOT_ENOUGH'
          ? '积分不够哦'
          : friendlyMessage(error, '兑换没有完成');
        uni.showToast({ title: text, icon: 'none' });
      } finally {
        exchanging.value = false;
        uni.hideLoading();
      }
    },
  });
}

const desk = useDeskStore();
const windowed = computed(() => sliceWindow(list.value, desk.scrollTop));
watch(() => desk.pull, () => { if (props.active) load(true); });
watch(() => desk.reach, () => { if (props.active) more(); });

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    load(true);
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <view class="title">积分商城</view>
    <view class="group">满减券和代金券</view>
    <view class="list">
      <list-skeleton v-if="loading" :count="4" />
      <view v-else-if="errorText" class="fail">{{ errorText }}</view>
      <empty-state v-else-if="!list.length" title="暂时没有可兑换的券" hint="上架新券后会出现在这里" />
      <view :style="{ height: windowed.padTop + 'px' }" />
      <view v-for="item in windowed.items" :key="item.id" class="coupon" hover-class="press" @tap="ask(item)">
        <view class="coupon__art">¥{{ item.face }}</view>
        <view class="coupon__main">
          <view class="coupon__name">{{ item.name }}</view>
          <view class="coupon__meta">{{ item.rule }} · {{ item.cost }} 积分</view>
        </view>
      </view>
      <view :style="{ height: windowed.padBottom + 'px' }" />
      <view v-if="loadingMore || exchanging" class="more">{{ exchanging ? '正在兑换…' : '正在加载…' }}</view>
      <view v-else-if="list.length && list.length >= total" class="more">没有更多了</view>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 12rpx 32rpx 220rpx; box-sizing: border-box; }
.title { font-size: 64rpx; font-weight: 800; line-height: 1.05; }
.group { margin: 8rpx 0 20rpx; color: #94a3b8; font-size: 32rpx; }
.list { margin-top: 8rpx; }
.coupon { display: flex; align-items: center; gap: 20rpx; background: #fff; border-radius: 32rpx; padding: 28rpx; margin-bottom: 20rpx; box-shadow: 0 12rpx 30rpx rgba(15, 23, 42, 0.05); }
.coupon__art { width: 120rpx; height: 120rpx; border-radius: 36rpx; background: linear-gradient(160deg, #38bdf8, #6366f1); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 32rpx; font-weight: 800; }
.coupon__main { flex: 1; }
.coupon__name { font-weight: 700; font-size: 30rpx; }
.coupon__meta { margin-top: 8rpx; color: #94a3b8; font-size: 24rpx; }
.empty, .more { text-align: center; color: #64748b; padding: 20rpx 0; }
.fail { color: #b91c1c; font-weight: 700; }
.skel { height: 160rpx; background: #e2e8f0; border-radius: 16rpx; }
</style>
