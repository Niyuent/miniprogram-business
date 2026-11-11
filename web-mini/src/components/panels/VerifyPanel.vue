<script setup lang="ts">
import { ref, watch } from 'vue';
import SlideSheet from '@/components/SlideSheet.vue';
import SuccessBurst from '@/components/SuccessBurst.vue';
import { useDeskStore } from '@/stores/desk';
import { useSessionStore } from '@/stores/session';
import {
  exchangeForMember,
  fetchMemberDesk,
  fetchMerchantAlliances,
  fetchWorkbench,
  redeemCoupon,
  toScannedMember,
  verifyCoupon,
  type CouponPreview,
  type MemberDesk,
  type MemberDeskCoupon,
  type MemberDeskTemplate,
  type MerchantAllianceItem,
} from '@/services/merchant';
import { earnWithOrder } from '@/services/earn';
import { confirmEarn, proposeEarn, type EarnProposal } from '@/services/ai-assist';
import { friendlyMessage } from '@/utils/errors';
import { genOrderNo, genRequestId } from '@/utils/idem';
import { promptSubscribe } from '@/utils/subscribe';
import { disposeDing, playDing } from '@/utils/sound';
import type { ScannedMember } from '@/utils/memberQr';

/** 收银高峰的常用金额，点一下直接填入，省掉手输。 */
const AMOUNT_PRESETS = [10, 20, 50, 100, 200];

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const scanning = ref(false);
const storeId = ref<number | null>(null);
const merchantId = ref<number | null>(null);
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
/** 本次确认的幂等键：开抽屉时生成，成功后清空；重试复用同键，后端返回首次结果而非 409 */
const redeemKey = ref('');
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
const alliancePickOpen = ref(false);
const allianceOptions = ref<MerchantAllianceItem[]>([]);
const pendingEarnPay = ref(0);

/** AI 协同发分：建议卡。金额一变立即作废，绝不用旧票据发新金额。 */
const proposal = ref<EarnProposal | null>(null);
const proposing = ref(false);
const proposalFor = ref(0);
let proposeTimer: ReturnType<typeof setTimeout> | null = null;
/** 联盟列表缓存：同一收银会话内不重复请求 */
let allianceCache: MerchantAllianceItem[] | null = null;
/** 多联盟时记住上次选的联盟，供建议卡预判 */
const lastAllianceId = ref(0);

/** 本机最近核销记录：连续扫十几单后，店员要能回看刚才扫了什么。 */
type RecentRecord = {
  id: number;
  kind: 'redeem' | 'earn';
  title: string;
  detail: string;
  at: string;
};
const recentOpen = ref(false);
const recent = ref<RecentRecord[]>([]);
let recordSeq = 0;

