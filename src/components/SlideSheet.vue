<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{ visible: boolean }>();
const emit = defineEmits<{ close: [] }>();
const rendered = ref(false);
const shown = ref(false);
let timer = 0;

watch(
  () => props.visible,
  async (open) => {
    if (timer) clearTimeout(timer);
    if (open) {
      rendered.value = true;
      await nextTick();
      shown.value = true;
      return;
    }
    shown.value = false;
    timer = setTimeout(() => {
      rendered.value = false;
    }, 300) as unknown as number;
  },
  { immediate: true },
);

function close() {
  emit('close');
}
</script>

<template>
  <view v-if="rendered" class="mask" :class="{ 'is-on': shown }" @tap="close">
    <view class="sheet" :class="{ 'is-on': shown }" @tap.stop>
      <view class="handle" />
      <slot />
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
  background: rgba(15, 23, 42, 0);
  display: flex;
  align-items: flex-end;
  transition: background 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.mask.is-on { background: rgba(15, 23, 42, 0.45); }
.sheet {
  width: 100%;
  max-height: 86vh;
  background: #fff;
  border-radius: 36rpx 36rpx 0 0;
  padding: 16rpx 32rpx 48rpx;
  box-sizing: border-box;
  transform: translateY(100%);
  transition: transform 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
  will-change: transform;
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.sheet.is-on { transform: translateY(0); }
.handle {
  width: 72rpx;
  height: 8rpx;
  border-radius: 999rpx;
  background: #e2e8f0;
  margin: 8rpx auto 20rpx;
}
</style>
