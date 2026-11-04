<script setup lang="ts">
import { getCurrentInstance, nextTick, ref } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { fetchMe, fetchMemberQrTicket } from '@/services/member';
import { friendlyMessage } from '@/utils/errors';
import { boostBrightness, restoreBrightness } from '@/utils/brightness';
import { buildTicketPayload } from '@/utils/memberQr';
import { renderQrOnce } from '@/utils/qrImage';

const QR_SIZE = 280;
const QR_CANVAS_ID = 'qrPage';
const pageInst = getCurrentInstance();
const loading = ref(true);
const errorText = ref('');
const userId = ref(0);
const qrSrc = ref('');
const qrCountdown = ref(0);
let qrTimer: ReturnType<typeof setInterval> | undefined;
let ticketExpiresAt = 0;

function stopCountdown() {
  if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = undefined;
  }
}

function startCountdown() {
  stopCountdown();
  const tick = () => {
    const left = Math.max(0, Math.round((ticketExpiresAt - Date.now()) / 1000));
    qrCountdown.value = left;
    if (left <= 15) {
      stopCountdown();
      paintQr().catch(() => undefined);
    }
  };
  tick();
  qrTimer = setInterval(tick, 1000);
}

async function paintQr() {
  const { ticket, expiresAt } = await fetchMemberQrTicket();
  ticketExpiresAt = new Date(expiresAt).getTime() || Date.now() + 5 * 60 * 1000;
  await nextTick();
  const src = await renderQrOnce(buildTicketPayload(ticket), {
    size: QR_SIZE,
    component: pageInst?.proxy,
    canvasId: QR_CANVAS_ID,
  });
  if (src) qrSrc.value = src;
  startCountdown();
}

async function paint() {
  loading.value = true;
  errorText.value = '';
  try {
    const me = await fetchMe();
    userId.value = me.id;
    loading.value = false;
    await paintQr();
  } catch (error) {
    errorText.value = friendlyMessage(error, '会员码没有加载出来');
    loading.value = false;
  }
}

onShow(() => {
  boostBrightness();
  paint();
});
onHide(() => { stopCountdown(); restoreBrightness(); });
onUnload(() => { stopCountdown(); restoreBrightness(); });
</script>

<template>
  <view class="page">
    <network-banner />
    <view class="glow" />
    <view v-if="loading" class="skel" />
    <view v-else-if="errorText && !qrSrc" class="fail">
      <text>{{ errorText }}</text>
      <button class="retry" hover-class="press" @tap="paint">重试</button>
    </view>
    <view v-else class="card">
      <text class="title">向店员出示</text>
      <image v-if="qrSrc" class="qr-canvas" :src="qrSrc" mode="aspectFit" />
      <view v-else class="qr-canvas qr-canvas--loading" />
      <text v-if="!qrSrc" class="drawing">正在生成…</text>
      <text class="hint">扫码即得积分</text>
      <text v-if="qrCountdown > 0" class="ttl">{{ qrCountdown }}s 后自动刷新</text>
      <text class="meta">编号 {{ userId }}</text>
    </view>
    <text v-if="!loading && qrSrc" class="foot">屏幕亮度已自动调到最高</text>
    <canvas canvas-id="qrPage" id="qrPage" class="qr-cache" />
  </view>
</template>

<style scoped>
.page {
  position: relative;
  min-height: 100vh;
  padding: 40rpx;
  box-sizing: border-box;
  overflow: hidden;
  background: #04161d;
  display: flex;
  flex-direction: column;
  align-items: stretch;
}
.glow {
  position: absolute;
  left: 50%;
  top: -160rpx;
  transform: translateX(-50%);
  width: 720rpx;
  height: 720rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 214, 178, 0.22) 0%, rgba(0, 214, 178, 0) 70%);
}
.skel {
  position: relative;
  z-index: 2;
  height: 740rpx;
  border-radius: 48rpx;
  background: rgba(255, 255, 255, 0.08);
}
.card {
  position: relative;
  z-index: 2;
  background: #fff;
  border-radius: 48rpx;
  padding: 44rpx 32rpx 52rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 32rpx 80rpx rgba(0, 0, 0, 0.42);
}
.title {
  font-size: 32rpx;
  font-weight: 800;
  color: #0e1f26;
  margin-bottom: 32rpx;
  letter-spacing: 1rpx;
}
.qr-canvas { width: 280px; height: 280px; background: #fff; }
.qr-canvas--loading { background: #e8eef0; }
.qr-cache { position: fixed; left: -9999px; top: 0; width: 280px; height: 280px; }
.drawing { margin-top: 14rpx; color: #8a9aa3; font-size: 24rpx; }
.hint {
  margin-top: 40rpx;
  font-size: 34rpx;
  font-weight: 800;
  color: #00766a;
  letter-spacing: 2rpx;
}
.ttl { margin-top: 12rpx; font-size: 22rpx; color: #a8b6bd; }
.meta { margin-top: 16rpx; font-size: 22rpx; color: #b3c0c7; letter-spacing: 1rpx; }
.foot {
  position: relative;
  z-index: 2;
  margin-top: 36rpx;
  text-align: center;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.35);
}
.fail {
  position: relative;
  z-index: 2;
  color: #ff9a9c;
  font-weight: 700;
  line-height: 1.6;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
  padding: 48rpx 0;
}
.retry {
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  border-radius: 999rpx;
  font-size: 26rpx;
  font-weight: 700;
}
.retry::after { border: none; }
</style>
