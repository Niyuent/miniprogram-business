<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import AppTabBar from '@/components/AppTabBar.vue';
import NetworkBanner from '@/components/NetworkBanner.vue';
import SlideSheet from '@/components/SlideSheet.vue';
import {
  exchangeAtShop,
  fetchNearbyShops,
  fetchShopCoupons,
  type NearbyShop,
  type ShopCoupon,
  type ShopExchangeView,
} from '@/services/shops';
import { friendlyMessage } from '@/utils/errors';
import { HttpError } from '@/utils/request';
import { useWalletStore } from '@/stores/wallet';

type Coords = { longitude: number; latitude: number };

const shops = ref<NearbyShop[]>([]);
const located = ref(false);
const loading = ref(true);
const errorText = ref('');
const locationHint = ref('正在定位…');

const sheetOpen = ref(false);
const picked = ref<NearbyShop | null>(null);
const view = ref<ShopExchangeView | null>(null);
const couponsLoading = ref(false);
const exchanging = ref(0);

let lastCoords: Coords | null = null;

const totalShops = computed(() => shops.value.length);

onLoad((query) => {
  // 从某家商家的「去兑换」进来时带着 merchantId：直接打开那家店的兑换区，
  // 绝不能先落到一个「总积分商城」或者让用户再从列表里找一次。
  const directId = Number(query?.merchantId ?? 0);
  if (directId > 0) openShopById(directId);
  // 直达时跳过定位，避免弹层被 6 秒定位等待卡住；列表在后台补上。
  loadAll(directId > 0);
});
onPullDownRefresh(() => {
  loadAll();
});

