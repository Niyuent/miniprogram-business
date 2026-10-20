<script setup lang="ts">
defineProps<{ title: string; hint?: string }>();
</script>

<template>
  <view class="empty">
    <view class="art">
      <view class="art__card">
        <view class="art__bar" />
        <view class="art__line" />
        <view class="art__line art__line--short" />
      </view>
      <view class="art__badge">+</view>
    </view>
    <view class="empty__title">{{ title }}</view>
    <view v-if="hint" class="empty__hint">{{ hint }}</view>
  </view>
</template>

<style scoped>
.empty { padding: 48rpx 24rpx 24rpx; text-align: center; }
.art { position: relative; width: 220rpx; height: 160rpx; margin: 0 auto 12rpx; }
.art__card {
  width: 200rpx; height: 132rpx; margin: 14rpx auto 0; background: #ccfbf1; border-radius: 20rpx; padding: 28rpx 24rpx; box-sizing: border-box;
}
.art__bar { width: 96rpx; height: 16rpx; border-radius: 8rpx; background: #0f766e; }
.art__line { width: 140rpx; height: 12rpx; border-radius: 8rpx; background: #99f6e4; margin-top: 16rpx; }
.art__line--short { width: 100rpx; }
.art__badge {
  position: absolute; right: 0; top: 0; width: 48rpx; height: 48rpx; border-radius: 50%;
  background: #0f766e; color: #fff; font-size: 32rpx; line-height: 48rpx; text-align: center; font-weight: 700;
}
.empty__title { font-size: 30rpx; font-weight: 700; color: #334155; }
.empty__hint { margin-top: 8rpx; color: #94a3b8; font-size: 24rpx; line-height: 1.5; }
</style>
