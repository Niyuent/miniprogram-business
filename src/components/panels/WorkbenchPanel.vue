<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSessionStore } from '@/stores/session';
import { fetchFinance, fetchWorkbench, type FinanceCheckup, type WorkbenchData } from '@/services/merchant';
import { friendlyMessage } from '@/utils/errors';
import SlideSheet from '@/components/SlideSheet.vue';
import { useDeskStore } from '@/stores/desk';
import { applyPageUrl, enableShareMenu, merchantInviteCode } from '@/utils/share';
import { readSticky, writeSticky } from '@/utils/sticky';
import { localMorningCopy, zeroBriefing } from '@/services/xiao-z';

const CARD_KEY = 'mini_workbench_card';
const RULE_TEXT = '把这张卡片发给其他老板，对方打开后进入入驻申请页。';

type WorkbenchCard = {
  greeting: string;
  bossName: string;
  storeName: string;
  merchantName: string;
  merchantId: number;
  storeId: number | null;
  avatar: string;
  rule: string;
  today: { redemptions: number; pointsIssued: number };
  finance: FinanceCheckup | null;
  headline: string;
  advice: string;
};

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const errorText = ref('');
const desk = ref<WorkbenchData | null>(null);
const finance = ref<FinanceCheckup | null>(null);
const inviteOpen = ref(false);
const ruleText = ref(RULE_TEXT);
const avatar = ref('');
const headline = ref('');
const advice = ref('');
const briefSource = ref<'zero' | 'fallback'>('fallback');
const inviteCode = computed(() => merchantInviteCode(desk.value?.merchantId));

const greetLine = computed(() => {
  if (!desk.value) return '老板好';
  return `${desk.value.greeting}，${desk.value.bossName}`;
});

const kpiPoints = computed(() => desk.value?.today.pointsIssued ?? 0);
const kpiRedeem = computed(() => desk.value?.today.redemptions ?? 0);
const healthScore = computed(() => (finance.value?.has_data ? finance.value.score : null));
const cashMonths = computed(() => finance.value?.cash_months ?? null);

