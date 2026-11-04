<script setup lang="ts">
import { watch } from 'vue';
import { onLoad, onPullDownRefresh, onReachBottom, onShareAppMessage, onShow } from '@dcloudio/uni-app';
import { storeToRefs } from 'pinia';
import AppTabBar from '@/components/AppTabBar.vue';
import AiPanel from '@/components/panels/AiPanel.vue';
import MerchantMinePanel from '@/components/panels/MerchantMinePanel.vue';
import VerifyPanel from '@/components/panels/VerifyPanel.vue';
import WorkbenchPanel from '@/components/panels/WorkbenchPanel.vue';
import { useDeskStore } from '@/stores/desk';
import { applySharePath, enableShareMenu, merchantInviteCode } from '@/utils/share';

const desk = useDeskStore();
const { merchant } = storeToRefs(desk);
const titles: Record<string, string> = {
  workbench: '首页',
  ai: 'AI助手',
  verify: '核销',
  profile: '我的',
};

onLoad((query) => {
  const tab = String(query?.tab || '');
  if (tab === 'notification') desk.merchant = 'ai';
  else if (tab) desk.merchant = tab;
});

function titleOf(key: string) {
  uni.setNavigationBarTitle({ title: titles[key] || '首页' });
}

watch(merchant, titleOf, { immediate: true });

onShow(() => enableShareMenu());
onPullDownRefresh(() => {
  desk.pull += 1;
  // 面板 finally 里也会停；这里兜底，避免某页卡住导致下拉转圈不结束
  setTimeout(() => uni.stopPullDownRefresh(), 8000);
});
onReachBottom(() => { desk.reach += 1; });

onShareAppMessage(() => ({
  title: '邀请你一起用小Z经营助手',
  path: applySharePath(merchantInviteCode(Number(uni.getStorageSync('mini_merchant_id') || 0))),
}));
</script>

<template>
  <view class="desk">
    <workbench-panel v-if="merchant === 'workbench'" :active="true" />
    <!-- AI 用 v-if + 稳定 key，避免热更新后新旧 DOM/样式叠在一起；消息仍在 pinia -->
    <view v-if="merchant === 'ai'" class="desk__ai">
      <ai-panel :key="'ai-chat-v3'" :active="true" />
    </view>
    <verify-panel v-if="merchant === 'verify'" :active="true" />
    <merchant-mine-panel v-if="merchant === 'profile'" :active="true" />
    <app-tab-bar :active="merchant" />
  </view>
</template>

<style scoped>
.desk { min-height: 100vh; background: #f3f7f8; }
.desk__ai {
  height: 100vh;
  overflow: hidden;
}
</style>
