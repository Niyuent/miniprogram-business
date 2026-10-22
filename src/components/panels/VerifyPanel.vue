<script setup lang="ts">
import { ref, watch } from 'vue';
import SlideSheet from '@/components/SlideSheet.vue';
import SuccessBurst from '@/components/SuccessBurst.vue';
import { useDeskStore } from '@/stores/desk';
import { useSessionStore } from '@/stores/session';
import {
  createConsumeOrder,
  earnPoints,
  exchangeForMember,
  fetchMemberDesk,
  fetchWorkbench,
  redeemCoupon,
  verifyCoupon,
  type CouponPreview,
  type MemberDesk,
  type MemberDeskCoupon,
  type MemberDeskTemplate,
} from '@/services/merchant';
import { friendlyMessage } from '@/utils/errors';
import { promptSubscribe } from '@/utils/subscribe';

const MEMBER_PREFIX = 'SM_MEMBER:';
const EARN_RATIO = 1;

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const scanning = ref(false);
const storeId = ref<number | null>(null);
const storeName = ref('');
const bossName = ref('');
const errorText = ref('');
const mockOpen = ref(false);
const mockCode = ref('');
const drawer = ref(false);
const coupon = ref<CouponPreview | null>(null);
const code = ref('');
const amount = ref('');
const confirming = ref(false);
const success = ref(false);
const burst = ref(false);
const todayRedemptions = ref(0);
const todayPoints = ref(0);
const successHint = ref('核销成功');

const memberOpen = ref(false);
const memberLoading = ref(false);
const desk = ref<MemberDesk | null>(null);
const earnAmount = ref('');
const earning = ref(false);
const acting = ref(false);

async function prepare() {
  loading.value = true;
  try {
    const wb = await fetchWorkbench();
    storeId.value = wb.storeId;
    storeName.value = wb.storeName;
    bossName.value = wb.bossName;
    todayRedemptions.value = wb.today.redemptions;
    todayPoints.value = wb.today.pointsIssued;
    if (wb.storeId) uni.setStorageSync('mini_store_id', wb.storeId);
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
    content: '扫码要使用相机。请在设置里允许摄像头后再试。',
    confirmText: '去设置',
    success(res) {
      if (res.confirm) uni.openSetting({});
    },
  });
}