function applyCard(card: WorkbenchCard) {
  desk.value = {
    greeting: card.greeting,
    bossName: card.bossName,
    storeName: card.storeName,
    storeId: card.storeId,
    merchantId: card.merchantId,
    merchantName: card.merchantName,
    today: card.today,
  };
  finance.value = card.finance;
  avatar.value = card.avatar || '';
  ruleText.value = card.rule || RULE_TEXT;
  headline.value = card.headline || '';
  advice.value = card.advice || '';
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  errorText.value = '';
  try {
    const [workbench, checkup] = await Promise.all([
      fetchWorkbench(),
      fetchFinance(),
    ]);
    desk.value = workbench;
    finance.value = checkup;
    avatar.value = session.avatar || '';
    if (workbench.storeId) uni.setStorageSync('mini_store_id', workbench.storeId);
    if (workbench.merchantId) uni.setStorageSync('mini_merchant_id', workbench.merchantId);

    const local = localMorningCopy({
      greeting: workbench.greeting,
      bossName: workbench.bossName,
      redemptions: workbench.today.redemptions,
      pointsIssued: workbench.today.pointsIssued,
      score: checkup.has_data ? checkup.score : null,
      hasData: !!checkup.has_data || workbench.today.redemptions > 0 || workbench.today.pointsIssued > 0,
    });
    headline.value = local.headline;
    advice.value = local.advice;
    briefSource.value = 'fallback';

    const brief = await zeroBriefing(workbench.storeName || workbench.merchantName);
    if (brief.ok) {
      headline.value = brief.headline;
      advice.value = brief.advice;
      briefSource.value = 'zero';
    }

    writeSticky(CARD_KEY, {
      greeting: workbench.greeting,
      bossName: workbench.bossName,
      storeName: workbench.storeName,
      merchantName: workbench.merchantName,
      merchantId: workbench.merchantId,
      storeId: workbench.storeId,
      avatar: avatar.value,
      rule: RULE_TEXT,
      today: workbench.today,
      finance: checkup,
      headline: headline.value,
      advice: advice.value,
    } satisfies WorkbenchCard);
  } catch (error) {
    errorText.value = friendlyMessage(error, '生意数据暂时没有加载出来');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function goVerify() {
  useDeskStore().merchant = 'verify';
}

function goAi() {
  useDeskStore().merchant = 'ai';
}

function goEarn() {
  uni.navigateTo({ url: '/pages/merchant/earn/index' });
}

function goIssue() {
  uni.navigateTo({ url: '/pages/merchant/issue/index' });
}

function previewApply() {
  uni.navigateTo({ url: `/pages/apply/index?invite=${inviteCode.value}` });
}

function copyInvite() {
  // #ifdef H5
  uni.setClipboardData({
    data: applyPageUrl(inviteCode.value),
    success() {
      uni.showToast({ title: '申请链接已复制', icon: 'none' });
    },
  });
  // #endif
}

function guideFinance() {
  uni.showModal({
    title: '完善财务数据',
    content: '近 30 天还没有可计算的经营流水。补上订单和核销后，就能看到健康分和现金支撑月数。',
    showCancel: false,
  });
}

const tabDesk = useDeskStore();
watch(() => tabDesk.pull, () => { if (props.active) load(true); });

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    enableShareMenu();
    const cached = readSticky<WorkbenchCard>(CARD_KEY);
    if (cached?.bossName) {
      applyCard(cached);
      loading.value = false;
      load(true);
    } else {
      load();
    }
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <view class="nav">
      <view class="pill">
        <view class="dot" />
        <text>{{ desk?.storeName || '门店' }}</text>
      </view>
      <view class="nav__acts">
        <view class="icon-btn" @tap="inviteOpen = true">邀</view>
        <view class="icon-btn" @tap="goAi">AI</view>
      </view>
    </view>

    <view v-if="loading" class="skel">
      <view class="skel__block" />
      <view class="skel__row">
        <view class="skel__card" />
        <view class="skel__card" />
      </view>
    </view>

    <template v-else>
      <view v-if="errorText" class="banner">{{ errorText }}</view>

      <view class="morning">
        <view class="row1">
          <view class="avatar">Z</view>
          <view class="greet-wrap">
            <view class="greet">{{ greetLine }}</view>
            <view class="state">{{ briefSource === 'zero' ? 'AI 已就绪' : '本地经营摘要' }}</view>
          </view>
        </view>
        <view class="headline">{{ headline }}</view>
        <view class="advice">
          <text class="bulb">建</text>
          <text>{{ advice }}</text>
        </view>
        <view class="foot">
          <text>核销 {{ kpiRedeem }} 笔</text>
          <text>发积分 {{ kpiPoints }}</text>
          <text v-if="healthScore != null">健康分 {{ healthScore }}</text>
        </view>
      </view>

      <view class="kpi-hero">
        <view class="label">
          今日发积分
          <text class="chip">实时</text>
        </view>
        <view class="big">{{ kpiPoints }}</view>
        <view class="trend">
          <text class="up">今日核销 {{ kpiRedeem }} 笔</text>
          <text v-if="cashMonths != null" class="muted">· 现金支撑 {{ cashMonths }} 月</text>
        </view>
        <view class="bar">
          <view class="bar__fill" :style="{ width: Math.min(100, kpiRedeem * 8 + 12) + '%' }" />
        </view>
      </view>

      <view class="kpi-grid">
        <view class="kpi-sm">
          <view class="label">今日核销</view>
          <view class="v">{{ kpiRedeem }}</view>
          <view class="sub">扫码核销成功笔数</view>
        </view>
        <view class="kpi-sm" @tap="!finance?.has_data && guideFinance()">
          <view class="label">健康分</view>
          <view class="v teal">{{ healthScore ?? '—' }}</view>
          <view class="sub">{{ finance?.has_data ? '近 30 天经营诊断' : '补流水后可计算' }}</view>
        </view>
      </view>

      <view class="section">
        <view class="section__title">快捷操作</view>
      </view>
      <view class="quick">
        <view class="q-item" @tap="goVerify">
          <view class="q-ico teal">扫</view>
          <text>扫码核销</text>
        </view>
        <view class="q-item" @tap="goEarn">
          <view class="q-ico blue">录</view>
          <text>录单发积分</text>
        </view>
        <view class="q-item" @tap="goIssue">
          <view class="q-ico purple">券</view>
          <text>代金券发放</text>
        </view>
        <view class="q-item" @tap="goAi">
          <view class="q-ico warm">AI</view>
          <text>问小Z</text>
        </view>
      </view>

      <view class="section">
        <view class="section__title">AI 待办</view>
        <text class="more">按紧急度</text>
      </view>
      <view class="card">
        <view class="todo" @tap="goVerify">
          <view class="ico warn">核</view>
          <view class="main">
            <view class="t">继续扫码核销</view>
            <view class="d">今日已完成 {{ kpiRedeem }} 笔</view>
          </view>
          <text class="act">去核销</text>
        </view>
        <view class="todo" @tap="goAi">
          <view class="ico ai">问</view>
          <view class="main">
            <view class="t">问小Z 今日经营</view>
            <view class="d">{{ briefSource === 'zero' ? 'Zero 已接通' : '本地摘要可用' }}</view>
          </view>
          <text class="act">去问</text>
        </view>
        <view class="todo" @tap="inviteOpen = true">
          <view class="ico invite">邀</view>
          <view class="main">
            <view class="t">邀请同行入驻</view>
            <view class="d">分享申请链接给其他老板</view>
          </view>
          <text class="act">邀请</text>
        </view>
      </view>

      <view class="section">
        <view class="section__title">今日摘要</view>
      </view>
      <view class="card">
        <view class="todo">
          <view class="ico muted">汇</view>
          <view class="main">
            <view class="t">核销 {{ kpiRedeem }} · 发积分 {{ kpiPoints }}</view>
            <view class="d">明细流水接口就绪后展示逐笔</view>
          </view>
        </view>
      </view>
    </template>

    <slide-sheet :visible="inviteOpen" @close="inviteOpen = false">
      <view class="sheet__title">邀请入驻</view>
      <view class="sheet__code">{{ inviteCode || '生成中' }}</view>
      <view class="sheet__hint">{{ ruleText }}</view>
      <button class="sheet-btn" hover-class="press" open-type="share" @tap="copyInvite">发送给其他老板</button>
      <button class="sheet-btn ghost" hover-class="press" @tap="previewApply">预览申请页</button>
    </slide-sheet>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 12rpx 32rpx 220rpx; box-sizing: border-box; background: #f3f7f8; }
.nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16rpx; }
.pill {
  display: inline-flex; align-items: center; gap: 12rpx;
  background: #fff; border: 1px solid #eaf0f2; padding: 14rpx 24rpx;
  border-radius: 999rpx; font-size: 26rpx; font-weight: 600;
  box-shadow: 0 8rpx 24rpx rgba(10, 60, 58, 0.05); max-width: 70%;
}
.dot { width: 14rpx; height: 14rpx; border-radius: 50%; background: #00b8a0; box-shadow: 0 0 0 6rpx rgba(0,184,160,.18); flex-shrink: 0; }
.nav__acts { display: flex; gap: 12rpx; }
.icon-btn {
  width: 72rpx; height: 72rpx; border-radius: 50%; background: #fff; border: 1px solid #eaf0f2;
  display: flex; align-items: center; justify-content: center; font-size: 24rpx; font-weight: 800; color: #00766a;
}
.morning {
  position: relative; border-radius: 48rpx; padding: 36rpx 32rpx 28rpx;
  background: linear-gradient(135deg, #00c9a7 0%, #2e90ff 100%); color: #fff;
  box-shadow: 0 32rpx 80rpx rgba(0, 88, 80, 0.14); overflow: hidden; margin-bottom: 20rpx;
}
.row1 { display: flex; align-items: center; gap: 16rpx; position: relative; z-index: 2; }
.avatar {
  width: 80rpx; height: 80rpx; border-radius: 24rpx;
  background: rgba(255,255,255,.22); border: 1px solid rgba(255,255,255,.35);
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 32rpx;
}
.greet { font-size: 30rpx; font-weight: 700; }
.state { font-size: 22rpx; opacity: .85; margin-top: 4rpx; }
.headline { position: relative; z-index: 2; margin-top: 24rpx; font-size: 30rpx; line-height: 1.5; font-weight: 600; }
.advice {
  position: relative; z-index: 2; margin-top: 20rpx;
  background: rgba(255,255,255,.16); border: 1px solid rgba(255,255,255,.25);
  border-radius: 28rpx; padding: 18rpx 22rpx; font-size: 24rpx; line-height: 1.55;
  display: flex; gap: 12rpx;
}
.bulb {
  width: 40rpx; height: 40rpx; border-radius: 12rpx; background: rgba(255,255,255,.25);
  display: flex; align-items: center; justify-content: center; font-size: 20rpx; font-weight: 800; flex-shrink: 0;
}
.foot {
  position: relative; z-index: 2; margin-top: 20rpx; display: flex; gap: 20rpx;
  font-size: 22rpx; opacity: .9; flex-wrap: wrap;
}
.kpi-hero {
  background: #fff; border-radius: 48rpx; padding: 28rpx; margin-bottom: 16rpx;
  box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.08);
}
.label { color: #8a9aa3; font-size: 24rpx; display: flex; align-items: center; gap: 12rpx; }
.chip {
  display: inline-flex; padding: 4rpx 14rpx; border-radius: 999rpx;
  background: #e8fbf7; color: #00766a; font-size: 20rpx; font-weight: 700;
}
.big { margin-top: 12rpx; font-size: 72rpx; font-weight: 800; color: #0e1f26; letter-spacing: -2rpx; }
.trend { margin-top: 8rpx; display: flex; gap: 12rpx; align-items: center; flex-wrap: wrap; }
.up { color: #009784; font-weight: 700; font-size: 24rpx; }
.muted { color: #8a9aa3; font-size: 24rpx; }
.bar { height: 16rpx; border-radius: 12rpx; background: #eff4f5; margin-top: 20rpx; overflow: hidden; }
.bar__fill { height: 100%; border-radius: 12rpx; background: linear-gradient(135deg, #00d6b2, #19a7f8); }
.kpi-grid { display: flex; gap: 16rpx; margin-bottom: 8rpx; }
.kpi-sm {
  flex: 1; background: #fff; border-radius: 40rpx; padding: 24rpx;
  box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.06);
}
.kpi-sm .v { margin-top: 8rpx; font-size: 40rpx; font-weight: 800; color: #0e1f26; }
.kpi-sm .v.teal { color: #009784; }
.kpi-sm .sub { margin-top: 8rpx; color: #8a9aa3; font-size: 22rpx; }
.section { display: flex; align-items: center; justify-content: space-between; padding: 28rpx 4rpx 12rpx; }
.section__title { font-size: 32rpx; font-weight: 700; color: #0e1f26; }
.more { color: #8a9aa3; font-size: 24rpx; }
.quick { display: flex; gap: 12rpx; }
.q-item {
  flex: 1; background: #fff; border-radius: 32rpx; padding: 20rpx 8rpx;
  display: flex; flex-direction: column; align-items: center; gap: 12rpx;
  font-size: 22rpx; color: #33454f; font-weight: 600;
  box-shadow: 0 8rpx 24rpx rgba(10, 60, 58, 0.05);
}
.q-ico {
  width: 72rpx; height: 72rpx; border-radius: 24rpx;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 26rpx;
}
.q-ico.teal { background: linear-gradient(135deg, #e6f9f6, #bff3ea); color: #00766a; }
.q-ico.blue { background: linear-gradient(135deg, #e8f2ff, #c9e2ff); color: #0f5fbf; }
.q-ico.purple { background: linear-gradient(135deg, #f0ebff, #d9d0ff); color: #5b3ce0; }
.q-ico.warm { background: linear-gradient(135deg, #fff0e6, #ffdcc4); color: #b26b00; }
.card {
  background: #fff; border-radius: 40rpx; padding: 8rpx 24rpx;
  box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.06);
}
.todo {
  display: flex; align-items: center; gap: 16rpx; padding: 24rpx 0;
  border-bottom: 1px solid #eaf0f2;
}
.todo:last-child { border-bottom: none; }
.ico {
  width: 72rpx; height: 72rpx; border-radius: 22rpx;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 24rpx;
}
.ico.warn { background: #ffecec; color: #c22a2e; }
.ico.ai { background: #e8fbf7; color: #00766a; }
.ico.invite { background: #e8f2ff; color: #0f5fbf; }
.ico.muted { background: #f1f5f7; color: #6d818b; }
.main { flex: 1; min-width: 0; }
.t { font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.d { margin-top: 4rpx; color: #8a9aa3; font-size: 22rpx; }
.act { color: #009784; font-weight: 700; font-size: 24rpx; }
.banner { margin-bottom: 16rpx; padding: 16rpx 20rpx; background: #ffecec; color: #c22a2e; border-radius: 20rpx; }
.skel__block { height: 280rpx; border-radius: 48rpx; background: #e2eaee; margin-bottom: 16rpx; }
.skel__row { display: flex; gap: 16rpx; }
.skel__card { flex: 1; height: 160rpx; border-radius: 32rpx; background: #e2eaee; }
.sheet__title { font-size: 34rpx; font-weight: 700; }
.sheet__code { margin-top: 16rpx; font-size: 56rpx; font-weight: 800; letter-spacing: 2rpx; color: #00b8a0; }
.sheet__hint { margin: 12rpx 0 24rpx; color: #8a9aa3; line-height: 1.6; }
.sheet-btn {
  background: #0e1f26; color: #fff; border-radius: 999rpx; font-weight: 700; margin-bottom: 16rpx;
}
.sheet-btn.ghost { background: #f1f5f7; color: #33454f; }
</style>
