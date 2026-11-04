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
  <view class="pm-page pm-page--plain">
    <network-banner />

    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <text class="pm-hero__title">周围商家联盟</text>
        <view class="pm-bignum hero-num">
          <text class="pm-bignum__v">{{ summary.totalShops }}</text>
          <text class="pm-bignum__u">家门店</text>
        </view>
        <text class="pm-hero__cap hero-cap">
          {{ summary.totalAlliances }} 个联盟 · 到店出示会员码即可积分
        </text>
      </view>
    </view>

    <view class="pm-body">
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

      <view v-if="loading && !alliances.length" class="pm-card">
        <view class="pm-skel" style="height: 200rpx" />
      </view>
      <view v-else-if="errorText && !alliances.length" class="pm-card fail">
        <text class="fail__t">{{ errorText }}</text>
      </view>
      <view v-else-if="!alliances.length" class="pm-card pm-empty">
        <view class="pm-empty__t">暂时还没有可展示的商家联盟</view>
        <view class="pm-empty__d">附近商家加入联盟后会出现在这里</view>
      </view>

      <template v-else-if="current">
        <view class="pm-card current">
          <view class="current__top">
            <text class="current__name">{{ current.name }}</text>
            <text class="pm-pill pm-pill--teal">{{ current.merchantCount }} 家</text>
          </view>
          <text v-if="current.city" class="current__city">{{ current.city }}</text>
          <text class="current__hint">本联盟商家如下，点一家可看地址并去消费</text>
        </view>

        <view class="pm-card pm-card--flush shops">
          <view
            v-for="shop in current.merchants"
            :key="shop.id"
            class="pm-row"
            hover-class="press"
            @tap="onPickMerchant(shop)"
          >
            <view class="shop-ico" :class="shop.role === 'MAIN' ? 'shop-ico--main' : ''">
              {{ shop.role === 'MAIN' ? '主' : '店' }}
            </view>
            <view class="pm-row__main">
              <view class="shop-top">
                <text class="shop-name">{{ shop.name }}</text>
                <text class="pm-pill pm-pill--muted">{{ roleLabel(shop.role) }}</text>
              </view>
              <view class="pm-row__d">{{ shop.address || shop.storeName || '地址待完善' }}</view>
              <view v-if="shop.hours" class="shop-hours">营业 {{ shop.hours }}</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
        </view>

        <view class="pm-section">
          <text class="pm-section__t">联盟星系</text>
        </view>
        <view v-if="loading && !chart" class="pm-card">
          <view class="pm-skel" style="height: 420rpx" />
        </view>
        <galaxy-stage v-else-if="chart" :chart="chart" :focus-id="target?.id || pickMerchant?.id" @pick="pick" />
        <view v-if="errorText && chart" class="pm-card fail">
          <text class="fail__t">{{ errorText }}</text>
        </view>
      </template>
    </view>

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
.hero-num { margin-top: 16rpx; }
.hero-cap { display: block; margin-top: 10rpx; }

.chips { white-space: nowrap; width: 100%; margin-bottom: 18rpx; }
.chip {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 14rpx 28rpx; margin-right: 12rpx; border-radius: 999rpx;
  background: #fff; border: 1rpx solid #eaf0f2; color: #6d818b; font-size: 24rpx;
}
.chip.is-on { background: #07262f; border-color: #07262f; color: #fff; font-weight: 700; }

.current__top { display: flex; align-items: center; gap: 16rpx; }
.current__name { flex: 1; min-width: 0; font-size: 32rpx; font-weight: 700; color: #0e1f26; }
.current__city { display: block; margin-top: 8rpx; font-size: 22rpx; color: #8a9aa3; }
.current__hint { display: block; margin-top: 10rpx; font-size: 22rpx; color: #6d818b; line-height: 1.5; }

.shops { margin-top: 20rpx; }
.shop-ico {
  width: 72rpx; height: 72rpx; border-radius: 22rpx; flex-shrink: 0;
  background: #eaf2ff; color: #1c6dd0;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; font-weight: 800;
}
.shop-ico--main { background: #e8fbf7; color: #00766a; }
.shop-top { display: flex; align-items: center; gap: 12rpx; }
.shop-name { font-size: 28rpx; font-weight: 600; color: #0e1f26; }
.shop-hours { margin-top: 6rpx; font-size: 20rpx; color: #a8b6bd; }

.sheet__title { font-size: 32rpx; font-weight: 800; color: #0e1f26; }
.sheet__hint { margin-top: 14rpx; font-size: 24rpx; color: #6d818b; line-height: 1.6; }
.go {
  margin-top: 28rpx; height: 92rpx; line-height: 92rpx;
  border-radius: 999rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff; font-size: 28rpx; font-weight: 700;
}
.go::after { border: none; }
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
</style>