function parseMember(raw: string): number | null {
  const text = String(raw || '').trim();
  if (!text.startsWith(MEMBER_PREFIX)) return null;
  const id = Number(text.slice(MEMBER_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

function scan() {
  errorText.value = '';
  success.value = false;
  try {
    if (uni.getSystemInfoSync().uniPlatform === 'web') {
      mockOpen.value = true;
      return;
    }
  } catch {
    /* continue */
  }
  uni.scanCode({
    onlyFromCamera: false,
    success(res) {
      handleRaw((res.result || '').trim());
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
  const value = mockCode.value.trim();
  if (!value) {
    errorText.value = '请输入会员码或券码';
    return;
  }
  mockOpen.value = false;
  handleRaw(value);
}

async function handleRaw(value: string) {
  if (!value) {
    errorText.value = '没有扫到内容';
    return;
  }
  const userId = parseMember(value);
  if (userId) {
    await openMemberDesk(userId);
    return;
  }
  await inspectCoupon(value);
}

async function openMemberDesk(userId: number) {
  memberOpen.value = true;
  memberLoading.value = true;
  desk.value = null;
  earnAmount.value = '';
  errorText.value = '';
  try {
    desk.value = await fetchMemberDesk(userId);
  } catch (error) {
    memberOpen.value = false;
    errorText.value = friendlyMessage(error, '会员收银台打开失败');
  } finally {
    memberLoading.value = false;
  }
}

async function refreshDesk() {
  if (!desk.value?.member.userId) return;
  try {
    desk.value = await fetchMemberDesk(desk.value.member.userId);
  } catch {
    /* ignore */
  }
}

async function inspectCoupon(value: string) {
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

function speak(text: string) {
  const synth = (globalThis as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
  if (!synth) return;
  const utter = new SpeechSynthesisUtterance(text);
  utter.lang = 'zh-CN';
  synth.speak(utter);
}

async function confirmRedeem() {
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
    memberOpen.value = false;
    markSuccess('核销成功');
    promptSubscribe('redeem');
  } catch (error) {
    errorText.value = friendlyMessage(error, '核销没有完成');
  } finally {
    confirming.value = false;
  }
}

function markSuccess(hint: string) {
  successHint.value = hint;
  success.value = true;
  burst.value = true;
  if (hint.includes('核销')) todayRedemptions.value += 1;
  speak(hint);
}

async function onRedeemOwned(row: MemberDeskCoupon) {
  if (!row.code || acting.value) return;
  acting.value = true;
  errorText.value = '';
  try {
    await inspectCoupon(row.code);
    memberOpen.value = false;
  } finally {
    acting.value = false;
  }
}

async function onExchange(row: MemberDeskTemplate) {
  if (!desk.value || acting.value) return;
  if (desk.value.pointsAvailable < row.pointsCost) {
    uni.showToast({ title: `积分不足，还需 ${row.pointsCost - desk.value.pointsAvailable}`, icon: 'none' });
    return;
  }
  acting.value = true;
  errorText.value = '';
  try {
    const requestId = `mx${desk.value.member.userId}t${row.id}d${Date.now()}`.slice(0, 32);
    const res = await exchangeForMember({
      userId: desk.value.member.userId,
      templateId: row.id,
      requestId,
    });
    await refreshDesk();
    if (res.code) {
      uni.showModal({
        title: '兑换成功',
        content: `已兑「${row.name}」。是否立即核销？`,
        confirmText: '立即核销',
        success: async (r) => {
          if (r.confirm && res.code) {
            memberOpen.value = false;
            await inspectCoupon(res.code);
          }
        },
      });
    } else {
      uni.showToast({ title: '兑换成功', icon: 'success' });
    }
  } catch (error) {
    uni.showToast({ title: friendlyMessage(error, '兑换失败'), icon: 'none' });
  } finally {
    acting.value = false;
  }
}

async function onEarn() {
  if (!desk.value || earning.value) return;
  const pay = Number(earnAmount.value);
  if (!Number.isFinite(pay) || pay <= 0) {
    uni.showToast({ title: '请填写消费金额', icon: 'none' });
    return;
  }
  earning.value = true;
  try {
    const orderNo = `SM${Date.now()}`;
    const order = await createConsumeOrder({
      orderNo,
      userId: desk.value.member.userId,
      storeId: storeId.value,
      totalAmount: pay,
    });
    const earned = await earnPoints({
      userId: desk.value.member.userId,
      amount: pay,
      orderId: order.order.id,
      requestId: orderNo,
      storeId: storeId.value,
    });
    const pts = earned.points || Math.floor(pay * EARN_RATIO);
    todayPoints.value += pts;
    await refreshDesk();
    earnAmount.value = '';
    markSuccess(`已发积分 +${pts}`);
    promptSubscribe('redeem');
  } catch (error) {
    uni.showToast({ title: friendlyMessage(error, '发积分失败'), icon: 'none' });
  } finally {
    earning.value = false;
  }
}

const deskStore = useDeskStore();
watch(() => deskStore.pull, () => { if (props.active) prepare(); });
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
    <view class="nav">
      <view class="pill">
        <view class="dot" />
        <text>核销台 · {{ bossName || storeName || '店员' }}</text>
      </view>
    </view>

    <view v-if="loading" class="skel" />
    <template v-else>
      <view class="scan-box" @tap="scan">
        <view class="viewfinder">
          <view class="corner c1" />
          <view class="corner c2" />
          <view class="corner c3" />
          <view class="corner c4" />
          <view class="laser" />
          <text class="scan-hint">{{ scanning ? '正在识别…' : '点此扫码' }}</text>
        </view>
        <view class="scan-tip">扫会员码：发积分 / 选券核销 / 兑券</view>
        <view class="scan-sub">也可直接扫代金券码核销</view>
      </view>

      <view class="scan-acts">
        <view class="act" @tap="mockOpen = true">手输码</view>
        <view class="act" @tap="scan">开灯扫码</view>
      </view>

      <view v-if="errorText" class="fail">{{ errorText }}</view>
      <view v-if="success" class="ok">{{ successHint }}，可继续扫下一张</view>

      <view class="card">
        <view class="flow">
          <view class="av">核</view>
          <view class="flow__main">
            <view class="n">今日已成功核销</view>
            <view class="d">扫券码或会员选券</view>
          </view>
          <view class="amt"><text class="b">{{ todayRedemptions }}</text><text class="s">笔</text></view>
        </view>
        <view class="flow">
          <view class="av">分</view>
          <view class="flow__main">
            <view class="n">今日已发放积分</view>
            <view class="d">扫会员码录单</view>
          </view>
          <view class="amt"><text class="b">{{ todayPoints }}</text><text class="s">分</text></view>
        </view>
      </view>
    </template>

    <slide-sheet :visible="mockOpen" @close="mockOpen = false">
      <view class="sheet__title">输入会员码或券码</view>
      <input v-model="mockCode" class="field" placeholder="SM_MEMBER:1001 或券码" />
      <button class="sheet-go" hover-class="press" :loading="scanning" @tap="submitMock">确认</button>
    </slide-sheet>

    <slide-sheet :visible="drawer" @close="drawer = false">
      <view class="sheet__title">{{ coupon?.templateName || '代金券' }}</view>
      <view class="face">¥{{ coupon?.faceValue }}</view>
      <view class="meta">顾客 {{ coupon?.userPhone || '未登记' }} · 门槛 ¥{{ coupon?.thresholdAmount || 0 }}</view>
      <input v-model="amount" class="field" type="digit" placeholder="本次订单实付金额" />
      <button class="sheet-go" hover-class="press" :loading="confirming" @tap="confirmRedeem">
        {{ confirming ? '正在核销…' : '确认核销' }}
      </button>
    </slide-sheet>

    <slide-sheet :visible="memberOpen" @close="memberOpen = false">
      <view v-if="memberLoading" class="meta">正在读取会员…</view>
      <template v-else-if="desk">
        <view class="sheet__title">{{ desk.member.name }}</view>
        <view class="meta">{{ desk.member.phone }} · 可用积分 {{ desk.pointsAvailable }}</view>

        <view class="block">
          <view class="block__t">发积分</view>
          <view class="row">
            <input v-model="earnAmount" class="field flex" type="digit" placeholder="消费金额（元）" />
            <button class="mini-go" :loading="earning" @tap="onEarn">发放</button>
          </view>
        </view>

        <view class="block">
          <view class="block__t">会员可用券（{{ desk.coupons.length }}）</view>
          <view v-if="!desk.coupons.length" class="empty">暂无可用券，可从下方兑一张</view>
          <view
            v-for="item in desk.coupons"
            :key="item.id"
            class="coupon"
            @tap="onRedeemOwned(item)"
          >
            <view>
              <view class="coupon__n">{{ item.name }}</view>
              <view class="coupon__d">面额 ¥{{ item.faceValue }} · 门槛 ¥{{ item.thresholdAmount }}</view>
            </view>
            <text class="coupon__act">核销</text>
          </view>
        </view>

        <view class="block">
          <view class="block__t">本店可兑券</view>
          <view v-if="!desk.exchangeTemplates.length" class="empty">暂无可积分兑换的券</view>
          <view
            v-for="item in desk.exchangeTemplates"
            :key="item.id"
            class="coupon"
            @tap="onExchange(item)"
          >
            <view>
              <view class="coupon__n">{{ item.name }}</view>
              <view class="coupon__d">
                ¥{{ item.faceValue }} · {{ item.pointsCost }} 积分 · 余 {{ item.remainingStock }}
              </view>
            </view>
            <text class="coupon__act">兑换</text>
          </view>
        </view>
      </template>
    </slide-sheet>

    <success-burst :visible="burst" :text="successHint" @done="burst = false" />
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 12rpx 32rpx 220rpx; box-sizing: border-box; background: #f3f7f8; }
.nav { margin-bottom: 16rpx; }
.pill {
  display: inline-flex; align-items: center; gap: 12rpx;
  background: #fff; border: 1px solid #eaf0f2; padding: 14rpx 24rpx;
  border-radius: 999rpx; font-size: 26rpx; font-weight: 600;
}
.dot { width: 14rpx; height: 14rpx; border-radius: 50%; background: #00b8a0; box-shadow: 0 0 0 6rpx rgba(0,184,160,.18); }
.scan-box {
  margin-top: 12rpx; background: #0e1f26; border-radius: 48rpx; padding: 40rpx 28rpx 32rpx;
  display: flex; flex-direction: column; align-items: center;
}
.viewfinder {
  position: relative; width: 420rpx; height: 420rpx; border-radius: 28rpx;
  background: rgba(255,255,255,.06); display: flex; align-items: center; justify-content: center;
}
.corner { position: absolute; width: 48rpx; height: 48rpx; border-color: #00b8a0; border-style: solid; }
.c1 { left: 16rpx; top: 16rpx; border-width: 6rpx 0 0 6rpx; border-radius: 8rpx 0 0 0; }
.c2 { right: 16rpx; top: 16rpx; border-width: 6rpx 6rpx 0 0; border-radius: 0 8rpx 0 0; }
.c3 { left: 16rpx; bottom: 16rpx; border-width: 0 0 6rpx 6rpx; border-radius: 0 0 0 8rpx; }
.c4 { right: 16rpx; bottom: 16rpx; border-width: 0 6rpx 6rpx 0; border-radius: 0 0 8rpx 0; }
.laser {
  position: absolute; left: 40rpx; right: 40rpx; height: 4rpx; top: 40%;
  background: linear-gradient(90deg, transparent, #00d6b2, transparent);
  animation: laser 1.8s ease-in-out infinite;
}
@keyframes laser {
  0% { top: 18%; opacity: .3; }
  50% { top: 72%; opacity: 1; }
  100% { top: 18%; opacity: .3; }
}
.scan-hint { color: rgba(255,255,255,.7); font-size: 28rpx; font-weight: 700; }
.scan-tip { margin-top: 28rpx; color: #fff; font-size: 28rpx; font-weight: 700; }
.scan-sub { margin-top: 8rpx; color: rgba(255,255,255,.55); font-size: 22rpx; }
.scan-acts { display: flex; gap: 16rpx; margin-top: 20rpx; }
.act {
  flex: 1; text-align: center; padding: 20rpx 0; background: #fff; border-radius: 999rpx;
  color: #33454f; font-size: 24rpx; font-weight: 600; border: 1px solid #eaf0f2;
}
.card {
  margin-top: 20rpx; background: #fff; border-radius: 40rpx; padding: 8rpx 24rpx;
  box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.06);
}
.flow { display: flex; align-items: center; gap: 16rpx; padding: 24rpx 0; border-bottom: 1px solid #eaf0f2; }
.flow:last-child { border-bottom: none; }
.av {
  width: 72rpx; height: 72rpx; border-radius: 22rpx; background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center; font-weight: 800;
}
.flow__main { flex: 1; min-width: 0; }
.n { font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.d { margin-top: 4rpx; color: #8a9aa3; font-size: 22rpx; }
.amt { text-align: right; }
.b { font-size: 32rpx; font-weight: 800; color: #0e1f26; }
.s { margin-left: 4rpx; color: #8a9aa3; font-size: 22rpx; }
.fail { margin-top: 20rpx; color: #c22a2e; font-weight: 700; text-align: center; }
.ok { margin-top: 20rpx; color: #009784; font-weight: 700; text-align: center; }
.skel { height: 520rpx; border-radius: 48rpx; background: #e2eaee; }
.sheet__title { font-size: 32rpx; font-weight: 700; }
.face { margin-top: 12rpx; font-size: 64rpx; font-weight: 800; color: #00b8a0; }
.meta { margin-top: 8rpx; color: #8a9aa3; font-size: 24rpx; }
.field {
  background: #f3f7f8; border-radius: 999rpx; padding: 20rpx 28rpx;
  border: 1px solid #eaf0f2; font-size: 26rpx; margin-top: 16rpx;
}
.field.flex { flex: 1; margin-top: 0; }
.sheet-go {
  margin-top: 24rpx; background: #0e1f26; color: #fff; border-radius: 999rpx; font-weight: 700;
}
.block { margin-top: 28rpx; }
.block__t { font-size: 28rpx; font-weight: 800; color: #0e1f26; margin-bottom: 12rpx; }
.row { display: flex; gap: 12rpx; align-items: center; }
.mini-go {
  margin: 0; padding: 0 28rpx; height: 76rpx; line-height: 76rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff;
  border-radius: 999rpx; font-weight: 700; font-size: 26rpx;
}
.coupon {
  display: flex; align-items: center; justify-content: space-between; gap: 16rpx;
  padding: 20rpx 0; border-top: 1px solid #eaf0f2;
}
.coupon__n { font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.coupon__d { margin-top: 4rpx; font-size: 22rpx; color: #8a9aa3; }
.coupon__act { color: #009784; font-weight: 800; font-size: 24rpx; flex-shrink: 0; }
.empty { color: #8a9aa3; font-size: 24rpx; padding: 8rpx 0 4rpx; }
</style>
