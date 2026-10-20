<script setup lang="ts">
withDefaults(defineProps<{ count?: number }>(), { count: 3 });
</script>

<template>
  <view class="sk">
    <view v-for="n in count" :key="n" class="sk__card">
      <view class="sk__face" />
      <view class="sk__main">
        <view class="sk__line" />
        <view class="sk__line sk__line--short" />
      </view>
    </view>
  </view>
</template>

<style scoped>
.sk__card {
  display: flex;
  background: #fff;
  border-radius: 16rpx;
  overflow: hidden;
  margin-bottom: 16rpx;
  min-height: 140rpx;
}
.sk__face {
  width: 170rpx;
  background: #e2e8f0;
  animation: pulse 1.2s ease-in-out infinite;
}
.sk__main { flex: 1; padding: 28rpx 24rpx; }
.sk__line {
  height: 28rpx;
  width: 70%;
  border-radius: 8rpx;
  background: #e2e8f0;
  animation: pulse 1.2s ease-in-out infinite;
}
.sk__line--short { width: 42%; margin-top: 16rpx; }
@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.45; }
}
</style>
