<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { applyPageUrl, applySharePath, enableShareMenu } from '@/utils/share';

const invite = ref('');
const pageUrl = ref('');
const opened = ref(false);

onLoad((query) => {
  invite.value = String(query?.invite || '');
  pageUrl.value = applyPageUrl(invite.value);
  enableShareMenu();
});

onShareAppMessage(() => ({
  title: '邀请你入驻商盟',
  path: applySharePath(invite.value),
}));

function openForm() {
  // #ifdef H5
  window.location.href = pageUrl.value;
  // #endif
  // #ifndef H5
  opened.value = true;
  // #endif
}

function copyLink() {
  uni.setClipboardData({
    data: pageUrl.value,
    success() {
      uni.showToast({ title: '申请链接已复制', icon: 'none' });
    },
  });
}
</script>

<template>
  <web-view v-if="opened" :src="pageUrl" />
  <view v-else class="page">
    <network-banner />
    <view class="card">
      <view class="brand">商盟入驻</view>
      <view class="title">附属商家入驻申请</view>
      <view class="code">{{ invite || '通用邀请' }}</view>
      <view class="hint">这是发给你的专属邀请码。填写资料后，由邀请方审核开通。</view>
      <button class="go" @tap="openForm">填写入驻申请</button>
      <button class="ghost" @tap="copyLink">复制申请链接</button>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 80rpx 32rpx; box-sizing: border-box; }
.card { background: #fff; border-radius: 24rpx; padding: 40rpx 32rpx; }
.brand { color: #0f766e; letter-spacing: 4rpx; font-size: 24rpx; }
.title { margin-top: 12rpx; font-size: 40rpx; font-weight: 700; }
.code { margin-top: 28rpx; font-size: 56rpx; font-weight: 700; letter-spacing: 2rpx; color: #0f766e; }
.hint { margin-top: 12rpx; color: #64748b; line-height: 1.6; }
.go { margin-top: 36rpx; background: #0f766e; color: #fff; border-radius: 12rpx; }
.ghost { margin-top: 16rpx; background: #f1f5f9; color: #0f172a; border-radius: 12rpx; }
</style>
