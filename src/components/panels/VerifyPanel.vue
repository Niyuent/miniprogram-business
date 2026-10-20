<script setup lang="ts">
import { ref, watch } from 'vue';
import SlideSheet from '@/components/SlideSheet.vue';
import { useDeskStore } from '@/stores/desk';
import { useSessionStore } from '@/stores/session';
import { fetchWorkbench, redeemCoupon, verifyCoupon, type CouponPreview } from '@/services/merchant';
import { friendlyMessage } from '@/utils/errors';
import { promptSubscribe } from '@/utils/subscribe';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const scanning = ref(false);
const storeId = ref<number | null>(null);
const storeName = ref('');
const errorText = ref('');
const mockOpen = ref(false);
const mockCode = ref('');
const drawer = ref(false);
const coupon = ref<CouponPreview | null>(null);
const code = ref('');
const amount = ref('');
const confirming = ref(false);
const success = ref(false);

async function prepare() {
  loading.value = true;
  try {
    const desk = await fetchWorkbench();
    storeId.value = desk.storeId;
    storeName.value = desk.storeName;
    if (desk.storeId) uni.setStorageSync('mini_store_id', desk.storeId);
  } catch (error) {
    errorText.value = friendlyMessage(error, '门店信息没有加载出来');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function denied(errMsg: string) {
  return /auth|deny|permission|authorize|camera/i.test(errMsg);
}

function openSettings() {
  uni.showModal({
    title: '需要相机权限',
    content: '扫码核销要使用相机。请在设置里允许使用摄像头，然后再试一次。',
    confirmText: '去设置',
    success(res) {
      if (res.confirm) uni.openSetting({});
    },
  });
}

function scan() {
  errorText.value = '';
  success.value = false;
  uni.scanCode({
    onlyFromCamera: true,
    success(res) {
      const value = (res.result || '').trim();
      if (!value) {
        errorText.value = '没有扫到券码';
        return;
      }
      inspect(value);
    },
    fail(err) {
      const msg = err.errMsg || '';
      if (denied(msg)) {
        openSettings();
        return;
      }
      if (/cancel/i.test(msg)) return;
      mockOpen.value = true;
    },
  });
}

function submitMock() {
  if (scanning.value) return;
  const value = mockCode.value.trim();
  if (!value) {
    errorText.value = '请先输入券码';
    return;
  }
  mockOpen.value = false;
  inspect(value);
}

async function inspect(value: string) {
  scanning.value = true;
  errorText.value = '';
  try {
    const result = await verifyCoupon({ code: value, storeId: storeId.value });
    code.value = value;
    coupon.value = {
      faceValue: result.coupon.faceValue,
      userPhone: result.coupon.userPhone,
      templateName: result.coupon.templateName,
      thresholdAmount: result.coupon.thresholdAmount,
    };
    amount.value = '';
    drawer.value = true;
  } catch (error) {
    drawer.value = false;
    errorText.value = friendlyMessage(error, '这张券现在不能核销');
  } finally {
    scanning.value = false;
  }
}

function speakSuccess() {
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  if (!synth) return;
  const utter = new SpeechSynthesisUtterance('核销成功');
  utter.lang = 'zh-CN';
  synth.speak(utter);
}

async function confirm() {
  if (confirming.value) return;
  const pay = Number(amount.value);
  if (!Number.isFinite(pay) || pay <= 0) {
    errorText.value = '请填写本次订单的实付金额';
    return;
  }
  confirming.value = true;
  errorText.value = '';
  const orderNo = `SM${Date.now()}`;
  try {
    await verifyCoupon({ code: code.value, storeId: storeId.value, orderAmount: pay, orderNo });
    await redeemCoupon({ code: code.value, storeId: storeId.value, orderAmount: pay, orderNo });
    drawer.value = false;
    success.value = true;
    speakSuccess();
    promptSubscribe('redeem');
  } catch (error) {
    errorText.value = friendlyMessage(error, '核销没有完成');
  } finally {
    confirming.value = false;
  }
}

const desk = useDeskStore();
watch(() => desk.pull, () => { if (props.active) prepare(); });

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    prepare();
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <view v-if="loading" class="skel" />
    <template v-else>
      <view class="place">{{ storeName }}</view>
      <button class="scan" hover-class="press" :loading="scanning" :disabled="scanning" @tap="scan">{{ scanning ? '正在校验…' : '扫一扫核销' }}</button>
      <view v-if="errorText" class="fail">{{ errorText }}</view>
      <view v-if="success" class="ok">
        <view class="ok__mark">✓</view>
        <view>核销成功</view>
      </view>
    </template>

    <slide-sheet :visible="mockOpen" @close="mockOpen = false">
      <view class="sheet__title">浏览器里改用券码</view>
      <input v-model="mockCode" class="field" placeholder="输入扫到的券码" />
      <button class="go" hover-class="press" :loading="scanning" :disabled="scanning" @tap="submitMock">校验这张券</button>
    </slide-sheet>

    <slide-sheet :visible="drawer" @close="drawer = false">
      <view class="sheet__title">{{ coupon?.templateName || '代金券' }}</view>
      <view class="face">¥{{ coupon?.faceValue }}</view>
      <view class="meta">顾客手机 {{ coupon?.userPhone || '未登记' }}</view>
      <input v-model="amount" class="field" type="digit" placeholder="本次订单实付金额" />
      <button class="go" hover-class="press" :loading="confirming" :disabled="confirming" @tap="confirm">{{ confirming ? '正在核销…' : '确认核销' }}</button>
    </slide-sheet>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 80rpx 40rpx 180rpx; box-sizing: border-box; }
.skel { height: 280rpx; border-radius: 24rpx; background: #e2e8f0; }
.place { text-align: center; color: #64748b; }
.scan { margin-top: 80rpx; height: 120rpx; line-height: 120rpx; background: #1d4ed8; color: #fff; border-radius: 20rpx; font-size: 36rpx; }
.fail { margin-top: 32rpx; color: #b91c1c; font-size: 32rpx; font-weight: 700; text-align: center; line-height: 1.5; }
.ok { margin-top: 48rpx; text-align: center; color: #15803d; font-size: 36rpx; font-weight: 700; }
.ok__mark {
  width: 140rpx; height: 140rpx; margin: 0 auto 16rpx; border-radius: 50%;
  background: #16a34a; color: #fff; font-size: 80rpx; line-height: 140rpx;
  animation: pop .35s ease;
}
@keyframes pop { from { transform: scale(.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }
.mask { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); z-index: 30; display: flex; align-items: flex-end; }
.sheet { width: 100%; background: #fff; border-radius: 28rpx 28rpx 0 0; padding: 36rpx 32rpx 48rpx; box-sizing: border-box; }
.sheet__title { font-size: 32rpx; font-weight: 700; }
.face { margin-top: 12rpx; font-size: 64rpx; font-weight: 700; }
.meta { margin-top: 8rpx; color: #64748b; }
.field { margin-top: 24rpx; background: #f1f5f9; border-radius: 12rpx; padding: 20rpx 24rpx; }
.go { margin-top: 24rpx; background: #0f172a; color: #fff; border-radius: 12rpx; }
</style>
