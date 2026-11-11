<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{ visible: boolean; text?: string }>();
const emit = defineEmits<{ done: [] }>();
const rendered = ref(false);
const shown = ref(false);
let timer = 0;

watch(
  () => props.visible,
  async (open) => {
    if (timer) clearTimeout(timer);
    if (!open) {
      shown.value = false;
      timer = setTimeout(() => {
        rendered.value = false;
      }, 280) as unknown as number;
      return;
    }
    rendered.value = true;
    await nextTick();
    shown.value = true;
    timer = setTimeout(() => {
      shown.value = false;
      emit('done');
      timer = setTimeout(() => {
        rendered.value = false;
      }, 240) as unknown as number;
    }, 900) as unknown as number;
  },
);
</script>

<template>
  <view v-if="rendered" class="burst" :class="{ 'is-on': shown }">
    <view class="burst__glow" />
    <view class="burst__mark">✓</view>
    <view class="burst__text">{{ text || '成功' }}</view>
  </view>
</template>

<style scoped>
.burst {
  position: fixed;
  left: 0;
  right: 0;
  top: 0;
  bottom: 0;
  z-index: 80;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: none;
  opacity: 0;
  transition: opacity 0.22s ease;
}
.burst.is-on { opacity: 1; }
.burst__glow {
  position: absolute;
  width: 220rpx;
  height: 220rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(34, 197, 94, 0.35) 0%, rgba(34, 197, 94, 0) 70%);
  transform: scale(0.6);
}
.burst.is-on .burst__glow {
  animation: glow 0.55s cubic-bezier(0.25, 0.8, 0.25, 1) forwards;
}
.burst__mark {
  width: 140rpx;
  height: 140rpx;
  border-radius: 50%;
  background: #16a34a;
  color: #fff;
  font-size: 72rpx;
  font-weight: 800;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 16rpx 40rpx rgba(22, 163, 74, 0.35);
  transform: scale(0.5);
}
.burst.is-on .burst__mark {
  animation: spring 0.42s cubic-bezier(0.34, 1.45, 0.64, 1) forwards;
}
.burst__text {
  margin-top: 20rpx;
  color: #15803d;
  font-size: 32rpx;
  font-weight: 800;
  transform: translateY(12rpx);
  opacity: 0;
}
.burst.is-on .burst__text {
  animation: textIn 0.28s ease 0.12s forwards;
}
@keyframes spring {
  0% { transform: scale(0.5); }
  55% { transform: scale(1.2); }
  100% { transform: scale(1); }
}
@keyframes glow {
  to { transform: scale(1.35); opacity: 0.85; }
}
@keyframes textIn {
  to { transform: translateY(0); opacity: 1; }
}
</style>
