<script setup lang="ts">
import { watch } from 'vue';
import { onLoad, onPullDownRefresh, onReachBottom, onShareAppMessage, onShow } from '@dcloudio/uni-app';
import { storeToRefs } from 'pinia';
import AppTabBar from '@/components/AppTabBar.vue';
import MerchantMinePanel from '@/components/panels/MerchantMinePanel.vue';
import VerifyPanel from '@/components/panels/VerifyPanel.vue';
import WorkbenchPanel from '@/components/panels/WorkbenchPanel.vue';
import { useDeskStore } from '@/stores/desk';
import { applySharePath, enableShareMenu, merchantInviteCode } from '@/utils/share';

const desk = useDeskStore();
const { merchant } = storeToRefs(desk);
const titles: Record<string, string> = {
  workbench: '工作台',
  verify: '核销',
  notification: '通知',
  profile: '我的',
};

onLoad((query) => {
  const tab = String(query?.tab || '');
  if (tab) desk.merchant = tab;
});

function titleOf(key: string) {
  uni.setNavigationBarTitle({ title: titles[key] || '工作台' });
}

watch(merchant, titleOf, { immediate: true });

onShow(() => enableShareMenu());
onPullDownRefresh(() => {
  desk.pull += 1;
  if (desk.merchant === 'notification' || desk.merchant === 'profile') uni.stopPullDownRefresh();
});
onReachBottom(() => { desk.reach += 1; });

onShareAppMessage(() => ({
  title: '邀请你入驻商盟',
  path: applySharePath(merchantInviteCode(Number(uni.getStorageSync('mini_merchant_id') || 0))),
}));
</script>

<template>
  <view class="desk">
    <workbench-panel v-show="merchant === 'workbench'" :active="merchant === 'workbench'" />
    <verify-panel v-show="merchant === 'verify'" :active="merchant === 'verify'" />
    <view v-show="merchant === 'notification'" class="note">
      <view class="note__title">通知</view>
      <view class="note__hint">商家通知列表，阶段一仅保留页面。</view>
    </view>
    <merchant-mine-panel v-show="merchant === 'profile'" :active="merchant === 'profile'" />
    <app-tab-bar :active="merchant" />
  </view>
</template>

<style scoped>
.desk { min-height: 100vh; background: #e7eef8; }
.note { min-height: 100vh; padding: 48rpx 32rpx 220rpx; box-sizing: border-box; }
.note__title { font-size: 64rpx; font-weight: 800; }
.note__hint { margin-top: 16rpx; color: #64748b; line-height: 1.6; }
</style>
