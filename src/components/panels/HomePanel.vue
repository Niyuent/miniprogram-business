<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSessionStore } from '@/stores/session';
import { fetchCouponTemplates, fetchMe, fetchPointAccount, type CouponTemplate } from '@/services/member';
import { friendlyMessage } from '@/utils/errors';
import { useDeskStore } from '@/stores/desk';
import { useMallStore } from '@/stores/mall';
import { useWalletStore } from '@/stores/wallet';
import { enableShareMenu, rememberMember } from '@/utils/share';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const errorText = ref('');
const balance = ref(0);
const expiring = ref(0);
type HomeCoupon = { id: number; name: string; face: number; cost: number; stock: number };
const coupons = ref<HomeCoupon[]>([]);

async function load(silent = false) {
  if (!silent) loading.value = true;
  errorText.value = '';
  try {
    const [account, templates, me] = await Promise.all([
      fetchPointAccount(),
      fetchCouponTemplates(1, 6),
      fetchMe().catch(() => null),
    ]);
    if (me) rememberMember(me.id);
    balance.value = account.summary?.available ?? account.account.balance;
    expiring.value = account.summary?.expiringSoon ?? 0;
    coupons.value = (templates.list || []).map((row: CouponTemplate) => ({
      id: row.id,
      name: row.name,
      face: row.faceValue,
      cost: row.pointsCost,
      stock: row.remainingStock,
    }));
    // 首页就绪后预取卡包 + 商城，进页 0.1s 内有内容
    useWalletStore().warm('UNUSED').catch(() => undefined);
    useMallStore().warm().catch(() => undefined);
  } catch (error) {
    errorText.value = friendlyMessage(error, '首页数据没有加载出来');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function go(url: string) {
  const desk = useDeskStore();
  if (url.includes('/wallet/')) {
    useWalletStore().warm('UNUSED').catch(() => undefined);
    desk.member = 'wallet';
    return;
  }
  if (url.includes('/mall/')) {
    useMallStore().warm().catch(() => undefined);
    desk.member = 'mall';
    return;
  }
  uni.navigateTo({ url });
}

function openMall() {
  useMallStore().warm().catch(() => undefined);
  useDeskStore().member = 'mall';
}

const desk = useDeskStore();
watch(() => desk.pull, () => { if (props.active) load(true); });

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    enableShareMenu();
    load();
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <view class="glow" />
    <view v-if="loading" class="skel">
      <view class="skel__hero" />
      <view class="skel__row" />
      <view class="skel__row" />
    </view>
    <template v-else>
      <view v-if="errorText" class="fail">{{ errorText }}</view>
      <view class="kicker">当前积分余额</view>
      <view class="headline">积分</view>
      <view class="headline headline--soft">余额</view>
      <view class="balance">{{ balance }}</view>
      <view class="sub">本月即将过期 {{ expiring }} 分</view>
      <view class="pills">
        <view class="pill is-on" hover-class="press" @tap="go('/pages/member/points/index')">积分明细</view>
        <view class="pill" hover-class="press" @tap="go('/pages/member/wallet/index')">我的卡包</view>
        <view class="pill" hover-class="press" @tap="go('/pages/member/galaxy/index')">附近星系</view>
        <button class="pill" hover-class="press" open-type="share">分享</button>
      </view>
      <view class="sheet">
        <view class="sheet__bar" />
        <view class="sheet__head">
          <text>推荐好券</text>
          <text class="link" @tap="openMall">查看全部</text>
        </view>
        <view v-if="!coupons.length" class="empty">暂时没有可兑换的券</view>
        <view v-for="item in coupons" :key="item.id" class="coupon" hover-class="press" @tap="openMall">
          <view class="coupon__top">
            <view class="mark">¥{{ item.face }}</view>
            <view class="coupon__name">{{ item.name }}</view>
            <view class="go">↗</view>
          </view>
          <view class="coupon__meta">
            <view>
              <view class="meta__label">所需积分</view>
              <view class="meta__value">{{ item.cost }}</view>
            </view>
            <view>
              <view class="meta__label">剩余</view>
              <view class="meta__value">{{ item.stock }}</view>
            </view>
          </view>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 12rpx 32rpx 220rpx; box-sizing: border-box; position: relative; }
.glow {
  position: absolute; left: -80rpx; top: -40rpx; width: 420rpx; height: 420rpx; border-radius: 50%;
  background: radial-gradient(circle, rgba(56, 189, 248, 0.45), rgba(45, 212, 191, 0.05) 70%);
  pointer-events: none;
}
.kicker { position: relative; color: #64748b; font-size: 24rpx; }
.headline { position: relative; font-size: 72rpx; font-weight: 800; line-height: 1.05; letter-spacing: -1rpx; }
.headline--soft { color: #94a3b8; font-weight: 700; }
.balance { position: relative; margin-top: 28rpx; font-size: 88rpx; font-weight: 800; letter-spacing: -2rpx; }
.sub { position: relative; margin-top: 8rpx; color: #64748b; }
.pills { position: relative; display: flex; gap: 16rpx; margin-top: 32rpx; }
.pill {
  margin: 0; padding: 16rpx 28rpx; border-radius: 999rpx; background: rgba(255,255,255,.72);
  border: 1px solid rgba(255,255,255,.9); color: #334155; font-size: 26rpx; line-height: 1.4;
}
.pill.is-on { background: #0b1220; color: #fff; border-color: #0b1220; }
.pill::after { border: none; }
.sheet {
  position: relative; margin-top: 36rpx; background: rgba(255,255,255,.86);
  border-radius: 40rpx; padding: 20rpx 24rpx 8rpx;
  box-shadow: 0 24rpx 60rpx rgba(15, 23, 42, 0.06);
}
.sheet__bar { width: 72rpx; height: 8rpx; border-radius: 999rpx; background: #e2e8f0; margin: 8rpx auto 16rpx; }
.sheet__head { display: flex; justify-content: space-between; align-items: center; font-size: 32rpx; font-weight: 700; margin-bottom: 12rpx; }
.link { color: #0284c7; font-size: 26rpx; font-weight: 600; }
.coupon { background: #fff; border-radius: 32rpx; padding: 28rpx; margin-bottom: 20rpx; box-shadow: 0 12rpx 30rpx rgba(15, 23, 42, 0.05); }
.coupon__top { display: flex; align-items: center; gap: 16rpx; }
.mark {
  width: 84rpx; height: 84rpx; border-radius: 28rpx; color: #fff; font-weight: 800; font-size: 26rpx;
  display: flex; align-items: center; justify-content: center;
  background: linear-gradient(160deg, #38bdf8, #14b8a6);
}
.coupon__name { flex: 1; font-weight: 700; font-size: 30rpx; }
.go { width: 64rpx; height: 64rpx; border-radius: 50%; background: #f1f5f9; text-align: center; line-height: 64rpx; }
.coupon__meta { display: flex; gap: 48rpx; margin-top: 24rpx; }
.meta__label { color: #94a3b8; font-size: 22rpx; }
.meta__value { margin-top: 4rpx; font-weight: 700; }
.empty, .fail { margin: 20rpx 0; color: #64748b; }
.fail { color: #b91c1c; font-weight: 700; }
.skel__hero, .skel__row { background: rgba(255,255,255,.7); border-radius: 32rpx; }
.skel__hero { height: 280rpx; }
.skel__row { height: 180rpx; margin-top: 20rpx; }
</style>
