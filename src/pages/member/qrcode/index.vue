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

/** 真机上直接画到可见 canvas，避免离屏导出 tempFile 失败。 */
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
        // 旧版 draw 是同步的，稍等一帧再标记完成
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
    // 先挂载可见 canvas，再绘制（真机离屏/未挂载导出必失败）
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
  background: linear-gradient(180deg, #dbeafe 0%, #e7eef8 40%, #f1f5f9 100%);
}
.skel {
  height: 640rpx;
  border-radius: 32rpx;
  background: #e2e8f0;
}
.card {
  background: #fff;
  border-radius: 36rpx;
  padding: 48rpx 32rpx 56rpx;
  display: flex;
  flex-direction: column;
  align-items: center;
  box-shadow: 0 16rpx 40rpx rgba(15, 23, 42, 0.08);
}
.title {
  font-size: 36rpx;
  font-weight: 800;
  color: #0f172a;
  margin-bottom: 36rpx;
}
.qr-canvas {
  width: 280px;
  height: 280px;
  background: #fff;
}
.drawing {
  margin-top: 12rpx;
  color: #94a3b8;
  font-size: 24rpx;
}
.hint {
  margin-top: 48rpx;
  font-size: 40rpx;
  font-weight: 800;
  color: #1d4ed8;
  letter-spacing: 2rpx;
}
.meta {
  margin-top: 20rpx;
  font-size: 24rpx;
  color: #94a3b8;
}
.fail {
  color: #b91c1c;
  font-weight: 700;
  line-height: 1.5;
  display: flex;
  flex-direction: column;
  gap: 24rpx;
}
.retry {
  background: #1d4ed8;
  color: #fff;
  border-radius: 16rpx;
}
</style>
