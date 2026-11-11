<script setup lang="ts">
/**
 * 旧的「统一兑换页」已整体下线：兑换区搬进每一家商家。
 * 这个组件不再渲染任何券池，只保留一个占位，防止老页面/老缓存里残留的
 * <mall-panel> 引用直接白屏；正常流程不会走到这里。
 */
function goShops() {
  uni.reLaunch({ url: '/pages/member/galaxy/index' });
}
</script>

<template>
  <view class="retired">
    <view class="pm-card retired__card">
      <text class="retired__t">积分兑换已搬进商家</text>
      <text class="retired__d">
        每家店的兑换区都不一样：进店后只用在这家店攒的积分换券，不再有统一的兑换页。
      </text>
      <view class="pm-btn pm-btn--primary" hover-class="press" @tap="goShops">去逛商家</view>
    </view>
  </view>
</template>

<style scoped>
.retired { padding: 40rpx 28rpx; }
.retired__card { display: flex; flex-direction: column; gap: 18rpx; padding: 40rpx 32rpx; }
.retired__t { font-size: 32rpx; font-weight: 700; color: #0e1f26; }
.retired__d { font-size: 25rpx; line-height: 1.6; color: #647882; }
</style>
