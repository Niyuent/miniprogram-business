<script setup lang="ts">
import { watch } from 'vue';
import { useSessionStore } from '@/stores/session';
import { logoutToLogin } from '@/utils/logout';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();

function logout() {
  logoutToLogin();
}

watch(
  () => props.active,
  (on) => {
    if (on) session.hydrate();
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <view class="title">我的</view>
    <view class="who">{{ session.profileName || '商家账号' }}</view>
    <view class="hint">当前是商家身份。退出后可以改用会员微信登录，或其他商家测试账号。</view>
    <button class="logout" @tap="logout">退出登录</button>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 48rpx 32rpx 180rpx; box-sizing: border-box; }
.title { font-size: 44rpx; font-weight: 700; }
.who { margin-top: 16rpx; font-size: 32rpx; }
.hint { margin-top: 12rpx; color: #64748b; line-height: 1.6; }
.logout { margin-top: 40rpx; background: #fff; color: #1d4ed8; border-radius: 12rpx; }
</style>
