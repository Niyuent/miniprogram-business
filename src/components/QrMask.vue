<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { clearQrCanvas } from '@/utils/qrImage';

const props = defineProps<{ visible: boolean; code: string; image?: string }>();
const emit = defineEmits<{ close: [] }>();
const rendered = ref(false);
const shown = ref(false);
let previousBrightness = 0.6;
let timer = 0;

watch(
  () => props.visible,
  async (open) => {
    if (timer) clearTimeout(timer);
    if (open) {
      rendered.value = true;
      raiseBrightness();
      await nextTick();
      shown.value = true;
      return;
    }
    shown.value = false;
    restoreBrightness();
    timer = setTimeout(() => {
      rendered.value = false;
    }, 300) as unknown as number;
  },
  { immediate: true },
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
  <view v-if="rendered" class="mask" :class="{ 'is-on': shown }" @tap="close">
    <view class="sheet" :class="{ 'is-on': shown }" @tap.stop>
      <image v-if="image" class="qr" :src="image" mode="aspectFit" lazy-load />
      <view v-else class="qr wait">二维码准备中</view>
      <view class="code">{{ code }}</view>
      <view class="hint">请将此码出示给店员核销</view>
      <button class="share pressable" hover-class="press" hover-start-time="20" open-type="share">分享给好友</button>
      <button class="close pressable" hover-class="press" hover-start-time="20" @tap="close">关闭</button>
    </view>
  </view>
</template>

<style scoped>
.mask {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 40;
  background: rgba(2, 6, 23, 0);
  display: flex;
  align-items: flex-end;
  justify-content: center;
  transition: background 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.mask.is-on { background: rgba(2, 6, 23, 0.82); }
.sheet {
  width: 100%;
  max-width: 640rpx;
  margin: 0 24rpx 48rpx;
  background: rgba(255, 255, 255, 0.98);
  border-radius: 40rpx;
  padding: 40rpx 32rpx 32rpx;
  text-align: center;
  box-shadow: 0 24rpx 60rpx rgba(15, 23, 42, 0.18);
  transform: translateY(100%);
  opacity: 0.96;
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1), opacity 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  will-change: transform, opacity;
}
.sheet.is-on {
  transform: translateY(0);
  opacity: 1;
}
.qr { width: 220px; height: 220px; margin: 0 auto; }
.wait { line-height: 220px; color: #94a3b8; background: #f8fafc; border-radius: 16rpx; }
.code { margin-top: 12rpx; letter-spacing: 2rpx; color: #334155; }
.hint { margin-top: 16rpx; font-size: 32rpx; font-weight: 700; }
.share { margin-top: 24rpx; background: #ccfbf1; color: #0f766e; border-radius: 12rpx; font-weight: 700; }
.close { margin-top: 16rpx; background: #0f172a; color: #fff; border-radius: 12rpx; }
</style>
