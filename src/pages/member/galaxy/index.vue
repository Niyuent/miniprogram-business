<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import GalaxyStage from '@/components/GalaxyStage.vue';
import SlideSheet from '@/components/SlideSheet.vue';
import {
  fetchMemberPlaces,
  fetchPublicGalaxy,
  yuan,
  type GalaxyChart,
  type GalaxyPlanet,
  type MemberPlace,
} from '@/services/galaxy';
import { useDeskStore } from '@/stores/desk';
import { friendlyMessage } from '@/utils/errors';

const places = ref<MemberPlace[]>([]);
const chart = ref<GalaxyChart | null>(null);
const currentId = ref(0);
const loading = ref(true);
const errorText = ref('');
const sheetOpen = ref(false);
const target = ref<GalaxyPlanet | null>(null);

const chips = computed(() => places.value);

onLoad(() => {
  loadPlaces();
});

async function loadPlaces() {
  loading.value = true;
  errorText.value = '';
  try {
    const data = await fetchMemberPlaces();
    places.value = data.places || [];
    const first = places.value.find((item) => item.visited) || places.value[0];
    if (first) await openPlace(first.merchantId);
    else loading.value = false;
  } catch (error) {
    errorText.value = friendlyMessage(error, '附近商家没有加载出来');
    loading.value = false;
  }
}

async function openPlace(merchantId: number) {
  if (currentId.value === merchantId && chart.value) return;
  currentId.value = merchantId;
  loading.value = !chart.value;
  errorText.value = '';
  try {
    chart.value = await fetchPublicGalaxy(merchantId);
    const focus = chart.value.planets.find((item) => item.id === chart.value?.focusId) || chart.value.planets[0];
    target.value = focus || null;
  } catch (error) {
    errorText.value = friendlyMessage(error, '星系没有打开');
  } finally {
    loading.value = false;
  }
}

function pick(id: number, role: 'center' | 'planet') {
  if (!chart.value) return;
  if (role === 'center') {
    sheetOpen.value = true;
    return;
  }
  target.value = chart.value.planets.find((item) => item.id === id) || null;
  sheetOpen.value = true;
}

function consume() {
  sheetOpen.value = false;
  useDeskStore().member = 'wallet';
  uni.navigateBack();
}
</script>

<template>
  <view class="page">
    <view class="head">
      <view class="title">去过的店，和还能去的店</view>
      <view class="sub">点一颗星球，看清联盟，再出示会员码到店消费</view>
    </view>
    <scroll-view scroll-x class="chips" :show-scrollbar="false">
      <view
        v-for="item in chips"
        :key="item.storeId"
        class="chip"
        :class="{ 'is-on': item.merchantId === currentId }"
        hover-class="press"
        @tap="openPlace(item.merchantId)"
      >
        <text>{{ item.visited ? '去过' : '可到店' }} · {{ item.name }}</text>
      </view>
    </scroll-view>
    <view v-if="loading && !chart" class="wait">星系正在展开</view>
    <view v-else-if="errorText && !chart" class="wait">{{ errorText }}</view>
    <galaxy-stage v-else :chart="chart" :focus-id="target?.id" tall @pick="pick" />
    <view v-if="errorText && chart" class="banner">{{ errorText }}</view>
    <button class="go" hover-class="press" :disabled="!target" @tap="sheetOpen = true">去这家消费</button>

    <slide-sheet :visible="sheetOpen" @close="sheetOpen = false">
      <view class="sheet__title">{{ target?.storeName || target?.name || chart?.center.name }}</view>
      <view class="sheet__hint">{{ target?.address || '到店后向店员出示会员码' }}</view>
      <view v-if="target?.hours" class="sheet__hint">营业 {{ target.hours }}</view>
      <view class="sheet__hint">本月 {{ yuan(target?.monthAmount || chart?.center.monthAmount || 0) }}</view>
      <button class="go go--sheet" hover-class="press" @tap="consume">出示会员码</button>
    </slide-sheet>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; background: #050811; color: #e2e8f0; padding-bottom: 48rpx; }
.head { padding: 28rpx 32rpx 8rpx; }
.title { font-size: 40rpx; font-weight: 800; color: #fff; }
.sub { margin-top: 8rpx; color: #94a3b8; font-size: 24rpx; line-height: 1.5; }
.chips { white-space: nowrap; padding: 20rpx 24rpx 8rpx; }
.chip {
  display: inline-block;
  margin-right: 16rpx;
  padding: 14rpx 22rpx;
  border-radius: 999rpx;
  background: rgba(255,255,255,.08);
  color: #cbd5e1;
  font-size: 24rpx;
}
.chip.is-on { background: #fff; color: #0b1220; font-weight: 700; }
.wait { padding: 120rpx 32rpx; text-align: center; color: #94a3b8; }
.banner { margin: 16rpx 32rpx; color: #fecaca; font-size: 24rpx; }
.go {
  margin: 28rpx 32rpx 0;
  background: #fff;
  color: #0b1220;
  border-radius: 999rpx;
  font-weight: 800;
}
.go--sheet { margin: 24rpx 0 0; background: #0b1220; color: #fff; }
.sheet__title { font-size: 36rpx; font-weight: 800; }
.sheet__hint { margin-top: 12rpx; color: #64748b; line-height: 1.6; }
</style>
