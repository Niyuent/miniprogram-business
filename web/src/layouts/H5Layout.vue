<template>
  <div class="h5-shell">
    <router-view />
    <!-- 移动端底部导航：两个 H5 页面互相切换（无需登录态，MVP 用模拟用户） -->
    <van-tabbar route fixed safe-area-inset-bottom>
      <van-tabbar-item to="/h5/exchange" icon="gold-coin-o">积分兑换</van-tabbar-item>
      <van-tabbar-item to="/h5/point-logs" icon="orders-o">积分明细</van-tabbar-item>
    </van-tabbar>
  </div>
</template>

<script setup lang="ts"></script>

<style scoped>
.h5-shell {
  min-height: 100vh;
  background: #f5f6f8;
  /* 给底部 tabbar 留出空间 */
  padding-bottom: 50px;
}
</style>
