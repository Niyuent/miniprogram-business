<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onShareAppMessage } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { fetchWorkbench } from '@/services/merchant';
import { friendlyMessage } from '@/utils/errors';
import { applySharePath, enableShareMenu, merchantInviteCode } from '@/utils/share';
import { useDeskStore } from '@/stores/desk';

const loading = ref(true);
const errorText = ref('');
const storeName = ref('');
const merchantName = ref('');
const merchantId = ref(0);
const bossName = ref('');

onLoad(() => {
  enableShareMenu();
  load();
});

onShareAppMessage(() => ({
  title: '邀请店员一起用小Z核销',
  path: applySharePath(merchantInviteCode(merchantId.value)),
}));

async function load() {
  loading.value = true;
  errorText.value = '';
  try {
    const wb = await fetchWorkbench();
    storeName.value = wb.storeName || '';
    merchantName.value = wb.merchantName || '';
    merchantId.value = wb.merchantId || Number(uni.getStorageSync('mini_merchant_id') || 0);
    bossName.value = wb.bossName || '店主';
  } catch (error) {
    errorText.value = friendlyMessage(error, '门店信息加载失败');
    merchantId.value = Number(uni.getStorageSync('mini_merchant_id') || 0);
  } finally {
    loading.value = false;
  }
}

function goVerify() {
  useDeskStore().merchant = 'verify';
  uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/merchant/workbench/index' }) });
}

function goEarn() {
  uni.navigateTo({ url: '/pages/merchant/earn/index' });
}

function shareInvite() {
  uni.showShareMenu({ withShareTicket: true, fail() {} });
  uni.showToast({ title: '点右上角转发给店员', icon: 'none' });
}
</script>

<template>
  <view class="page">
    <network-banner />
    <view class="hero">
      <text class="hero__t">店员与权限</text>
      <text class="hero__d">{{ storeName || merchantName || '本店' }} · 核销与录单权限</text>
    </view>

    <view v-if="loading" class="skel" />
    <template v-else>
      <view v-if="errorText" class="fail">{{ errorText }}</view>

      <view class="card">
        <text class="card__title">当前账号</text>
        <view class="row">
          <text class="lab">身份</text>
          <text class="val">{{ bossName }} · 店主</text>
        </view>
        <view class="row">
          <text class="lab">门店</text>
          <text class="val">{{ storeName || '—' }}</text>
        </view>
        <view class="row">
          <text class="lab">商家</text>
          <text class="val">{{ merchantName || '—' }}</text>
        </view>
      </view>

      <view class="card">
        <text class="card__title">本店可开放能力</text>
        <view class="perm" @tap="goVerify">
          <view class="ico">核</view>
          <view class="main">
            <text class="t">扫码核销</text>
            <text class="d">店员登录后可核销本店券码</text>
          </view>
          <text class="act">去核销</text>
        </view>
        <view class="perm" @tap="goEarn">
          <view class="ico">录</view>
          <view class="main">
            <text class="t">录单发积分</text>
            <text class="d">扫会员码录入消费并发积分</text>
          </view>
          <text class="act">去录单</text>
        </view>
      </view>

      <view class="card tip">
        <text class="card__title">邀请店员</text>
        <text class="hint">转发专属邀请链接，店员可走入驻/开通流程。已有店员账号（如 clerk01）直接登录小程序即可核销本门店。</text>
        <button class="btn" @tap="shareInvite">转发邀请</button>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding-bottom: 80rpx; box-sizing: border-box; background: #f3f7f8; }
.hero {
  padding: 36rpx 32rpx 48rpx;
  background: linear-gradient(135deg, #09303a 0%, #0b2440 100%);
  border-radius: 0 0 40rpx 40rpx;
}
.hero__t { display: block; font-size: 40rpx; font-weight: 800; color: #fff; }
.hero__d { display: block; margin-top: 10rpx; font-size: 24rpx; color: rgba(255,255,255,.85); }
.card {
  margin: 24rpx 32rpx 0; padding: 28rpx 28rpx 8rpx; background: #fff;
  border-radius: 32rpx; box-shadow: 0 12rpx 36rpx rgba(10, 60, 58, 0.06);
}
.card.tip { padding-bottom: 28rpx; }
.card__title { display: block; font-size: 28rpx; font-weight: 800; color: #0e1f26; margin-bottom: 12rpx; }
.row {
  display: flex; justify-content: space-between; align-items: center;
  padding: 18rpx 0; border-bottom: 1px solid #eaf0f2;
}
.row:last-child { border-bottom: none; }
.lab { color: #8a9aa3; font-size: 24rpx; }
.val { color: #0e1f26; font-size: 26rpx; font-weight: 600; max-width: 65%; text-align: right; }
.perm {
  display: flex; align-items: center; gap: 16rpx; padding: 22rpx 0;
  border-bottom: 1px solid #eaf0f2;
}
.perm:last-child { border-bottom: none; }
.ico {
  width: 68rpx; height: 68rpx; border-radius: 20rpx; background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 24rpx;
}
.main { flex: 1; min-width: 0; }
.t { display: block; font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.d { display: block; margin-top: 4rpx; font-size: 22rpx; color: #8a9aa3; }
.act { color: #009784; font-weight: 700; font-size: 24rpx; }
.hint { display: block; font-size: 24rpx; line-height: 1.55; color: #556670; }
.btn {
  margin-top: 24rpx; background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff; border-radius: 999rpx; font-weight: 700; border: none;
}
.fail { margin: 24rpx 32rpx 0; color: #c22a2e; font-weight: 700; }
.skel { margin: 24rpx 32rpx; height: 200rpx; border-radius: 32rpx; background: #e2eaee; }
</style>
