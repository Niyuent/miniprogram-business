<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import GalaxyStage from '@/components/GalaxyStage.vue';
import NetworkBanner from '@/components/NetworkBanner.vue';
import SlideSheet from '@/components/SlideSheet.vue';
import {
  fetchMemberAlliances,
  fetchPublicGalaxy,
  yuan,
  type AllianceGroup,
  type AllianceMerchant,
  type GalaxyChart,
  type GalaxyPlanet,
} from '@/services/galaxy';
import { useDeskStore } from '@/stores/desk';
import { friendlyMessage } from '@/utils/errors';

const alliances = ref<AllianceGroup[]>([]);
const currentAllianceId = ref(0);
const chart = ref<GalaxyChart | null>(null);
const loading = ref(true);
const errorText = ref('');
const sheetOpen = ref(false);
const target = ref<GalaxyPlanet | null>(null);
const pickMerchant = ref<AllianceMerchant | null>(null);

const current = computed(() =>
  alliances.value.find((item) => item.id === currentAllianceId.value) || alliances.value[0] || null,
);

const summary = computed(() => {
  const totalAlliances = alliances.value.length;
  const totalShops = alliances.value.reduce((sum, a) => sum + a.merchantCount, 0);
  return { totalAlliances, totalShops };
});

onLoad(() => {
  loadAlliances();
});

onPullDownRefresh(() => {
  loadAlliances();
});

async function loadAlliances() {
  loading.value = true;
  errorText.value = '';
  try {
    const data = await fetchMemberAlliances();
    alliances.value = data.alliances || [];
    if (!alliances.value.length) {
      chart.value = null;
      loading.value = false;
      return;
    }
    const keep = alliances.value.find((a) => a.id === currentAllianceId.value);
    const next = keep || alliances.value[0];
    await openAlliance(next.id);
  } catch (error) {
    errorText.value = friendlyMessage(error, '联盟商家没有加载出来');
    loading.value = false;
  } finally {
    uni.stopPullDownRefresh();
  }
}

async function openAlliance(allianceId: number) {
  currentAllianceId.value = allianceId;
  loading.value = !chart.value;
  errorText.value = '';
  try {
    chart.value = await fetchPublicGalaxy(allianceId);
    const focus =
      chart.value.planets.find((item) => item.id === chart.value?.focusId) || chart.value.planets[0];
    target.value = focus || null;
    pickMerchant.value = current.value?.merchants.find((m) => m.id === focus?.id) || current.value?.merchants[0] || null;
  } catch (error) {
    errorText.value = friendlyMessage(error, '联盟星系没有打开');
  } finally {
    loading.value = false;
  }
}

function onPickMerchant(row: AllianceMerchant) {
  pickMerchant.value = row;
  if (chart.value) {
    target.value =
      chart.value.planets.find((item) => item.id === row.id) ||
      (row.role === 'MAIN'
        ? {
            id: row.id,
            name: row.name,
            status: 'APPROVED',
            monthAmount: chart.value.center.monthAmount,
            orderCount: chart.value.center.monthOrderCount,
            storeId: row.storeId,
            storeName: row.storeName,
            address: row.address,
            hours: row.hours,
          }
        : null);
  }
  sheetOpen.value = true;
}

function pick(id: number, role: 'center' | 'planet') {
  if (!chart.value || !current.value) return;
  if (role === 'center') {
    pickMerchant.value = current.value.merchants.find((m) => m.role === 'MAIN') || null;
    target.value = {
      id: chart.value.center.id,
      name: chart.value.center.name,
      status: 'APPROVED',
      monthAmount: chart.value.center.monthAmount,
      orderCount: chart.value.center.monthOrderCount,
      storeName: pickMerchant.value?.storeName,
      address: pickMerchant.value?.address,
      hours: pickMerchant.value?.hours,
    };
    sheetOpen.value = true;
    return;
  }
  const row = current.value.merchants.find((m) => m.id === id) || null;
  pickMerchant.value = row;
  target.value = chart.value.planets.find((item) => item.id === id) || null;
  sheetOpen.value = true;
}

function consume() {
  sheetOpen.value = false;
  useDeskStore().member = 'home';
  uni.navigateBack({
    fail: () => uni.reLaunch({ url: '/pages/member/home/index' }),
  });
}

function roleLabel(role: string) {
  return role === 'MAIN' ? '主体' : '联盟店';
}
</script>

