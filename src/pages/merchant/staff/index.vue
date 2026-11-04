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
  <view class="pm-page pm-page--plain">
    <network-banner />

    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <text class="pm-hero__title">店员与权限</text>
        <text class="pm-hero__cap hero-cap">{{ storeName || merchantName || '本店' }} · 核销与录单权限</text>
      </view>
    </view>

    <view class="pm-body">
      <view v-if="loading" class="pm-card">
        <view class="pm-skel" style="height: 260rpx" />
      </view>
      <template v-else>
        <view v-if="errorText" class="pm-card fail">
          <text class="fail__t">{{ errorText }}</text>
        </view>

        <view class="pm-card">
          <text class="panel-t">当前账号</text>
          <view class="kv">
            <text class="kv__l">身份</text>
            <text class="kv__v">{{ bossName }} · 店主</text>
          </view>
          <view class="kv">
            <text class="kv__l">门店</text>
            <text class="kv__v">{{ storeName || '—' }}</text>
          </view>
          <view class="kv">
            <text class="kv__l">商家</text>
            <text class="kv__v">{{ merchantName || '—' }}</text>
          </view>
        </view>

        <view class="pm-section">
          <text class="pm-section__t">本店可开放能力</text>
        </view>
        <view class="pm-card pm-card--flush">
          <view class="pm-row" hover-class="press" @tap="goVerify">
            <view class="perm-ico">核</view>
            <view class="pm-row__main">
              <view class="pm-row__t">扫码核销</view>
              <view class="pm-row__d">店员登录后可核销本店券码</view>
            </view>
            <text class="pm-row__x">去核销 ›</text>
          </view>
          <view class="pm-row" hover-class="press" @tap="goEarn">
            <view class="perm-ico perm-ico--blue">录</view>
            <view class="pm-row__main">
              <view class="pm-row__t">录单发积分</view>
              <view class="pm-row__d">扫会员码录入消费并发积分</view>
            </view>
            <text class="pm-row__x">去录单 ›</text>
          </view>
        </view>

        <view class="pm-card invite">
          <text class="panel-t">邀请店员</text>
          <text class="hint">转发专属邀请链接给店员，对方开通后即可在本门店核销与录单，不需要共用你的账号。</text>
          <view class="pm-btn pm-btn--primary share-btn" hover-class="press" @tap="shareInvite">转发邀请</view>
        </view>
      </template>
    </view>
  </view>
</template>

<style scoped>
.hero-cap { display: block; margin-top: 12rpx; }
.panel-t { display: block; font-size: 26rpx; font-weight: 700; color: #0e1f26; margin-bottom: 8rpx; }

.kv {
  display: flex; align-items: center; justify-content: space-between;
  padding: 20rpx 0; border-bottom: 1rpx solid #f2f6f7;
}
.kv:last-child { border-bottom: none; }
.kv__l { font-size: 24rpx; color: #8a9aa3; }
.kv__v { font-size: 26rpx; font-weight: 600; color: #0e1f26; max-width: 66%; text-align: right; }

.perm-ico {
  width: 72rpx; height: 72rpx; border-radius: 22rpx; flex-shrink: 0;
  background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; font-weight: 800;
}
.perm-ico--blue { background: #eaf2ff; color: #1c6dd0; }

.invite { margin-top: 20rpx; }
.hint { display: block; margin-top: 10rpx; font-size: 22rpx; color: #8a9aa3; line-height: 1.65; }
.share-btn { margin-top: 26rpx; height: 84rpx; font-size: 26rpx; }

.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
</style>
