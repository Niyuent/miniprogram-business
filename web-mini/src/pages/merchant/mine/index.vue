<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';
import { useDeskStore } from '@/stores/desk';

onLoad(() => {
  useDeskStore().merchant = 'profile';
  uni.reLaunch({ url: '/pages/merchant/workbench/index' });
});
</script>
<template><view class="hold" /></template>
<style scoped>
.hold { min-height: 100vh; background: #e7eef8; }
</style>
