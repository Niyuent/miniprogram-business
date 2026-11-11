<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { useDeskStore } from '@/stores/desk';

onLoad(() => {
  useDeskStore().merchant = 'ai';
  uni.reLaunch({ url: '/pages/merchant/workbench/index' });
});
</script>

<template>
  <view />
</template>