function clockText() {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function pushRecord(rec: Omit<RecentRecord, 'id' | 'at'>) {
  recordSeq += 1;
  recent.value = [{ ...rec, id: recordSeq, at: clockText() }, ...recent.value].slice(0, 5);
}

async function prepare() {
  loading.value = true;
  try {
    const wb = await fetchWorkbench();
    storeId.value = wb.storeId;
    merchantId.value = wb.merchantId;
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
  const member = toScannedMember(value);
  if (member) {
    await openMemberDesk(member);
    return;
  }
  await inspectCoupon(value);
}

let lastMember: ScannedMember | null = null;

async function openMemberDesk(member: ScannedMember) {
  memberOpen.value = true;
  memberLoading.value = true;
  desk.value = null;
  earnAmount.value = '';
  errorText.value = '';
  lastMember = member;
  try {
    desk.value = await fetchMemberDesk(member);
  } catch (error) {
    memberOpen.value = false;
    errorText.value = friendlyMessage(error, '会员收银台打开失败');
  } finally {
    memberLoading.value = false;
  }
}

async function refreshDesk() {
  const userId = desk.value?.member.userId;
  if (!userId) return;
  try {
    // 刷新走 userId（已从收银台拿到），避免票据恰好过期
    desk.value = await fetchMemberDesk({ userId });
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
    redeemKey.value = genRequestId();
    drawer.value = true;
  } catch (error) {
    drawer.value = false;
    errorText.value = friendlyMessage(error, '这张券现在不能核销');
  } finally {
    scanning.value = false;
  }
}

/** 成功反馈用震动：小程序没有 Web Speech API，语音播报在真机是静默失效的。 */
function buzz() {
  try {
    uni.vibrateShort({ type: 'medium' });
  } catch {
    /* H5 / 低版本忽略 */
  }
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
  if (!redeemKey.value) redeemKey.value = genRequestId();
  const orderNo = genOrderNo();
  try {
    await verifyCoupon({ code: code.value, storeId: storeId.value, orderAmount: pay, orderNo });
    await redeemCoupon({
      code: code.value,
      storeId: storeId.value,
      orderAmount: pay,
      orderNo,
      requestId: redeemKey.value,
    });
    redeemKey.value = '';
    drawer.value = false;
    memberOpen.value = false;
    pushRecord({
      kind: 'redeem',
      title: coupon.value?.templateName || '代金券',
      detail: `实付 ¥${pay} · 面额 ¥${coupon.value?.faceValue ?? 0}`,
    });
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
  buzz();
  playDing();
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
    // 联盟列表拉不到就中断：绝不静默兜底到默认联盟，避免扣错积分池
    const alliances = await resolveAlliances();
    if (!alliances.length) {
      uni.showToast({ title: '没查到本店联盟，请稍后重试', icon: 'none' });
      return;
    }
    const allianceId = alliances[0].allianceId;
    const res = await exchangeForMember({
      userId: desk.value.member.userId,
      allianceId,
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

async function resolveAlliances(force = false): Promise<MerchantAllianceItem[]> {
  if (!merchantId.value) throw new Error('未绑定商家');
  if (!force && allianceCache) return allianceCache;
  const data = await fetchMerchantAlliances(merchantId.value);
  allianceCache = data.items || [];
  return allianceCache;
}

function clearProposal() {
  proposal.value = null;
  proposalFor.value = 0;
}

/**
 * 金额变化后自动核算，让店员在按下发分前就看到「应发多少分 / 有什么风险」。
 * 建议只是增强：任何失败都静默退回手动发放，不打断收银节奏。
 *
 * 并发用序号收口：连续改金额时，只有最后一次请求的结果会被采纳，
 * 避免「先发出的旧请求」把新金额的建议覆盖掉。
 */
let proposeSeq = 0;

async function requestProposal() {
  if (!desk.value) return;
  const pay = Number(earnAmount.value);
  if (!Number.isFinite(pay) || pay <= 0) {
    clearProposal();
    return;
  }
  const seq = ++proposeSeq;
  proposing.value = true;
  try {
    const items = await resolveAlliances();
    if (seq !== proposeSeq) return;
    if (!items.length) {
      clearProposal();
      return;
    }
    let target = items[0];
    if (items.length > 1) {
      // 多联盟不预判：只有店员上次选过，才拿它出建议，避免把分记到错的池子
      const remembered = items.find((it) => it.allianceId === lastAllianceId.value);
      if (!remembered) {
        clearProposal();
        return;
      }
      target = remembered;
    }
    const res = await proposeEarn({
      userId: desk.value.member.userId,
      amount: pay,
      allianceId: target.allianceId,
      storeId: storeId.value,
    });
    // 已被更新的请求取代，或金额已改 → 丢弃
    if (seq !== proposeSeq || Number(earnAmount.value) !== pay) return;
    proposal.value = res;
    proposalFor.value = pay;
  } catch {
    if (seq === proposeSeq) clearProposal();
  } finally {
    if (seq === proposeSeq) proposing.value = false;
  }
}

/** 主按钮：有有效建议走确认入账，否则走原有手动发放 */
function onPrimaryEarn() {
  if (proposal.value && !proposal.value.blocked && proposalFor.value === Number(earnAmount.value)) {
    void onConfirmProposal();
    return;
  }
  void onEarn();
}

async function onConfirmProposal() {
  if (!desk.value || earning.value) return;
  const p = proposal.value;
  if (!p) return;
  if (Number(earnAmount.value) !== proposalFor.value) {
    clearProposal();
    uni.showToast({ title: '金额已改动，请重新确认建议', icon: 'none' });
    return;
  }

  earning.value = true;
  try {
    const res = await confirmEarn(p.token);
    if (!res.earned) {
      uni.showToast({ title: res.message || '这次没有发放积分', icon: 'none' });
      clearProposal();
      return;
    }
    const memberName = desk.value.member.name;
    todayPoints.value += res.points;
    await refreshDesk();
    earnAmount.value = '';
    pendingEarnPay.value = 0;
    alliancePickOpen.value = false;
    clearProposal();
    pushRecord({
      kind: 'earn',
      title: memberName,
      detail: `消费 ¥${p.amount} · +${res.points} 分`,
    });
    const tag = res.allianceName || p.allianceName || '';
    const suffix = res.idempotent ? '（此前已发放）' : '';
    markSuccess(tag ? `已发积分 +${res.points} [${tag}]${suffix}` : `已发积分 +${res.points}${suffix}`);
    promptSubscribe('redeem');
  } catch (error) {
    const msg = friendlyMessage(error, '发积分失败');
    // 只有票据过期/失效才作废。网络类失败保留票据——同票据重试是幂等的，不会重复入账。
    if (/过期|失效/.test(msg)) clearProposal();
    uni.showToast({ title: msg, icon: 'none' });
  } finally {
    earning.value = false;
  }
}

watch(earnAmount, (val) => {
  clearProposal();
  if (proposeTimer) clearTimeout(proposeTimer);
  const pay = Number(val);
  if (!Number.isFinite(pay) || pay <= 0) return;
  proposeTimer = setTimeout(() => {
    void requestProposal();
  }, 400);
});

/** 换会员就必须换建议与金额，否则会把上一位的核算结果套到新会员身上 */
watch(desk, () => {
  clearProposal();
  earnAmount.value = '';
});

async function submitEarn(allianceId: number, allianceName?: string) {
  if (!desk.value) return;
  const pay = pendingEarnPay.value || Number(earnAmount.value);
  earning.value = true;
  try {
    // 与 earn 页同一条链路：先建消费订单，再发分（services/earn.ts）
    const outcome = await earnWithOrder({
      userId: desk.value.member.userId,
      amount: pay,
      allianceId,
      storeId: storeId.value,
    });
    if (!outcome.earned) {
      uni.showToast({
        title:
          outcome.message ||
          (outcome.reasonCode === 'BELOW_MIN_AMOUNT' ? '金额太小，这次不发积分' : '这次没有发放积分'),
        icon: 'none',
      });
      return;
    }
    todayPoints.value += outcome.points;
    lastAllianceId.value = allianceId;
    const memberName = desk.value.member.name;
    await refreshDesk();
    earnAmount.value = '';
    clearProposal();
    pendingEarnPay.value = 0;
    alliancePickOpen.value = false;
    pushRecord({
      kind: 'earn',
      title: memberName,
      detail: `消费 ¥${pay} · +${outcome.points} 分`,
    });
    const tag = outcome.allianceName || allianceName || '';
    markSuccess(tag ? `已发积分 +${outcome.points} [${tag}]` : `已发积分 +${outcome.points}`);
    promptSubscribe('redeem');
  } catch (error) {
    uni.showToast({ title: friendlyMessage(error, '发积分失败'), icon: 'none' });
  } finally {
    earning.value = false;
  }
}

async function onEarn() {
  if (!desk.value || earning.value) return;
  const pay = Number(earnAmount.value);
  if (!Number.isFinite(pay) || pay <= 0) {
    uni.showToast({ title: '请填写消费金额', icon: 'none' });
    return;
  }
  pendingEarnPay.value = pay;
  earning.value = true;
  try {
    const items = await resolveAlliances();
    if (!items.length) {
      uni.showToast({ title: '本店未加入联盟', icon: 'none' });
      earning.value = false;
      return;
    }
    if (items.length === 1) {
      await submitEarn(items[0].allianceId, items[0].name);
      return;
    }
    allianceOptions.value = items;
    alliancePickOpen.value = true;
    earning.value = false;
  } catch (error) {
    earning.value = false;
    uni.showToast({ title: friendlyMessage(error, '获取联盟失败'), icon: 'none' });
  }
}

function pickVerifyAlliance(item: MerchantAllianceItem) {
  submitEarn(item.allianceId, item.name);
}

const deskStore = useDeskStore();
watch(() => deskStore.pull, () => { if (props.active) prepare(); });
watch(
  () => props.active,
  (on) => {
    if (!on) {
      disposeDing();
      return;
    }
    session.hydrate();
    prepare();
  },
  { immediate: true },
);
</script>

<template>
  <view class="pm-page">
    <view class="pm-hero">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="nav">
          <view class="store-chip">
            <view class="pm-hero__dot" />
            <text class="store-chip__t">{{ bossName || storeName || '店员' }}</text>
          </view>
          <text class="nav-count">今日 {{ todayRedemptions }} 笔 · {{ todayPoints }} 分</text>
        </view>

        <view class="vf" :class="{ 'vf--busy': scanning }" hover-class="press" @tap="scan">
          <view class="vf__grid" />
          <view class="vf__corner vf__corner--tl" />
          <view class="vf__corner vf__corner--tr" />
          <view class="vf__corner vf__corner--bl" />
          <view class="vf__corner vf__corner--br" />
          <view class="laser" />
          <view class="vf__qr">
            <view class="vf__qr-eye vf__qr-eye--tl" />
            <view class="vf__qr-eye vf__qr-eye--tr" />
            <view class="vf__qr-eye vf__qr-eye--bl" />
            <view class="vf__qr-dot" />
          </view>
          <text class="vf__hint">{{ scanning ? '正在识别…' : '点此扫码' }}</text>
          <text class="vf__sub">会员码 / 代金券码</text>
        </view>

        <view class="scan-acts">
          <view class="scan-act" hover-class="press" @tap="mockOpen = true">手输码</view>
          <view class="scan-act" hover-class="press" @tap="recentOpen = true">
            最近核销{{ recent.length ? ` ${recent.length}` : '' }}
          </view>
        </view>
      </view>
    </view>

    <view class="pm-body">
      <view v-if="errorText" class="pm-card fail">
        <text class="fail__t">{{ errorText }}</text>
      </view>
      <view v-if="success" class="pm-card ok">
        <text class="ok__t">{{ successHint }}</text>
        <text class="ok__d">可以继续扫下一张</text>
      </view>

      <view v-if="loading" class="pm-card">
        <view class="pm-skel" style="height: 120rpx" />
      </view>
      <template v-else>
        <view class="pm-card stats-card">
          <view class="pm-stats">
            <view class="pm-stat">
              <view class="pm-stat__v">{{ todayRedemptions }}</view>
              <view class="pm-stat__l">今日核销</view>
            </view>
            <view class="pm-stat">
              <view class="pm-stat__v">{{ todayPoints }}</view>
              <view class="pm-stat__l">今日发分</view>
            </view>
            <view class="pm-stat" hover-class="press" @tap="recentOpen = true">
              <view class="pm-stat__v">{{ recent.length }}</view>
              <view class="pm-stat__l">本机记录</view>
            </view>
          </view>
          <view class="stats-foot">扫会员码可发积分、选券核销或积分兑券</view>
        </view>
      </template>
    </view>

    <slide-sheet :visible="mockOpen" @close="mockOpen = false">
      <view class="sheet__title">输入会员码或券码</view>
      <input v-model="mockCode" class="field" placeholder="SM_MEMBER:1001 或券码" />
      <button class="sheet-go" hover-class="press" :loading="scanning" @tap="submitMock">确认</button>
    </slide-sheet>

    <slide-sheet :visible="recentOpen" @close="recentOpen = false">
      <view class="sheet__title">最近核销</view>
      <view class="meta">只保留本机最近 5 笔，退出小程序后清空</view>
      <view v-if="!recent.length" class="empty">今天还没有核销记录</view>
      <view v-for="item in recent" :key="item.id" class="coupon">
        <view>
          <view class="coupon__n">{{ item.title }}</view>
          <view class="coupon__d">{{ item.detail }}</view>
        </view>
        <text class="coupon__act">{{ item.at }}</text>
      </view>
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
            <button
              class="mini-go"
              :class="{ 'mini-go--off': proposal && proposal.blocked }"
              :loading="earning"
              :disabled="!!(proposal && proposal.blocked)"
              @tap="onPrimaryEarn"
            >{{ proposal ? (proposal.blocked ? '不可发分' : '确认') : '发放' }}</button>
          </view>
          <view class="quick-amt">
            <text
              v-for="preset in AMOUNT_PRESETS"
              :key="preset"
              class="chip"
              :class="{ on: earnAmount === String(preset) }"
              @tap="earnAmount = String(preset)"
            >¥{{ preset }}</text>
          </view>

          <view v-if="proposing" class="assist__loading">正在核算应发积分…</view>
          <view v-else-if="proposal" class="assist" :class="{ 'assist--blocked': proposal.blocked }">
            <view class="assist__top">
              <text class="assist__badge">AI 核算</text>
              <text v-if="!proposal.blocked" class="assist__points">+{{ proposal.points }} 分</text>
              <text v-else class="assist__points assist__points--no">不发分</text>
            </view>
            <view class="assist__text">{{ proposal.suggestion }}</view>
            <view
              v-for="(risk, i) in proposal.risks"
              :key="i"
              class="assist__risk"
              :class="`assist__risk--${risk.level}`"
            >{{ risk.text }}</view>
            <view v-if="!proposal.blocked" class="assist__foot">
              会员现有 {{ proposal.member.pointsAvailable }} 分，发完约
              {{ proposal.member.pointsAvailable + proposal.points }} 分
            </view>
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

    <slide-sheet :visible="alliancePickOpen" @close="alliancePickOpen = false">
      <view class="sheet__title">请选择发放联盟</view>
      <view class="meta">本店属于多个联盟，积分将记入所选联盟池</view>
      <view
        v-for="item in allianceOptions"
        :key="item.allianceId"
        class="coupon"
        @tap="pickVerifyAlliance(item)"
      >
        <view>
          <view class="coupon__n">{{ item.name }}</view>
          <view class="coupon__d">本店角色 {{ item.role === 'MAIN' ? '可管理' : '成员' }}</view>
        </view>
        <text class="coupon__act">选择</text>
      </view>
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
/* 扫描光带：上方渐隐拖尾 + 底部亮线，纵向往复 */
.laser {
  position: absolute; left: 32rpx; right: 32rpx; height: 56rpx; top: -6%;
  z-index: 2; pointer-events: none;
  background: linear-gradient(180deg, rgba(0, 214, 178, 0), rgba(0, 214, 178, 0.34) 70%, rgba(127, 243, 224, 0.85));
  border-bottom: 2rpx solid rgba(127, 243, 224, 0.95);
  animation: laser 2.8s ease-in-out infinite;
}
@keyframes laser {
  0% { top: -6%; opacity: 0.25; }
  50% { top: 78%; opacity: 1; }
  100% { top: -6%; opacity: 0.25; }
}
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
.quick-amt { display: flex; gap: 12rpx; margin-top: 14rpx; flex-wrap: wrap; }
.chip {
  padding: 10rpx 24rpx; border-radius: 999rpx; background: #f1f5f7;
  color: #33454f; font-size: 24rpx; font-weight: 700; border: 1px solid #eaf0f2;
}
.chip.on { background: #e8fbf7; color: #00766a; border-color: #00d6b2; }

/* AI 协同发分建议卡：突出「发多少」，风险与上下文退到次级 */
.mini-go--off {
  background: #eef2f4; color: #93a3ab;
}
.assist__loading {
  margin-top: 14rpx; font-size: 22rpx; color: #8a9aa3;
}
.assist {
  margin-top: 14rpx; padding: 18rpx 20rpx; border-radius: 18rpx;
  background: #f2fbf9; border: 1px solid #cdeee7;
}
.assist--blocked { background: #fff7f2; border-color: #f6ddcd; }
.assist__top { display: flex; align-items: baseline; gap: 12rpx; }
.assist__badge {
  font-size: 20rpx; font-weight: 800; letter-spacing: 1rpx;
  color: #009784; background: #d9f5ef; padding: 4rpx 12rpx; border-radius: 999rpx;
}
.assist--blocked .assist__badge { color: #b26a2e; background: #fbe6d6; }
.assist__points { font-size: 30rpx; font-weight: 800; color: #00766a; }
.assist__points--no { color: #b26a2e; }
.assist__text { margin-top: 10rpx; font-size: 23rpx; line-height: 1.5; color: #33454f; }
.assist__risk {
  margin-top: 8rpx; font-size: 22rpx; line-height: 1.45; padding-left: 14rpx;
  border-left: 4rpx solid #d8e3e6; color: #67787f;
}
.assist__risk--warn { border-left-color: #f0a35e; color: #a4611f; }
.assist__risk--info { border-left-color: #7fc9bd; color: #3f6f68; }
.assist__foot { margin-top: 10rpx; font-size: 21rpx; color: #8a9aa3; }

/* ---------- 新首屏（深色） ---------- */
.nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0; }
.store-chip {
  display: inline-flex; align-items: center; gap: 10rpx;
  padding: 8rpx 20rpx; border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.1);
  border: 1rpx solid rgba(255, 255, 255, 0.16);
}
.store-chip__t { font-size: 20rpx; color: #d8f7f1; }
.nav-count { font-size: 20rpx; color: rgba(255, 255, 255, 0.5); }

.vf {
  position: relative; overflow: hidden;
  margin-top: 26rpx; height: 300rpx;
  border-radius: 32rpx;
  background:
    radial-gradient(120% 92% at 50% 0%, rgba(0, 214, 178, 0.2), transparent 64%),
    linear-gradient(160deg, #0b3f4b, #0a2233 74%);
  border: 1rpx solid rgba(255, 255, 255, 0.14);
  box-shadow: inset 0 0 70rpx rgba(4, 22, 30, 0.6);
  display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 10rpx;
}

/* 网格底纹：渐变 + background-size 平铺，比 repeating-linear 兼容性稳 */
.vf__grid {
  position: absolute; left: 0; right: 0; top: 0; bottom: 0; z-index: 0;
  background-image:
    linear-gradient(to right, rgba(0, 214, 178, 0.14) 1rpx, transparent 1rpx),
    linear-gradient(to bottom, rgba(0, 214, 178, 0.14) 1rpx, transparent 1rpx);
  background-size: 26rpx 26rpx;
}

.vf__corner {
  position: absolute; width: 34rpx; height: 34rpx;
  border: 3rpx solid #00d6b2;
  box-shadow: 0 0 14rpx rgba(0, 214, 178, 0.5);
  z-index: 3;
}
.vf__corner--tl { left: 26rpx; top: 26rpx; border-right: none; border-bottom: none; border-radius: 12rpx 0 0 0; }
.vf__corner--tr { right: 26rpx; top: 26rpx; border-left: none; border-bottom: none; border-radius: 0 12rpx 0 0; }
.vf__corner--bl { left: 26rpx; bottom: 26rpx; border-right: none; border-top: none; border-radius: 0 0 0 12rpx; }
.vf__corner--br { right: 26rpx; bottom: 26rpx; border-left: none; border-top: none; border-radius: 0 0 12rpx 0; }

/* 二维码线框：三个定位角 + 一颗数据点 */
.vf__qr { position: relative; width: 56rpx; height: 56rpx; z-index: 4; }
.vf__qr-eye {
  position: absolute; width: 18rpx; height: 18rpx;
  border: 2rpx solid rgba(0, 214, 178, 0.9);
  border-radius: 5rpx;
}
.vf__qr-eye--tl { left: 0; top: 0; }
.vf__qr-eye--tr { right: 0; top: 0; }
.vf__qr-eye--bl { left: 0; bottom: 0; }
.vf__qr-dot {
  position: absolute; right: 7rpx; bottom: 7rpx;
  width: 8rpx; height: 8rpx; border-radius: 2rpx;
  background: #00d6b2;
  box-shadow: 0 0 10rpx rgba(0, 214, 178, 0.95);
}

.vf__hint { position: relative; z-index: 4; font-size: 30rpx; font-weight: 700; color: #fff; }
.vf__sub { position: relative; z-index: 4; font-size: 20rpx; color: rgba(255, 255, 255, 0.45); }

/* 识别中：光带提速、角标增亮 */
.vf--busy .laser { animation-duration: 1.1s; }
.vf--busy .vf__corner { border-color: #7ff3e0; box-shadow: 0 0 22rpx rgba(127, 243, 224, 0.85); }
.vf--busy .vf__hint { color: #7ff0dd; }

.scan-acts { display: flex; gap: 20rpx; margin-top: 22rpx; }
.scan-act {
  flex: 1; text-align: center; padding: 18rpx 0; border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.1);
  border: 1rpx solid rgba(255, 255, 255, 0.16);
  color: #d8f7f1; font-size: 24rpx;
}

/* ---------- 新内容区 ---------- */
.stats-card { padding: 30rpx 16rpx 22rpx; }
.stats-foot {
  margin-top: 20rpx; padding-top: 18rpx; border-top: 1rpx solid #f2f6f7;
  text-align: center; font-size: 20rpx; color: #b3c0c7;
}
.ok { border-left: 4rpx solid #00d6b2; }
.ok__t { display: block; font-size: 26rpx; font-weight: 700; color: #00766a; }
.ok__d { display: block; margin-top: 6rpx; font-size: 22rpx; color: #8a9aa3; }
.fail { text-align: left; border-left: 4rpx solid #f5484d; }
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.55; }
</style>
