<script setup lang="ts">
import { getCurrentInstance, nextTick, ref } from 'vue';
import { onHide, onShow, onUnload } from '@dcloudio/uni-app';
import UQRCode from 'uqrcodejs';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { fetchMe } from '@/services/member';
import { friendlyMessage } from '@/utils/errors';

const QR_SIZE = 280;
const pageInst = getCurrentInstance();
const loading = ref(true);
const errorText = ref('');
const userId = ref(0);
const payload = ref('');
const drawn = ref(false);
let savedBrightness: number | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function boostBrightness() {
  try {
    const cur = await new Promise<{ value: number }>((resolve, reject) => {
      uni.getScreenBrightness({ success: resolve as (res: { value: number }) => void, fail: reject });
    });
    if (typeof cur.value === 'number') savedBrightness = cur.value;
  } catch {
    savedBrightness = null;
  }
  try {
    uni.setScreenBrightness({ value: 1 });
  } catch {
    /* H5 / 无权限时忽略 */
  }
}

function restoreBrightness() {
  if (savedBrightness == null) return;
  try {
    uni.setScreenBrightness({ value: savedBrightness });
  } catch {
    /* ignore */
  }
  savedBrightness = null;
}

function drawQr(code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const host = pageInst?.proxy ?? pageInst;
      const qr = new UQRCode();
      qr.data = code;
      qr.size = QR_SIZE;
      qr.make();
      const ctx = uni.createCanvasContext('memberQr', host as never);
      qr.canvasContext = ctx as never;
      const done = () => {
        drawn.value = true;
        resolve();
      };
      const drawnResult = qr.drawCanvas() as Promise<void> | void;
      if (drawnResult && typeof (drawnResult as Promise<void>).then === 'function') {
        (drawnResult as Promise<void>).then(done).catch(reject);
      } else {
        setTimeout(done, 80);
      }
    } catch (e) {
      reject(e);
    }
  });
}

async function paint() {
  loading.value = true;
  errorText.value = '';
  drawn.value = false;
  try {
    const me = await fetchMe();
    userId.value = me.id;
    payload.value = `SM_MEMBER:${me.id}`;
    loading.value = false;
    await nextTick();
    await sleep(100);
    await drawQr(payload.value);
  } catch (error) {
    errorText.value = friendlyMessage(error, '会员码没有加载出来');
    loading.value = false;
  }
}

onShow(() => {
  boostBrightness();
  paint();
});
onHide(() => restoreBrightness());
onUnload(() => restoreBrightness());
</script>

<template>
  <view class="page">
    <network-banner />
    <view v-if="loading" class="skel" />
    <view v-else-if="errorText" class="fail">
      <text>{{ errorText }}</text>
      <button class="retry" hover-class="press" @tap="paint">重试</button>
    </view>
    <view v-else class="card">
      <text class="title">我的会员码</text>
      <canvas
        canvas-id="memberQr"
        id="memberQr"
        class="qr-canvas"
        :style="{ width: QR_SIZE + 'px', height: QR_SIZE + 'px' }"
      />
      <text v-if="!drawn" class="drawing">正在生成…</text>
      <text class="hint">请将此码出示给店员</text>
      <text class="meta">编号 {{ userId }}</text>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 48rpx 40rpx 80rpx;
  box-sizing: border-box;
  background: linear-gradient(160deg, #eafcf8 0%, #e9f3ff 55%, #f3f7f8 100%);
}
.skel {
  height: 640rpx;
  border-radius: 48rpx;
  background: #e2eaee;
}
.card {
  background: #fff;
  border-radius: 48rpx;
  padding: 48rpx 32rpx 56rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.08);
}
.title {
  font-size: 36rpx;
  font-weight: 800;
  color: #0e1f26;
  margin-bottom: 36rpx;
}
.qr-canvas {
  width: 280px;
  height: 280px;
  background: #fff;
}
.drawing {
  margin-top: 12rpx;
  color: #8a9aa3;
  font-size: 24rpx;
}
.hint {
  margin-top: 48rpx;
  font-size: 36rpx;
  font-weight: 800;
  color: #009784;
  letter-spacing: 2rpx;
}
.meta {
  margin-top: 20rpx;
  font-size: 24rpx;
  color: #8a9aa3;
}
.fail {
  color: #c22a2e;
  font-weight: 700;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
.retry {
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  border-radius: 999rpx;
}
</style>