/** 定位失败也不挡列表：6 秒兜底后退化为「按可用积分排序」 */
function locate(): Promise<Coords | null> {
  return new Promise((resolve) => {
    let settled = false;
    let timer = 0;
    const done = (value: Coords | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    timer = setTimeout(() => done(null), 6000) as unknown as number;
    try {
      uni.getLocation({
        type: 'gcj02',
        success: (res) => done({ longitude: Number(res.longitude), latitude: Number(res.latitude) }),
        fail: () => done(null),
      });
    } catch {
      done(null);
    }
  });
}

async function loadAll(skipLocate = false) {
  loading.value = true;
  errorText.value = '';
  try {
    lastCoords = skipLocate ? null : await locate();
    const data = await fetchNearbyShops(lastCoords?.longitude, lastCoords?.latitude);
    shops.value = data.list || [];
    located.value = !!data.located;
    locationHint.value = data.located
      ? '已按距离由近到远排列'
      : '未开启定位，先按你攒过积分的店排列';
  } catch (error) {
    errorText.value = friendlyMessage(error, '附近商家没有加载出来');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

/** 兑换成功后只刷新列表里的可用积分，不再重新弹定位 */
async function refreshShops() {
  try {
    const data = await fetchNearbyShops(lastCoords?.longitude, lastCoords?.latitude);
    shops.value = data.list || [];
  } catch {
    /* 列表刷新失败不打断兑换成功提示 */
  }
}

async function relocate() {
  uni.showLoading({ title: '定位中' });
  try {
    await loadAll();
  } finally {
    uni.hideLoading();
  }
}

/**
 * 带 merchantId 直达：一次请求同时拿到这家店的名字、可用积分和专属券清单。
 * 即使这家店不在「附近商家」列表里（没坐标 / 没加入联盟 / 已退出），也能准确落在同一家店。
 */
async function openShopById(merchantId: number) {
  couponsLoading.value = true;
  try {
    const data = await fetchShopCoupons(merchantId);
    const known = shops.value.find((shop) => shop.merchantId === merchantId);
    picked.value = known ?? {
      merchantId,
      name: data.merchant?.name || '这家店',
      address: data.merchant?.address || '',
      hours: data.merchant?.hours || '',
      storeId: null,
      storeName: '',
      distanceMeters: null,
      distanceText: '',
      availablePoints: data.availablePoints,
      earnedPoints: 0,
    };
    view.value = data;
    sheetOpen.value = true;
  } catch (error) {
    uni.showToast({ title: friendlyMessage(error, '这家店的兑换区没打开'), icon: 'none' });
  } finally {
    couponsLoading.value = false;
  }
}

async function onPickShop(shop: NearbyShop) {
  picked.value = shop;
  view.value = null;
  sheetOpen.value = true;
  await loadCoupons(shop.merchantId);
}

async function loadCoupons(merchantId: number) {
  couponsLoading.value = true;
  try {
    view.value = await fetchShopCoupons(merchantId);
  } catch (error) {
    view.value = null;
    uni.showToast({ title: friendlyMessage(error, '兑换区没加载出来'), icon: 'none' });
  } finally {
    couponsLoading.value = false;
  }
}

function buttonText(item: ShopCoupon) {
  if (exchanging.value === item.id) return '兑换中';
  if (item.limitReached) return '已兑满';
  if (!item.affordable) return '积分不够';
  return '兑换';
}

function shopError(error: unknown) {
  if (error instanceof HttpError) {
    const map: Record<string, string> = {
      BALANCE_NOT_ENOUGH: '在这家店攒的积分还不够，换不了这张券',
      PER_USER_LIMIT_EXCEEDED: '这张券已达到每人限兑张数',
      STOCK_EXHAUSTED: '这张券已经被领完了',
      TEMPLATE_NOT_AVAILABLE: '这张券已下架，换一家店看看吧',
      TEMPLATE_NOT_EXCHANGEABLE: '这张券现在不能用积分换',
    };
    if (error.reasonCode && map[error.reasonCode]) return map[error.reasonCode];
  }
  return friendlyMessage(error, '兑换没成功，请稍后再试');
}

async function ask(item: ShopCoupon) {
  const shop = picked.value;
  if (!shop || exchanging.value) return;
  if (item.limitReached) {
    uni.showToast({ title: `这张券每人限兑 ${item.perUserLimit} 张`, icon: 'none' });
    return;
  }
  if (!item.affordable) {
    const missing = Math.max(0, item.pointsCost - (view.value?.availablePoints ?? 0));
    uni.showToast({ title: `还差 ${missing} 分，在这家店消费就能攒`, icon: 'none' });
    return;
  }
  const confirmed = await new Promise<boolean>((resolve) => {
    uni.showModal({
      title: '确认兑换',
      content: `用「${shop.name}」的 ${item.pointsCost} 积分兑换「${item.name}」？`,
      success: (res) => resolve(!!res.confirm),
      fail: () => resolve(false),
    });
  });
  if (!confirmed) return;

  exchanging.value = item.id;
  try {
    await exchangeAtShop(shop.merchantId, item.id);
    uni.showToast({ title: '兑换成功，已放入卡包', icon: 'success' });
    useWalletStore().warm('UNUSED', true).catch(() => undefined);
    // 服务端权威重拉：余额、限领、库存都以服务端为准
    await loadCoupons(shop.merchantId);
    await refreshShops();
  } catch (error) {
    uni.showToast({ title: shopError(error), icon: 'none', duration: 3200 });
  } finally {
    exchanging.value = 0;
  }
}

function consume() {
  sheetOpen.value = false;
  uni.reLaunch({ url: '/pages/member/home/index' });
}
</script>

<template>
  <view class="pm-page pm-page--plain">
    <network-banner />

    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <text class="pm-hero__title">逛商家</text>
        <view class="pm-bignum hero-num">
          <text class="pm-bignum__v">{{ totalShops }}</text>
          <text class="pm-bignum__u">家附近的店</text>
        </view>
        <text class="pm-hero__cap hero-cap">每家店的积分兑换区都不一样 · 点开一家看看</text>
      </view>
    </view>

    <view class="pm-body">
      <view class="pm-card loc" hover-class="press" @tap="relocate">
        <view class="loc__main">
          <text class="loc__t">{{ located ? '已按距离由近到远' : '开启定位，看看离你最近的店' }}</text>
          <text class="loc__d">{{ locationHint }}</text>
        </view>
        <text class="loc__go">重新定位 ›</text>
      </view>

      <view v-if="loading && !shops.length" class="pm-card">
        <view class="pm-skel" style="height: 240rpx" />
      </view>
      <view v-else-if="errorText && !shops.length" class="pm-card fail">
        <text class="fail__t">{{ errorText }}</text>
      </view>
      <view v-else-if="!shops.length" class="pm-card pm-empty">
        <view class="pm-empty__t">附近暂时还没有可展示的商家</view>
        <view class="pm-empty__d">商家加入后会出现在这里</view>
      </view>

      <view v-else class="pm-card pm-card--flush shops">
        <view
          v-for="shop in shops"
          :key="shop.merchantId"
          class="pm-row"
          hover-class="press"
          @tap="onPickShop(shop)"
        >
          <view class="shop-ico">店</view>
          <view class="pm-row__main">
            <view class="shop-top">
              <text class="shop-name">{{ shop.name }}</text>
              <text v-if="shop.distanceText" class="shop-dist">{{ shop.distanceText }}</text>
            </view>
            <view class="pm-row__d">{{ shop.address }}</view>
            <view class="shop-meta">
              <text v-if="shop.hours" class="shop-hours">营业 {{ shop.hours }}</text>
              <text class="shop-pts">在这家店可用 {{ shop.availablePoints }} 分</text>
            </view>
          </view>
          <text class="pm-row__x">›</text>
        </view>
      </view>

      <view class="foot-hint">在一家店攒的积分，只能在这家店的兑换区换券</view>
    </view>

    <slide-sheet :visible="sheetOpen" @close="sheetOpen = false">
      <view class="sheet__title">{{ picked?.name }}</view>
      <view class="sheet__hint">{{ picked?.address }}</view>
      <view v-if="picked?.hours" class="sheet__hint">营业 {{ picked.hours }}</view>

      <view class="pts-box">
        <view class="pts-box__row">
          <text class="pts-box__label">在这家店可用积分</text>
          <text class="pts-box__v">{{ view?.availablePoints ?? 0 }}</text>
          <text class="pts-box__u">分</text>
        </view>
        <text class="pts-box__hint">只用在这家店攒的分兑换，别家攒的分不算</text>
      </view>

      <view class="ex-head">
        <text class="ex-head__t">积分兑换</text>
        <text class="ex-head__d">{{ view?.list.length ?? 0 }} 张券可换</text>
      </view>

      <scroll-view scroll-y class="ex-scroll">
        <view v-if="couponsLoading" class="ex-empty">正在加载这家店的兑换区…</view>
        <view v-else-if="!view?.list.length" class="ex-empty">
          <text>这家店暂时没有可兑换的券</text>
          <text class="ex-empty__d">换一家店看看，每家店的兑换区都不一样</text>
        </view>
        <view v-for="item in view?.list || []" :key="item.id" class="sc-card">
          <view class="sc-card__main">
            <text class="sc-card__name">{{ item.name }}</text>
            <text class="sc-card__sub">
              ¥{{ item.faceValue }} 代金券 · {{ item.scopeText }}
            </text>
            <text class="sc-card__own">{{ item.ownerMerchantName }} 提供</text>
          </view>
          <view class="sc-card__side">
            <text class="sc-card__cost">{{ item.pointsCost }} 分</text>
            <view
              class="sc-card__btn"
              :class="{ 'is-off': !item.affordable || item.limitReached, 'is-busy': exchanging === item.id }"
              hover-class="press"
              @tap="ask(item)"
            >
              {{ buttonText(item) }}
            </view>
          </view>
        </view>
      </scroll-view>

      <button class="go" hover-class="press" @tap="consume">出示会员码</button>
    </slide-sheet>

    <app-tab-bar active="shops" />
  </view>
</template>

<style scoped>
.pm-body { padding-bottom: 180rpx; }
.hero-num { margin-top: 16rpx; }
.hero-cap { display: block; margin-top: 10rpx; }
.foot-hint { margin-top: 24rpx; text-align: center; font-size: 22rpx; color: #9aabb3; }

.loc { display: flex; align-items: center; gap: 16rpx; margin-bottom: 20rpx; }
.loc__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.loc__t { font-size: 26rpx; font-weight: 700; color: #0e1f26; }
.loc__d { margin-top: 6rpx; font-size: 22rpx; color: #8a9aa3; }
.loc__go { flex-shrink: 0; font-size: 24rpx; color: #00766a; font-weight: 600; }

.shop-ico {
  width: 72rpx; height: 72rpx; border-radius: 22rpx; flex-shrink: 0;
  background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; font-weight: 800;
}
.shop-top { display: flex; align-items: center; gap: 12rpx; }
.shop-name {
  font-size: 28rpx; font-weight: 600; color: #0e1f26;
  min-width: 0; max-width: 62%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.shop-dist {
  margin-left: auto; flex-shrink: 0; font-size: 22rpx; font-weight: 700; color: #00766a;
  padding: 4rpx 12rpx; border-radius: 999rpx; background: #e8fbf7;
}
.shop-meta { display: flex; align-items: center; gap: 14rpx; margin-top: 8rpx; flex-wrap: wrap; }
.shop-hours { font-size: 20rpx; color: #a8b6bd; }
.shop-pts { font-size: 22rpx; color: #a86a0c; font-weight: 700; }

.sheet__title { font-size: 32rpx; font-weight: 800; color: #0e1f26; }
.sheet__hint { margin-top: 10rpx; font-size: 24rpx; color: #6d818b; line-height: 1.5; }

.pts-box {
  margin-top: 22rpx; padding: 22rpx 24rpx; border-radius: 24rpx;
  background: linear-gradient(135deg, #fff8e9, #fff2d6);
  border: 1rpx solid #ffe3ae;
}
.pts-box__row { display: flex; align-items: baseline; gap: 10rpx; }
.pts-box__label { font-size: 24rpx; color: #7a6a52; margin-right: auto; }
.pts-box__v { font-size: 46rpx; font-weight: 800; color: #a86a0c; }
.pts-box__u { font-size: 24rpx; color: #a86a0c; }
.pts-box__hint { display: block; margin-top: 8rpx; font-size: 20rpx; color: #a08c68; }

.ex-head { display: flex; align-items: baseline; margin: 26rpx 0 14rpx; }
.ex-head__t { font-size: 28rpx; font-weight: 800; color: #0e1f26; flex: 1; }
.ex-head__d { font-size: 22rpx; color: #8a9aa3; }

.ex-scroll { max-height: 46vh; min-height: 120rpx; }
.ex-empty {
  display: flex; flex-direction: column; align-items: center; gap: 10rpx;
  padding: 46rpx 0; font-size: 24rpx; color: #8a9aa3;
}
.ex-empty__d { font-size: 20rpx; color: #a8b6bd; }

.sc-card {
  display: flex; align-items: center; gap: 18rpx;
  padding: 22rpx 0; border-bottom: 1rpx solid #eef3f5;
}
.sc-card__main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.sc-card__name {
  font-size: 27rpx; font-weight: 700; color: #0e1f26;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.sc-card__sub { margin-top: 8rpx; font-size: 22rpx; color: #6d818b; }
.sc-card__own { margin-top: 6rpx; font-size: 20rpx; color: #a8b6bd; }
.sc-card__side { flex-shrink: 0; display: flex; flex-direction: column; align-items: flex-end; gap: 10rpx; }
.sc-card__cost { font-size: 28rpx; font-weight: 800; color: #a86a0c; }
.sc-card__btn {
  padding: 10rpx 26rpx; border-radius: 999rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff; font-size: 23rpx; font-weight: 700;
}
.sc-card__btn.is-off { background: #eef2f4; color: #9aabb3; }
.sc-card__btn.is-busy { opacity: 0.6; }

.go {
  margin-top: 22rpx; height: 92rpx; line-height: 92rpx; flex-shrink: 0;
  border-radius: 999rpx;
  background: #07262f;
  color: #fff; font-size: 28rpx; font-weight: 700;
}
.go::after { border: none; }
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
</style>
