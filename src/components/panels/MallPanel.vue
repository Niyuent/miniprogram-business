<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import Skeleton from '@/components/Skeleton.vue';
import { useSessionStore } from '@/stores/session';
import { exchangeCoupon, fetchMe } from '@/services/member';
import { useMallStore, type MallRow } from '@/stores/mall';
import { useWalletStore } from '@/stores/wallet';
import { friendlyMessage } from '@/utils/errors';
import { HttpError } from '@/utils/request';
import { rememberMember } from '@/utils/share';
import { useDeskStore } from '@/stores/desk';
import { grantSubscribe } from '@/utils/subscribe';
import SuccessBurst from '@/components/SuccessBurst.vue';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const mall = useMallStore();
const desk = useDeskStore();

const list = ref<MallRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const loadingMore = ref(false);
const errorText = ref('');
const userId = ref(0);
const exchanging = ref(false);
const burst = ref(false);
let afterBurst: (() => void) | null = null;

const showSkeleton = computed(() => loading.value && !list.value.length && !mall.ready);

function hydrate() {
  list.value = mall.rows.slice();
  total.value = mall.total;
  page.value = mall.page;
  return mall.ready;
}

async function load(reset: boolean, force = false) {
  errorText.value = '';
  if (reset) {
    const had = hydrate();
    loading.value = !had && list.value.length === 0;
  } else {
    if (list.value.length >= 50) return;
    loadingMore.value = true;
  }
  try {
    if (reset) {
      const me = await fetchMe().catch(() => null);
      if (me) {
        userId.value = me.id;
        rememberMember(me.id);
      }
      await mall.warm(force);
      if (!props.active) return;
      hydrate();
    } else {
      const next = page.value + 1;
      await mall.loadPage(next, { append: true });
      if (!props.active) return;
      hydrate();
    }
  } catch (error) {
    if (!list.value.length) errorText.value = friendlyMessage(error, '券列表没有加载出来');
  } finally {
    loading.value = false;
    loadingMore.value = false;
    uni.stopPullDownRefresh();
  }
}

function more() {
  if (loading.value || loadingMore.value || list.value.length >= total.value) return;
  load(false);
}

function ask(item: MallRow) {
  if (exchanging.value) return;
  uni.showModal({
    title: '确认兑换',
    content: `确认消耗 ${item.cost} 积分兑换此券吗？`,
    success: async (res) => {
      if (!res.confirm || exchanging.value) return;
      exchanging.value = true;
      try {
        await exchangeCoupon({
          userId: userId.value,
          templateId: item.id,
          requestId: `ex${Date.now()}${Math.floor(Math.random() * 1000)}`,
        });
        useWalletStore().warm('UNUSED', true).catch(() => undefined);
        afterBurst = () => {
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
        };
        burst.value = true;
      } catch (error) {
        const text = error instanceof HttpError && error.reasonCode === 'BALANCE_NOT_ENOUGH'
          ? '积分不够哦'
          : friendlyMessage(error, '兑换没有完成');
        uni.showToast({ title: text, icon: 'none' });
      } finally {
        exchanging.value = false;
      }
    },
  });
}

function onBurstDone() {
  burst.value = false;
  const next = afterBurst;
  afterBurst = null;
  next?.();
}

watch(() => desk.pull, () => { if (props.active) load(true, true); });
watch(() => desk.reach, () => { if (props.active) more(); });

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    hydrate();
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
      <skeleton v-if="showSkeleton" type="mall" :count="4" />
      <view v-else-if="errorText && !list.length" class="fail">{{ errorText }}</view>
      <empty-state v-else-if="!list.length" title="暂时没有可兑换的券" hint="上架新券后会出现在这里" />
      <template v-else>
        <view
          v-for="(item, index) in list"
          :key="item.id"
          class="coupon tap-card list-rise"
          :style="{ animationDelay: Math.min(index, 8) * 50 + 'ms' }"
          hover-class="press"
          hover-start-time="20"
          @tap="ask(item)"
        >
          <view class="coupon__art">¥{{ item.face }}</view>
          <view class="coupon__main">
            <text class="coupon__name">{{ item.name }}</text>
            <text class="coupon__meta">{{ item.rule }} · {{ item.cost }} 积分</text>
          </view>
        </view>
        <text v-if="loadingMore || exchanging" class="more">{{ exchanging ? '正在兑换…' : '正在加载…' }}</text>
        <text v-else-if="list.length >= total || list.length >= 50" class="more">没有更多了</text>
      </template>
    </view>
    <success-burst :visible="burst" text="兑换成功" @done="onBurstDone" />
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 12rpx 32rpx 220rpx; box-sizing: border-box; }
.title { font-size: 64rpx; font-weight: 800; line-height: 1.05; }
.group { margin: 8rpx 0 20rpx; color: #94a3b8; font-size: 32rpx; }
.list { margin-top: 8rpx; }
.coupon { display: flex; align-items: center; gap: 20rpx; background: #fff; border-radius: 32rpx; padding: 28rpx; margin-bottom: 20rpx; box-shadow: 0 12rpx 30rpx rgba(15, 23, 42, 0.05); }
.coupon__art {
  width: 120rpx; height: 120rpx; border-radius: 36rpx;
  background: linear-gradient(160deg, #38bdf8, #6366f1); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 32rpx; font-weight: 800;
}
.coupon__main { flex: 1; min-width: 0; }
.coupon__name { display: block; font-weight: 700; font-size: 30rpx; }
.coupon__meta { display: block; margin-top: 8rpx; color: #94a3b8; font-size: 24rpx; }
.more { display: block; text-align: center; color: #64748b; padding: 20rpx 0; }
.fail { color: #b91c1c; font-weight: 700; }
</style>
