<script setup lang="ts">
import { onLaunch } from '@dcloudio/uni-app';

onLaunch(() => {
  console.log('商盟小程序启动');
});
</script>

<style>
page {
  background: #e7eef8;
  color: #0b1220;
  font-size: 28rpx;
}
/* 微信 hover-class + H5 :active 共用：缩放到 0.96，避免默认灰底 */
.press,
.pressable:active {
  transform: scale(0.96) !important;
  opacity: 0.88 !important;
  background-color: inherit !important;
}
.pressable,
.tap-card {
  transition: transform 0.1s ease, opacity 0.1s ease;
  will-change: transform;
}
.tap-card:active {
  transform: scale(0.96);
  opacity: 0.9;
}
@keyframes list-rise {
  from {
    opacity: 0;
    transform: translateY(20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
.list-rise {
  animation: list-rise 0.28s cubic-bezier(0.25, 0.8, 0.25, 1) both;
}
button[disabled] {
  opacity: 0.55;
}
</style>
