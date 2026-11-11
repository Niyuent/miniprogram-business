<script setup lang="ts">
import { onLoad } from '@dcloudio/uni-app';

/**
 * 积分商城已取消。保留旧路径只为兼容老版本的分享链接与本地缓存：
 * 统一改道到「逛商家」，兑换区藏进每一家商家的页面里。
 */
onLoad((query) => {
  // 老链接里如果带了商家，改道时把这个上下文一并带过去，别丢回总列表
  const merchantId = Number(query?.merchantId ?? 0);
  const qs = merchantId > 0 ? `?merchantId=${merchantId}` : '';
  uni.reLaunch({ url: `/pages/member/galaxy/index${qs}` });
});
</script>
<template><view class="hold" /></template>
<style scoped>
.hold { min-height: 100vh; background: #f3f7f8; }
</style>
