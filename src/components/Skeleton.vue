<script setup lang="ts">
withDefaults(defineProps<{
  /** wallet=卡包卡片，mall=商城券卡片 */
  type?: 'wallet' | 'mall';
  count?: number;
}>(), {
  type: 'wallet',
  count: 4,
});
</script>

<template>
  <view class="sk" :class="'sk--' + type" aria-hidden="true">
    <view v-for="n in count" :key="n" class="sk__card">
      <view class="sk__face" />
      <view class="sk__main">
        <view class="sk__line" />
        <view class="sk__line sk__line--short" />
        <view v-if="type === 'mall'" class="sk__line sk__line--tiny" />
      </view>
    </view>
  </view>
</template>

<style scoped>
.sk__card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  background: #fff;
  border-radius: 32rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 12rpx 30rpx rgba(15, 23, 42, 0.05);
  min-height: 140rpx;
}
.sk__face {
  width: 120rpx;
  height: 120rpx;
  border-radius: 36rpx;
  flex-shrink: 0;
  background: #e2e8f0;
  animation: pulse 1.2s ease-in-out infinite;
}
.sk__main { flex: 1; }
.sk__line {
  height: 28rpx;
  width: 68%;
  border-radius: 10rpx;
  background: #e2e8f0;
  animation: pulse 1.2s ease-in-out infinite;
}
.sk__line--short {
  width: 42%;
  margin-top: 16rpx;
  height: 22rpx;
  animation-delay: 0.15s;
}
.sk__line--tiny {
  width: 28%;
  margin-top: 14rpx;
  height: 18rpx;
  animation-delay: 0.28s;
}
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.42; }
}
</style>
