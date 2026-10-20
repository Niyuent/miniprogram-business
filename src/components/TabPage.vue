<script setup lang="ts">
import { onShow } from '@dcloudio/uni-app';
import { useSessionStore } from '@/stores/session';
import AppTabBar from '@/components/AppTabBar.vue';

defineProps<{
  title: string;
  active: string;
  hint?: string;
}>();

const session = useSessionStore();
onShow(() => session.hydrate());
</script>

<template>
  <view class="shell">
    <view class="shell__title">{{ title }}</view>
    <view class="shell__hint">{{ hint || '阶段一骨架页，业务接口后续接入。' }}</view>
    <view v-if="session.profileName" class="shell__who">{{ session.profileName }}</view>
    <app-tab-bar :active="active" />
  </view>
</template>

<style scoped>
.shell {
  min-height: 100vh;
  padding: 48rpx 32rpx 180rpx;
  box-sizing: border-box;
}
.shell__title {
  font-size: 44rpx;
  font-weight: 700;
}
.shell__hint {
  margin-top: 16rpx;
  color: #64748b;
  line-height: 1.6;
}
.shell__who {
  margin-top: 24rpx;
  color: #334155;
  font-size: 26rpx;
}
</style>
