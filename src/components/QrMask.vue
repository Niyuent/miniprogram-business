<script setup lang="ts">
import { watch } from 'vue';
import { clearQrCanvas } from '@/utils/qrImage';

const props = defineProps<{ visible: boolean; code: string; image?: string }>();
const emit = defineEmits<{ close: [] }>();
let previousBrightness = 0.6;

watch(
  () => props.visible,
  (open) => {
    if (open) raiseBrightness();
    else restoreBrightness();
  },
);

function raiseBrightness() {
  const getter = uni.getScreenBrightness;
  if (typeof getter !== 'function') return;
  getter({
    success(res) {
      previousBrightness = res.value;
    },
    complete() {
      uni.setScreenBrightness?.({ value: 1 });
    },
  });
}

function restoreBrightness() {
  if (typeof uni.setScreenBrightness === 'function') {
    uni.setScreenBrightness({ value: previousBrightness });
  }
}

function close() {
  restoreBrightness();
  clearQrCanvas();
  emit('close');
}
</script>

<template>
  <view v-if="visible" class="mask is-on" @tap="close">
    <view class="sheet is-on" @tap.stop>
      <image v-if="image" class="qr" :src="image" mode="aspectFit" />
      <view v-else class="qr wait">二维码准备中</view>
      <view class="code">{{ code }}</view>
      <view class="hint">请将此码出示给店员核销</view>
      <button class="share" hover-class="press" open-type="share">分享给好友</button>
      <button class="close" hover-class="press" @tap="close">关闭</button>
    </view>
  </view>
</template>

<style scoped>
.mask {
  position: fixed;
  inset: 0;
  z-index: 40;
  background: rgba(2, 6, 23, 0.82);
  display: flex;
  align-items: center;
  justify-content: center;
}
.sheet {
  width: 560rpx;
  background: rgba(255, 255, 255, 0.96);
  border-radius: 40rpx;
  padding: 40rpx 32rpx 32rpx;
  text-align: center;
  box-shadow: 0 24rpx 60rpx rgba(15, 23, 42, 0.18);
  animation: rise 0.28s ease;
}
@keyframes rise { from { transform: translateY(40rpx); opacity: 0; } to { transform: none; opacity: 1; } }
.qr { width: 220px; height: 220px; margin: 0 auto; }
.wait { line-height: 220px; color: #94a3b8; background: #f8fafc; border-radius: 16rpx; }
.code { margin-top: 12rpx; letter-spacing: 2rpx; color: #334155; }
.hint { margin-top: 16rpx; font-size: 32rpx; font-weight: 700; }
.share { margin-top: 24rpx; background: #ccfbf1; color: #0f766e; border-radius: 12rpx; font-weight: 700; }
.close { margin-top: 16rpx; background: #0f172a; color: #fff; border-radius: 12rpx; }
</style>
