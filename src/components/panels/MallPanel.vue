<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSessionStore } from '@/stores/session';
import {
  exchangeCoupon,
  fetchMe,
  fetchPointAccount,
  type AlliancePointAccount,
} from '@/services/member';
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
const balance = ref(0);
const accounts = ref<AlliancePointAccount[]>([]);
const allianceId = ref(0);
const exchanging = ref(false);
const burst = ref(false);
let afterBurst: (() => void) | null = null;

const showSkeleton = computed(() => loading.value && !list.value.length && !mall.ready);
const currentAccount = computed(
  () => accounts.value.find((a) => a.allianceId === allianceId.value) || accounts.value[0],
);
const currentBalance = computed(
  () => currentAccount.value?.available ?? currentAccount.value?.balance ?? balance.value,
);
/** 当前积分真正换得起的件数，比写「共 N 件」有用：一眼知道能换几个。 */
const affordable = computed(() => list.value.filter((item) => currentBalance.value >= item.cost).length);

function hydrate() {
  list.value = mall.rows.slice();
  total.value = mall.total;
  page.value = mall.page;
  if (mall.allianceId) allianceId.value = mall.allianceId;
  return mall.ready;
}

function pickDefaultAlliance(acc: Awaited<ReturnType<typeof fetchPointAccount>>) {
  const listAcc = acc.accounts?.length ? acc.accounts : [];
  accounts.value = listAcc;
  const last = acc.lastEarnAllianceId;
  if (last && listAcc.some((a) => a.allianceId === last)) return last;
  const withBal = listAcc.find((a) => (a.available ?? a.balance) > 0);
  return withBal?.allianceId || listAcc[0]?.allianceId || 1;
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
      const [me, account] = await Promise.all([
        fetchMe().catch(() => null),
        fetchPointAccount().catch(() => null),
      ]);
      if (me) {
        userId.value = me.id;
        rememberMember(me.id);
      }
      if (account) {
        balance.value = account.summary?.totalBalance ?? account.summary?.available ?? account.account.balance;
        allianceId.value = pickDefaultAlliance(account);
      }
      await mall.warm(force, allianceId.value || 1);
      if (!props.active) return;
      hydrate();
    } else {
      const next = page.value + 1;
      await mall.loadPage(next, { append: true, allianceId: allianceId.value || 1 });
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

async function switchAlliance(id: number) {
  if (id === allianceId.value || loading.value) return;
  allianceId.value = id;
  loading.value = true;
  errorText.value = '';
  try {
    await mall.warm(true, id);
    if (!props.active) return;
    hydrate();
  } catch (error) {
    errorText.value = friendlyMessage(error, '券列表没有加载出来');
  } finally {
    loading.value = false;
  }
}

function more() {
  if (loading.value || loadingMore.value || list.value.length >= total.value) return;
  load(false);
}

function goPoints() {
  uni.navigateTo({ url: '/pages/member/points/index' });
}

function ask(item: MallRow) {
  if (exchanging.value) return;
  if (currentBalance.value < item.cost) {
    uni.showToast({ title: '积分不够哦', icon: 'none' });
    return;
  }
  const tip = item.requiresMainPoints ? '\n（需主体积分兑换）' : '';
  uni.showModal({
    title: '确认兑换',
    content: `确认消耗 ${item.cost} 积分兑换此券吗？${tip}`,
    success: async (res) => {
      if (!res.confirm || exchanging.value) return;
      exchanging.value = true;
      try {
        await exchangeCoupon({
          userId: userId.value,
          allianceId: allianceId.value || 1,
          templateId: item.id,
          requestId: `ex${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 32),
        });
        if (currentAccount.value) {
          currentAccount.value.available = Math.max(0, (currentAccount.value.available ?? currentAccount.value.balance) - item.cost);
          currentAccount.value.balance = Math.max(0, currentAccount.value.balance - item.cost);
        }
        balance.value = Math.max(0, balance.value - item.cost);
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
        let text = friendlyMessage(error, '兑换没有完成');
        if (error instanceof HttpError) {
          if (error.reasonCode === 'BALANCE_NOT_ENOUGH') text = '积分不够哦';
          if (error.reasonCode === 'SUB_COUPON_REQUIRES_MAIN_POINTS') text = '需要主体消费获得的积分';
        }
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
  <view class="pm-page">
    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="hero-top">
          <text class="pm-hero__title">积分商城</text>
          <text class="hero-link" @tap="goPoints">积分明细 ›</text>
        </view>
        <view class="pm-bignum hero-num">
          <text class="pm-bignum__v">{{ currentBalance }}</text>
          <text class="pm-bignum__u">可用积分</text>
        </view>
        <text class="pm-hero__cap hero-cap">
          {{ currentAccount?.allianceName || '全部联盟' }} · 现在能换 {{ affordable }} 件
        </text>
      </view>
    </view>

    <view class="pm-body">
      <scroll-view v-if="accounts.length > 1" scroll-x class="chips" :show-scrollbar="false">
        <view
          v-for="item in accounts"
          :key="item.allianceId"
          class="chip"
          :class="{ on: item.allianceId === allianceId }"
          @tap="switchAlliance(item.allianceId)"
        >{{ item.allianceName }}</view>
      </scroll-view>

      <view v-if="showSkeleton" class="goods">
        <view v-for="i in 4" :key="i" class="pm-skel skel-good" />
      </view>
      <view v-else-if="errorText && !list.length" class="pm-card fail">
        <text class="fail__t">{{ errorText }}</text>
      </view>
      <view v-else-if="!list.length" class="pm-card pm-empty">
        <view class="pm-empty__t">暂时没有可兑换的券</view>
        <view class="pm-empty__d">切换联盟看看，或等上架新券</view>
      </view>
      <template v-else>
        <view class="goods">
          <view
            v-for="(item, index) in list"
            :key="item.id"
            class="good tap-card list-rise"
            :class="{ dis: currentBalance < item.cost }"
            :style="{ animationDelay: Math.min(index, 8) * 50 + 'ms' }"
            hover-class="press"
            @tap="ask(item)"
          >
            <view class="pic" :class="index % 2 ? 'pic--blue' : ''">
              <text class="pic__cur">¥</text>
              <text class="pic__val">{{ item.face }}</text>
              <text
                v-if="item.remainingStock > 0 && item.remainingStock <= 10"
                class="stock"
              >仅剩 {{ item.remainingStock }}</text>
            </view>
            <view class="info">
              <text class="nm">{{ item.name }}</text>
              <view class="price">
                <text class="b">{{ item.cost }}</text>
                <text class="muted">积分</text>
              </view>
              <view class="btn">{{ currentBalance < item.cost ? '积分不足' : '一键兑换' }}</view>
              <text v-if="item.requiresMainPoints" class="hint">需主体积分兑换</text>
              <text v-if="item.perUserLimit > 0" class="hint">每人限兑 {{ item.perUserLimit }} 张</text>
            </view>
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
.hero-top { display: flex; align-items: center; justify-content: space-between; }
.hero-link { font-size: 22rpx; color: rgba(255, 255, 255, 0.6); padding: 4rpx 8rpx; }
.hero-num { margin-top: 16rpx; }
.hero-cap { display: block; margin-top: 10rpx; }

.chips { white-space: nowrap; width: 100%; margin-bottom: 18rpx; }
.chip {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 14rpx 30rpx; margin-right: 12rpx; border-radius: 999rpx;
  background: #fff; border: 1rpx solid #eaf0f2; color: #6d818b; font-size: 24rpx;
}
.chip.on { background: #07262f; border-color: #07262f; color: #fff; font-weight: 700; }

.goods { display: flex; flex-wrap: wrap; gap: 20rpx; }
.skel-good { width: calc(50% - 10rpx); height: 400rpx; border-radius: 32rpx; }
.good {
  width: calc(50% - 10rpx); background: #fff; border: 1rpx solid #eaf0f2;
  border-radius: 32rpx; overflow: hidden; box-sizing: border-box;
  box-shadow: 0 8rpx 28rpx rgba(10, 60, 58, 0.05);
}
.good.dis { opacity: 0.66; }
.pic {
  position: relative; height: 168rpx; display: flex; align-items: baseline; justify-content: center;
  padding-top: 52rpx; box-sizing: border-box;
  background: linear-gradient(150deg, #e8fbf7, #d3f3ec); color: #00766a;
}
.pic--blue { background: linear-gradient(150deg, #eaf2ff, #d9e8ff); color: #1c6dd0; }
.pic__cur { font-size: 24rpx; margin-right: 2rpx; }
.pic__val { font-size: 52rpx; font-weight: 800; line-height: 1; letter-spacing: -1rpx; }
.stock {
  position: absolute; right: 14rpx; top: 14rpx;
  padding: 4rpx 14rpx; border-radius: 999rpx;
  background: #f5484d; color: #fff; font-size: 18rpx; font-weight: 700;
}
.info { padding: 20rpx 22rpx 22rpx; }
.nm {
  display: block; font-size: 26rpx; font-weight: 700; color: #0e1f26;
  line-height: 1.35; min-height: 70rpx;
}
.price { margin-top: 8rpx; display: flex; align-items: baseline; gap: 6rpx; }
.b { font-size: 34rpx; font-weight: 800; color: #0e1f26; }
.muted { color: #8a9aa3; font-size: 20rpx; }
.btn {
  margin-top: 16rpx; height: 62rpx; line-height: 62rpx; text-align: center;
  border-radius: 999rpx; background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff; font-size: 24rpx; font-weight: 700;
}
.good.dis .btn { background: #eef2f3; color: #a8b6bd; }
.hint {
  display: block; margin-top: 10rpx; text-align: center;
  color: #b3c0c7; font-size: 18rpx; line-height: 1.3;
}
.more { display: block; text-align: center; color: #8a9aa3; font-size: 22rpx; padding: 24rpx 0; }
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
</style>
