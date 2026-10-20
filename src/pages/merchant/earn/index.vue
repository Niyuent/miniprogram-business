<script setup lang="ts">
import { ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { useSessionStore } from '@/stores/session';
import { createConsumeOrder, earnPoints, fetchWorkbench, findUserIdByPhone } from '@/services/merchant';
import { friendlyMessage } from '@/utils/errors';

const session = useSessionStore();
const loading = ref(true);
const phone = ref('');
const amount = ref('');
const storeId = ref<number | null>(null);
const errorText = ref('');
const submitting = ref(false);

function maskPhone(value: string) {
  if (value.length < 7) return value;
  return `${value.slice(0, 3)}****${value.slice(-4)}`;
}

async function prepare() {
  loading.value = true;
  try {
    const desk = await fetchWorkbench();
    storeId.value = desk.storeId;
  } catch (error) {
    errorText.value = friendlyMessage(error, '门店信息没有加载出来');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

async function submit() {
  if (submitting.value) return;
  errorText.value = '';
  if (!/^1[3-9]\d{9}$/.test(phone.value)) {
    errorText.value = '请填写 11 位手机号';
    return;
  }
  const pay = Number(amount.value);
  if (!Number.isFinite(pay) || pay <= 0) {
    errorText.value = '请填写消费金额';
    return;
  }
  submitting.value = true;
  const rawPhone = phone.value;
  try {
    const userId = await findUserIdByPhone(rawPhone);
    if (!userId) {
      errorText.value = '没有找到这个手机号对应的顾客';
      return;
    }
    const orderNo = `SM${Date.now()}`;
    const created = await createConsumeOrder({
      orderNo,
      userId,
      storeId: storeId.value,
      totalAmount: pay,
    });
    const earned = await earnPoints({ userId, amount: pay, orderId: created.order.id, storeId: storeId.value });
    if (!earned.earned) {
      errorText.value = earned.reasonCode === 'BELOW_MIN_AMOUNT' ? '金额太小，这次不发积分' : '这次没有发放积分';
      return;
    }
    phone.value = '';
    amount.value = '';
    uni.showToast({
      title: `已成功为 ${maskPhone(rawPhone)} 发放 ${earned.points} 积分`,
      icon: 'none',
      duration: 2500,
    });
  } catch (error) {
    errorText.value = friendlyMessage(error, '积分没有发放成功');
  } finally {
    submitting.value = false;
  }
}

onPullDownRefresh(() => prepare());
onShow(() => {
  session.hydrate();
  prepare();
});
</script>

<template>
  <view class="page">
    <network-banner />
    <view v-if="loading" class="skel" />
    <template v-else>
      <view class="title">录单发积分</view>
      <input v-model="phone" class="field" type="number" maxlength="11" placeholder="顾客手机号" />
      <input v-model="amount" class="field" type="digit" placeholder="消费金额" />
      <view v-if="errorText" class="fail">{{ errorText }}</view>
      <button class="go" hover-class="press" :loading="submitting" :disabled="submitting" @tap="submit">{{ submitting ? '正在发放…' : '提交' }}</button>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 48rpx 32rpx; box-sizing: border-box; }
.skel { height: 320rpx; border-radius: 20rpx; background: #e2e8f0; }
.title { font-size: 40rpx; font-weight: 700; margin-bottom: 28rpx; }
.field { background: #fff; border-radius: 12rpx; padding: 24rpx; margin-bottom: 20rpx; }
.fail { color: #b91c1c; font-weight: 700; line-height: 1.5; margin-bottom: 16rpx; }
.go { background: #1d4ed8; color: #fff; border-radius: 12rpx; }
</style>