<template>
  <view class="page">
    <network-banner />
    <view class="head">
      <text class="title">周围商家联盟</text>
      <text class="sub">
        共 {{ summary.totalAlliances }} 个联盟 · {{ summary.totalShops }} 家店，到店出示会员码即可积分
      </text>
    </view>

    <scroll-view v-if="alliances.length" scroll-x class="chips" :show-scrollbar="false">
      <view
        v-for="item in alliances"
        :key="item.id"
        class="chip"
        :class="{ 'is-on': item.id === currentAllianceId }"
        hover-class="press"
        @tap="openAlliance(item.id)"
      >
        <text>{{ item.name }} · {{ item.merchantCount }} 家</text>
      </view>
    </scroll-view>

    <view v-if="loading && !alliances.length" class="wait">正在加载联盟…</view>
    <view v-else-if="errorText && !alliances.length" class="wait">{{ errorText }}</view>
    <view v-else-if="!alliances.length" class="wait">暂时还没有可展示的商家联盟</view>

    <template v-else-if="current">
      <view class="alliance-card">
        <view class="alliance-card__top">
          <text class="alliance-card__name">{{ current.name }}</text>
          <text class="alliance-card__count">{{ current.merchantCount }} 家</text>
        </view>
        <text v-if="current.city" class="alliance-card__city">{{ current.city }}</text>
        <text class="alliance-card__hint">本联盟商家如下，点一家可看地址并去消费</text>

        <view
          v-for="shop in current.merchants"
          :key="shop.id"
          class="shop"
          hover-class="press"
          @tap="onPickMerchant(shop)"
        >
          <view class="shop__ico">{{ shop.role === 'MAIN' ? '主' : '店' }}</view>
          <view class="shop__main">
            <view class="shop__row">
              <text class="shop__name">{{ shop.name }}</text>
              <text class="shop__tag">{{ roleLabel(shop.role) }}</text>
            </view>
            <text class="shop__addr">{{ shop.address || shop.storeName || '地址待完善' }}</text>
            <text v-if="shop.hours" class="shop__hours">营业 {{ shop.hours }}</text>
          </view>
          <text class="shop__go">详情</text>
        </view>
      </view>

      <text class="section">联盟星系</text>
      <view v-if="loading && !chart" class="wait wait--sm">星系展开中…</view>
      <galaxy-stage v-else-if="chart" :chart="chart" :focus-id="target?.id || pickMerchant?.id" @pick="pick" />
      <view v-if="errorText && chart" class="banner">{{ errorText }}</view>
    </template>

    <slide-sheet :visible="sheetOpen" @close="sheetOpen = false">
      <view class="sheet__title">{{ pickMerchant?.name || target?.storeName || target?.name || current?.name }}</view>
      <view class="sheet__hint">{{ pickMerchant?.address || target?.address || '到店后向店员出示会员码' }}</view>
      <view v-if="pickMerchant?.hours || target?.hours" class="sheet__hint">
        营业 {{ pickMerchant?.hours || target?.hours }}
      </view>
      <view v-if="target" class="sheet__hint">本月消费额 {{ yuan(target.monthAmount || 0) }}</view>
      <button class="go" hover-class="press" @tap="consume">出示会员码</button>
    </slide-sheet>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; background: #f3f7f8; padding-bottom: 64rpx; box-sizing: border-box; }
.head {
  padding: 28rpx 32rpx 20rpx;
  background: linear-gradient(135deg, #09303a 0%, #0b2440 100%);
  border-radius: 0 0 40rpx 40rpx;
  color: #fff;
}
.title { display: block; font-size: 40rpx; font-weight: 800; color: #fff; }
.sub { display: block; margin-top: 10rpx; color: rgba(255,255,255,.85); font-size: 24rpx; line-height: 1.5; }
.chips { white-space: nowrap; padding: 20rpx 24rpx 8rpx; }
.chip {
  display: inline-block;
  margin-right: 16rpx;
  padding: 14rpx 22rpx;
  border-radius: 999rpx;
  background: #fff;
  color: #556670;
  font-size: 24rpx;
  border: 1px solid #eaf0f2;
}
.chip.is-on {
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  font-weight: 700;
  border-color: transparent;
}
.wait { padding: 120rpx 32rpx; text-align: center; color: #8a9aa3; }
.wait--sm { padding: 48rpx 32rpx; }
.alliance-card {
  margin: 8rpx 32rpx 0;
  padding: 28rpx 28rpx 12rpx;
  background: #fff;
  border-radius: 32rpx;
  box-shadow: 0 12rpx 36rpx rgba(10, 60, 58, 0.06);
}
.alliance-card__top { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.alliance-card__name { font-size: 32rpx; font-weight: 800; color: #0e1f26; }
.alliance-card__count {
  padding: 6rpx 14rpx; border-radius: 999rpx; background: #e8fbf7; color: #00766a;
  font-size: 22rpx; font-weight: 700; flex-shrink: 0;
}
.alliance-card__city { display: block; margin-top: 8rpx; color: #8a9aa3; font-size: 22rpx; }
.alliance-card__hint { display: block; margin: 12rpx 0 8rpx; color: #556670; font-size: 24rpx; }
.shop {
  display: flex; align-items: center; gap: 16rpx;
  padding: 22rpx 0; border-top: 1px solid #eaf0f2;
}
.shop__ico {
  width: 68rpx; height: 68rpx; border-radius: 20rpx; background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 24rpx; flex-shrink: 0;
}
.shop__main { flex: 1; min-width: 0; }
.shop__row { display: flex; align-items: center; gap: 12rpx; }
.shop__name { font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.shop__tag {
  padding: 2rpx 10rpx; border-radius: 999rpx; background: #f1f5f7; color: #556670;
  font-size: 20rpx; font-weight: 600;
}
.shop__addr, .shop__hours {
  display: block; margin-top: 6rpx; font-size: 22rpx; color: #8a9aa3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.shop__go { color: #009784; font-weight: 700; font-size: 24rpx; flex-shrink: 0; }
.section {
  display: block; margin: 28rpx 32rpx 12rpx; font-size: 28rpx; font-weight: 800; color: #0e1f26;
}
.banner { margin: 16rpx 32rpx; color: #c22a2e; font-size: 24rpx; }
.go {
  margin-top: 24rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  border-radius: 999rpx;
  font-weight: 800;
  border: none;
}
.sheet__title { font-size: 36rpx; font-weight: 800; color: #0e1f26; }
.sheet__hint { margin-top: 12rpx; color: #64748b; line-height: 1.6; }
</style>
