<script setup lang="ts">
import { networkOffline } from '@/utils/network';
</script>

<template>
  <view v-if="networkOffline" class="net">网络已断开，恢复后会自动重连</view>
</template>

<style scoped>
.net {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  z-index: 80;
  padding: 16rpx 24rpx;
  background: #b45309;
  color: #fff;
  text-align: center;
  font-size: 26rpx;
}
</style>
