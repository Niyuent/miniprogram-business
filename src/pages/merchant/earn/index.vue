<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import SlideSheet from '@/components/SlideSheet.vue';
import { useSessionStore } from '@/stores/session';
import { earnPoints, fetchMaskedMember, fetchWorkbench } from '@/services/merchant';
import { friendlyMessage } from '@/utils/errors';

const PREFIX = 'SM_MEMBER:';
const EARN_RATIO = 1;

const session = useSessionStore();
const loading = ref(true);
const storeId = ref<number | null>(null);
const errorText = ref('');
const sheetOpen = ref(false);
const memberLoading = ref(false);
const submitting = ref(false);
const member = ref<{ userId: number; name: string; phone: string } | null>(null);
const amount = ref('');
const mockOpen = ref(false);
const mockCode = ref('SM_MEMBER:');

const payAmount = computed(() => Number(amount.value));
const amountOk = computed(() => Number.isFinite(payAmount.value) && payAmount.value > 0);
const previewPoints = computed(() =>
  amountOk.value ? Math.floor(payAmount.value * EARN_RATIO) : 0,
);

function isWeb() {
  try {
    return uni.getSystemInfoSync().uniPlatform === 'web';
  } catch {
    return false;
  }
}

async function prepare() {
  loading.value = true;
  try {
    const desk = await fetchWorkbench();
    storeId.value = desk.storeId;
    errorText.value = '';
  } catch (error) {
    errorText.value = friendlyMessage(error, '门店信息没有加载出来');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function parseMemberPayload(raw: string): number | null {
  const text = String(raw || '').trim();
  if (!text.startsWith(PREFIX)) return null;
  const id = Number(text.slice(PREFIX.length));
  if (!Number.isInteger(id) || id <= 0) return null;
  return id;
}

async function openConfirm(userId: number) {
  sheetOpen.value = true;
  memberLoading.value = true;
  member.value = null;
  amount.value = '';
  errorText.value = '';
  try {
    const info = await fetchMaskedMember(userId);
    member.value = { userId: info.userId, name: info.name, phone: info.phone };
  } catch (error) {
    sheetOpen.value = false;
    uni.showToast({ title: friendlyMessage(error, '会员信息没有查到'), icon: 'none' });
  } finally {
    memberLoading.value = false;
  }
}

function handleScanResult(raw: string) {
  const userId = parseMemberPayload(raw);
  if (!userId) {
    uni.showToast({ title: '无效的会员码', icon: 'none' });
    return;
  }
  openConfirm(userId);
}

function scan() {
  if (isWeb()) {
    mockCode.value = 'SM_MEMBER:';
    mockOpen.value = true;
    return;
  }
  uni.scanCode({
    onlyFromCamera: false,
    success(res) {
      handleScanResult(res.result || '');
    },
    fail() {
      uni.showToast({ title: '扫码取消或失败', icon: 'none' });
    },
  });
}

function confirmMock() {
  mockOpen.value = false;
  handleScanResult(mockCode.value);
}

function closeSheet() {
  if (submitting.value) return;
  sheetOpen.value = false;
}

async function confirmEarn() {
  if (submitting.value || !amountOk.value || !member.value) return;
  submitting.value = true;
  errorText.value = '';
  const requestId = `SM${Date.now()}${Math.floor(Math.random() * 1000)}`.slice(0, 32);
  try {
    const earned = await earnPoints({
      userId: member.value.userId,
      amount: payAmount.value,
      requestId,
      storeId: storeId.value,
    });
    if (!earned.earned) {
      errorText.value =
        earned.message ||
        (earned.reasonCode === 'BELOW_MIN_AMOUNT' ? '金额太小，这次不发积分' : '这次没有发放积分');
      return;
    }
    try {
      uni.vibrateShort({ type: 'medium' });
    } catch {
      /* ignore */
    }
    sheetOpen.value = false;
    amount.value = '';
    member.value = null;
    uni.showToast({
      title: `积分发放成功 +${earned.points}`,
      icon: 'success',
      duration: 2200,
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
      <view class="hero">
        <text class="hero__title">扫码录单</text>
        <text class="hero__sub">扫描顾客「我的会员码」后录入消费金额并发放积分</text>
      </view>
      <button class="scan" hover-class="press" @tap="scan">扫一扫会员码</button>
      <view v-if="errorText && !sheetOpen" class="fail">{{ errorText }}</view>
    </template>

    <slide-sheet :visible="sheetOpen" @close="closeSheet">
      <view class="sheet">
        <text class="sheet__title">确认录单</text>
        <view v-if="memberLoading" class="sheet__skel" />
        <template v-else-if="member">
          <view class="member">
            <text class="member__name">{{ member.name }}</text>
            <text class="member__phone">{{ member.phone }}</text>
          </view>
          <text class="label">本次消费金额（元）</text>
          <input
            v-model="amount"
            class="field"
            type="digit"
            placeholder="请输入消费金额"
          />
          <view class="preview">
            预计发放
            <text class="preview__n">{{ previewPoints }}</text>
            积分
          </view>
          <view v-if="errorText" class="fail">{{ errorText }}</view>
          <button
            class="go"
            hover-class="press"
            :loading="submitting"
            :disabled="!amountOk || submitting"
            @tap="confirmEarn"
          >
            {{ submitting ? '正在发放…' : '确认发放' }}
          </button>
        </template>
      </view>
    </slide-sheet>

    <slide-sheet :visible="mockOpen" @close="mockOpen = false">
      <view class="sheet">
        <text class="sheet__title">模拟扫码（H5）</text>
        <text class="label">粘贴会员码内容</text>
        <input v-model="mockCode" class="field" placeholder="SM_MEMBER:用户ID" />
        <button class="go" hover-class="press" @tap="confirmMock">确认</button>
      </view>
    </slide-sheet>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  padding: 40rpx 32rpx 80rpx;
  box-sizing: border-box;
  background: linear-gradient(180deg, #dbeafe 0%, #e7eef8 45%, #f8fafc 100%);
}
.skel { height: 360rpx; border-radius: 24rpx; background: #e2e8f0; }
.hero { margin-bottom: 40rpx; }
.hero__title { display: block; font-size: 48rpx; font-weight: 800; color: #0f172a; }
.hero__sub { display: block; margin-top: 12rpx; color: #64748b; line-height: 1.5; font-size: 26rpx; }
.scan {
  height: 200rpx;
  line-height: 200rpx;
  font-size: 44rpx;
  font-weight: 800;
  color: #fff;
  background: linear-gradient(135deg, #1d4ed8, #0284c7);
  border-radius: 28rpx;
  box-shadow: 0 18rpx 40rpx rgba(29, 78, 216, 0.3);
}
.fail { color: #b91c1c; font-weight: 700; line-height: 1.5; margin-top: 20rpx; }
.sheet { padding-bottom: 24rpx; }
.sheet__title { display: block; font-size: 40rpx; font-weight: 800; margin-bottom: 24rpx; }
.sheet__skel { height: 280rpx; border-radius: 16rpx; background: #e2e8f0; }
.member {
  background: #f1f5f9;
  border-radius: 20rpx;
  padding: 24rpx;
  margin-bottom: 28rpx;
}
.member__name { display: block; font-size: 36rpx; font-weight: 800; }
.member__phone { display: block; margin-top: 8rpx; color: #64748b; }
.label { display: block; color: #64748b; margin-bottom: 12rpx; font-size: 26rpx; }
.field {
  background: #f8fafc;
  border: 2rpx solid #e2e8f0;
  border-radius: 16rpx;
  padding: 28rpx 24rpx;
  font-size: 36rpx;
  margin-bottom: 20rpx;
}
.preview {
  margin: 8rpx 0 28rpx;
  font-size: 30rpx;
  color: #334155;
}
.preview__n {
  margin: 0 8rpx;
  font-size: 48rpx;
  font-weight: 800;
  color: #1d4ed8;
}
.go {
  background: #1d4ed8;
  color: #fff;
  border-radius: 20rpx;
  font-size: 36rpx;
  font-weight: 800;
  height: 104rpx;
  line-height: 104rpx;
}
.go[disabled] { opacity: 0.45; }
</style>
