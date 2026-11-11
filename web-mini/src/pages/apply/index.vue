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
  title: '邀请你一起用小Z',
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
    <view class="glow" />
    <view class="glow glow--b" />

    <view class="brand">
      <view class="brand__mark">Z</view>
      <text class="brand__t">小Z 商盟</text>
    </view>

    <view class="card">
      <text class="eyebrow">商家入驻邀请</text>
      <text class="title">加入联盟，开始互相带客</text>
      <text class="hint">填写资料后由邀请方审核开通，开通即可发券、发积分、对账结算。</text>

      <view class="code-box">
        <text class="code-box__l">专属邀请码</text>
        <text class="code-box__v">{{ invite || '通用邀请' }}</text>
      </view>

      <view class="pm-btn pm-btn--primary go" hover-class="press" @tap="openForm">填写入驻申请</view>
      <view class="pm-btn pm-btn--ghost ghost" hover-class="press" @tap="copyLink">复制申请链接</view>
    </view>

    <text class="foot">邀请来自联盟内商家 · 审核通过后可随时退出</text>
  </view>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  padding: 100rpx 40rpx calc(60rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  overflow: hidden;
  background: linear-gradient(165deg, #04161d 0%, #062230 50%, #07262f 100%);
}
.glow {
  position: absolute;
  right: -200rpx;
  top: -200rpx;
  width: 600rpx;
  height: 600rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 214, 178, 0.26) 0%, rgba(0, 214, 178, 0) 70%);
}
.glow--b {
  right: auto;
  left: -220rpx;
  top: auto;
  bottom: -240rpx;
  background: radial-gradient(circle, rgba(46, 144, 255, 0.22) 0%, rgba(46, 144, 255, 0) 70%);
}

.brand { position: relative; z-index: 2; display: flex; align-items: center; gap: 16rpx; }
.brand__mark {
  width: 64rpx; height: 64rpx; border-radius: 20rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 32rpx; font-weight: 800;
}
.brand__t { font-size: 28rpx; font-weight: 700; color: rgba(255, 255, 255, 0.85); letter-spacing: 2rpx; }

.card {
  position: relative;
  z-index: 2;
  margin-top: 56rpx;
  background: #fff;
  border-radius: 44rpx;
  padding: 44rpx 36rpx 40rpx;
  box-shadow: 0 32rpx 80rpx rgba(0, 0, 0, 0.32);
}
.eyebrow { display: block; font-size: 20rpx; color: #00a08c; letter-spacing: 3rpx; font-weight: 700; }
.title { display: block; margin-top: 14rpx; font-size: 40rpx; font-weight: 800; color: #0e1f26; line-height: 1.35; }
.hint { display: block; margin-top: 16rpx; font-size: 24rpx; color: #6d818b; line-height: 1.65; }

.code-box {
  margin-top: 30rpx;
  padding: 26rpx 28rpx;
  border-radius: 28rpx;
  background: #f5f8f9;
  border: 1rpx solid #eaf0f2;
}
.code-box__l { display: block; font-size: 20rpx; color: #8a9aa3; letter-spacing: 2rpx; }
.code-box__v {
  display: block; margin-top: 8rpx;
  font-size: 48rpx; font-weight: 800; color: #07262f;
  letter-spacing: 4rpx; font-variant-numeric: tabular-nums;
}

.go { margin-top: 34rpx; height: 96rpx; font-size: 30rpx; }
.ghost { margin-top: 18rpx; height: 88rpx; font-size: 26rpx; }

.foot {
  position: relative;
  z-index: 2;
  display: block;
  margin-top: 40rpx;
  text-align: center;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.32);
}
</style>
