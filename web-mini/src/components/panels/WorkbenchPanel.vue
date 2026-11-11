<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSessionStore } from '@/stores/session';
import { fetchFinance, fetchWorkbench, type FinanceCheckup, type WorkbenchData } from '@/services/merchant';
import { fetchMyAlliances, type MyAlliancesView } from '@/services/alliance-insight';
import { friendlyMessage } from '@/utils/errors';
import SlideSheet from '@/components/SlideSheet.vue';
import { useDeskStore } from '@/stores/desk';
import { applyPageUrl, enableShareMenu, merchantInviteCode } from '@/utils/share';
import { readSticky, writeSticky } from '@/utils/sticky';
import { fetchBriefing, localMorningCopy } from '@/services/briefing';

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
/** 工作台「我的联盟」卡片：独立于主数据加载，接口失败不拖垮整页 */
const allianceView = ref<MyAlliancesView | null>(null);
const allianceTotal = computed(() => allianceView.value?.total ?? 0);
const currentAllianceName = computed(() => {
  const id = session.currentAllianceId;
  return allianceView.value?.list.find((r) => r.allianceId === id)?.name ?? '';
});

const greetLine = computed(() => {
  if (!desk.value) return '老板好';
  return `${desk.value.greeting}，${desk.value.bossName}`;
});

const kpiPoints = computed(() => desk.value?.today.pointsIssued ?? 0);
const kpiRedeem = computed(() => desk.value?.today.redemptions ?? 0);
const healthScore = computed(() => (finance.value?.has_data ? finance.value.score : null));
const cashMonths = computed(() => finance.value?.cash_months ?? null);

/** 今日日期（本地时区），摘要卡用真实日期而不是固定文案。 */
const todayText = computed(() => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
});

/** 每笔核销平均发分：核销为 0 时返回 null，模板不渲染，避免除零显示 0 或 NaN。 */
const avgPoints = computed(() => {
  const n = kpiRedeem.value;
  if (!n) return null;
  return Math.round(kpiPoints.value / n);
});

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

    const brief = await fetchBriefing(workbench.storeName || workbench.merchantName);
    if (brief.ok) {
      headline.value = brief.headline;
      advice.value = brief.advice;
      briefSource.value = 'zero';
    }

    // 联盟卡片单独加载：新接口出问题时工作台主流程照常可用
    void fetchMyAlliances()
      .then((res) => {
        allianceView.value = res;
        const ids = res.list.map((r) => r.allianceId);
        if (session.currentAllianceId && !ids.includes(session.currentAllianceId)) {
          session.setCurrentAlliance(0);
        }
        if (!session.currentAllianceId && ids.length === 1) session.setCurrentAlliance(ids[0]);
      })
      .catch(() => undefined);

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

function goSettlement() {
  uni.navigateTo({ url: '/pages/merchant/settlement/index' });
}

function goAlliances() {
  uni.navigateTo({ url: '/pages/merchant/alliances/index' });
}

/** 健康分有数据就去问小Z 要建议，没数据就引导补流水，不弹空页面。 */
function openHealth() {
  if (!finance.value?.has_data) {
    guideFinance();
    return;
  }
  goAi();
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
  <view class="pm-page">
    <view class="pm-hero">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="nav">
          <view class="store-chip">
            <view class="pm-hero__dot" />
            <text class="store-chip__t">{{ desk?.storeName || '门店' }}</text>
          </view>
          <view class="nav-acts">
            <view class="ghost-btn" hover-class="press" @tap="inviteOpen = true">邀</view>
            <view class="ghost-btn" hover-class="press" @tap="goAi">AI</view>
          </view>
        </view>

        <text class="greet">{{ greetLine }}</text>
        <text class="headline">{{ loading ? '正在同步今日经营数据…' : headline }}</text>

        <view class="pm-bignum hero-num">
          <text class="pm-bignum__v">{{ kpiRedeem }}</text>
          <text class="pm-bignum__u">今日核销笔数</text>
        </view>
      </view>
    </view>

    <view class="pm-body">
      <view v-if="errorText" class="pm-card fail">
        <text class="fail__t">{{ errorText }}</text>
      </view>

      <view v-if="loading">
        <view class="pm-card"><view class="pm-skel" style="height: 160rpx" /></view>
        <view class="pm-card" style="margin-top: 20rpx"><view class="pm-skel" style="height: 120rpx" /></view>
      </view>

      <template v-else>
        <view class="pm-card advice">
          <view class="advice__hd">
            <view class="pm-pill pm-pill--teal">AI 建议</view>
            <text class="advice__src">{{ briefSource === 'zero' ? '在线' : '本地' }}</text>
          </view>
          <text class="advice__t">{{ advice }}</text>
        </view>

        <view class="pm-card stats-card">
          <view class="pm-stats">
            <view class="pm-stat">
              <view class="pm-stat__v">{{ kpiRedeem }}</view>
              <view class="pm-stat__l">今日核销</view>
            </view>
            <view class="pm-stat">
              <view class="pm-stat__v">{{ kpiPoints }}</view>
              <view class="pm-stat__l">今日发分</view>
            </view>
            <view class="pm-stat" hover-class="press" @tap="openHealth">
              <view class="pm-stat__v" :class="{ 'pm-teal': healthScore != null }">{{ healthScore ?? '—' }}</view>
              <view class="pm-stat__l">健康分</view>
            </view>
          </view>
          <view class="stats-foot">
            <text>{{ todayText }}</text>
            <text v-if="cashMonths != null"> · 现金支撑 {{ cashMonths }} 月</text>
            <text v-if="avgPoints != null"> · 均笔 {{ avgPoints }} 分</text>
          </view>
        </view>

        <view class="pm-section">
          <text class="pm-section__t">快捷操作</text>
        </view>
        <view class="pm-card quick">
          <view class="q-item" hover-class="press" @tap="goVerify">
            <view class="q-ico q-ico--teal">扫</view>
            <text class="q-t">扫码核销</text>
          </view>
          <view class="q-item" hover-class="press" @tap="goEarn">
            <view class="q-ico q-ico--blue">录</view>
            <text class="q-t">录单发分</text>
          </view>
          <view class="q-item" hover-class="press" @tap="goIssue">
            <view class="q-ico q-ico--warm">券</view>
            <text class="q-t">发放券</text>
          </view>
          <view class="q-item" hover-class="press" @tap="goAi">
            <view class="q-ico q-ico--dark">AI</view>
            <text class="q-t">问小Z</text>
          </view>
        </view>

        <view class="settle" hover-class="press" @tap="goSettlement">
          <view class="settle__glow" />
          <view class="settle__main">
            <text class="settle__eyebrow">智能结算</text>
            <text class="settle__t">对账账单</text>
            <text class="settle__d">核销明细 · 确认与异议</text>
          </view>
          <view class="settle__badge">
            <view class="pm-hero__dot" />
            <text class="settle__badge-t">AI 已核完</text>
          </view>
        </view>

        <view class="alliance-entry" hover-class="press" @tap="goAlliances">
          <view class="alliance-entry__main">
            <view class="pm-pill pm-pill--teal">我的联盟</view>
            <view class="alliance-entry__t">{{ currentAllianceName || '查看我加入的联盟' }}</view>
            <view class="alliance-entry__d">
              {{
                allianceTotal
                  ? `共 ${allianceTotal} 个联盟 · 成员商家、本店经营与结算`
                  : '按联盟查看成员商家、门店与本店经营数据'
              }}
            </view>
          </view>
          <text class="alliance-entry__x">›</text>
        </view>

        <view class="pm-section">
          <text class="pm-section__t">经营待办</text>
          <text class="pm-section__more">按紧急度</text>
        </view>
        <view class="pm-card pm-card--flush">
          <view v-if="finance && !finance.has_data" class="todo" hover-class="press" @tap="guideFinance">
            <view class="todo__dot todo__dot--warn" />
            <view class="todo__main">
              <view class="todo__t">补充经营流水</view>
              <view class="todo__d">近 30 天没算到流水，健康分暂时给不出</view>
            </view>
            <text class="todo__act">去补 ›</text>
          </view>
          <view v-else-if="finance && finance.has_data" class="todo" hover-class="press" @tap="goAi">
            <view class="todo__dot todo__dot--teal" />
            <view class="todo__main">
              <view class="todo__t">
                健康分 {{ healthScore }}<text v-if="cashMonths != null"> · 现金支撑 {{ cashMonths }} 月</text>
              </view>
              <view class="todo__d">近 30 天经营诊断，可以要一份改进建议</view>
            </view>
            <text class="todo__act">看建议 ›</text>
          </view>
          <view class="todo" hover-class="press" @tap="goVerify">
            <view class="todo__dot todo__dot--muted" />
            <view class="todo__main">
              <view class="todo__t">今日已核销 {{ kpiRedeem }} 笔</view>
              <view class="todo__d">{{ kpiRedeem > 0 ? '继续扫下一张券' : '今天还没开单，点这里开始核销' }}</view>
            </view>
            <text class="todo__act">{{ kpiRedeem > 0 ? '去核销 ›' : '开单 ›' }}</text>
          </view>
          <view class="todo" hover-class="press" @tap="inviteOpen = true">
            <view class="todo__dot todo__dot--muted" />
            <view class="todo__main">
              <view class="todo__t">邀请同行入驻</view>
              <view class="todo__d">对方入驻开单后，你的联盟多一家店</view>
            </view>
            <text class="todo__act">邀请 ›</text>
          </view>
        </view>
      </template>
    </view>

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
/* ---------- 首屏 ---------- */
.nav { display: flex; align-items: center; justify-content: space-between; }
.store-chip {
  display: inline-flex; align-items: center; gap: 10rpx;
  padding: 8rpx 20rpx; border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.1);
  border: 1rpx solid rgba(255, 255, 255, 0.16);
}
.store-chip__t { font-size: 20rpx; color: #d8f7f1; }
.nav-acts { display: flex; gap: 12rpx; }
.ghost-btn {
  width: 60rpx; height: 60rpx; border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.1);
  border: 1rpx solid rgba(255, 255, 255, 0.16);
  color: #d8f7f1; font-size: 22rpx;
  display: flex; align-items: center; justify-content: center;
}
.greet { display: block; margin-top: 30rpx; font-size: 34rpx; font-weight: 700; color: #fff; }
.headline {
  display: block; margin-top: 12rpx; font-size: 24rpx;
  color: rgba(255, 255, 255, 0.66); line-height: 1.55;
}
.hero-num { margin-top: 26rpx; }

/* ---------- AI 建议 ---------- */
.advice__hd { display: flex; align-items: center; justify-content: space-between; }
.advice__src { font-size: 20rpx; color: #b3c0c7; }
.advice__t {
  display: block; margin-top: 14rpx; font-size: 26rpx;
  color: #33454f; line-height: 1.6;
}

/* ---------- 指标 ---------- */
.stats-card { padding: 30rpx 16rpx 22rpx; }
.stats-foot {
  margin-top: 20rpx; padding-top: 18rpx; border-top: 1rpx solid #f2f6f7;
  text-align: center; font-size: 20rpx; color: #b3c0c7;
}

/* ---------- 快捷 ---------- */
.quick { display: flex; padding: 26rpx 12rpx; }
.q-item { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 12rpx; }
.q-ico {
  width: 84rpx; height: 84rpx; border-radius: 26rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 26rpx; font-weight: 800;
}
.q-ico--teal { background: #e8fbf7; color: #00766a; }
.q-ico--blue { background: #eaf2ff; color: #1c6dd0; }
.q-ico--warm { background: #fff6e8; color: #a9670a; }
.q-ico--dark { background: #07262f; color: #7ff0dd; }
.q-t { font-size: 22rpx; color: #33454f; }

/* ---------- 结算入口 ---------- */
.settle {
  position: relative; overflow: hidden;
  margin-top: 24rpx; padding: 30rpx;
  border-radius: 36rpx;
  background: linear-gradient(135deg, #09303a 0%, #0b2440 100%);
  box-shadow: 0 20rpx 48rpx rgba(0, 60, 70, 0.22);
  display: flex; align-items: center;
}
.settle__glow {
  position: absolute; right: -100rpx; top: -120rpx;
  width: 320rpx; height: 320rpx; border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 214, 178, 0.3) 0%, rgba(0, 214, 178, 0) 70%);
}
.settle__main { position: relative; z-index: 2; flex: 1; min-width: 0; }
.settle__eyebrow { display: block; font-size: 20rpx; color: #7ff0dd; letter-spacing: 2rpx; }
.settle__t { display: block; margin-top: 8rpx; font-size: 32rpx; font-weight: 700; color: #fff; }
.settle__d { display: block; margin-top: 8rpx; font-size: 20rpx; color: rgba(255, 255, 255, 0.5); }
.settle__badge {
  position: relative; z-index: 2; flex-shrink: 0;
  display: flex; align-items: center; gap: 8rpx;
  padding: 8rpx 16rpx; border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.1);
  border: 1rpx solid rgba(255, 255, 255, 0.16);
}
.settle__badge-t { font-size: 18rpx; color: #d8f7f1; }

/* ---------- 待办 ---------- */
.todo {
  display: flex; align-items: center; gap: 18rpx;
  padding: 26rpx 30rpx;
}
.todo + .todo { border-top: 1rpx solid #f2f6f7; }
.todo__dot { width: 12rpx; height: 12rpx; border-radius: 50%; flex-shrink: 0; }
.todo__dot--warn { background: #ff9f1c; }
.todo__dot--teal { background: #00d6b2; }
.todo__dot--muted { background: #d4e0e4; }
.todo__main { flex: 1; min-width: 0; }
.todo__t { font-size: 26rpx; font-weight: 600; color: #0e1f26; }
.todo__d { margin-top: 6rpx; font-size: 22rpx; color: #8a9aa3; line-height: 1.45; }
.todo__act { flex-shrink: 0; font-size: 22rpx; color: #00a08c; font-weight: 700; }

/* ---------- 邀请抽屉 ---------- */
.sheet__title { font-size: 32rpx; font-weight: 800; color: #0e1f26; }
.sheet__code {
  margin-top: 20rpx; padding: 26rpx; border-radius: 24rpx;
  background: #07262f; color: #7ff0dd;
  font-size: 40rpx; font-weight: 800; text-align: center; letter-spacing: 6rpx;
}
.sheet__hint { margin-top: 16rpx; font-size: 22rpx; color: #8a9aa3; line-height: 1.6; }
.sheet-btn {
  margin-top: 24rpx; height: 88rpx; line-height: 88rpx;
  border-radius: 999rpx; background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff; font-size: 28rpx; font-weight: 700;
}
.sheet-btn::after { border: none; }
.sheet-btn.ghost { background: #f1f5f7; color: #33454f; }

.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }

.alliance-entry {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 20rpx; padding: 26rpx 28rpx; border-radius: 22rpx;
  background: #fff; box-shadow: 0 6rpx 24rpx rgba(15, 55, 62, .06);
}
.alliance-entry__main { flex: 1; min-width: 0; }
.alliance-entry__t { margin-top: 14rpx; font-size: 30rpx; font-weight: 800; color: #0e1f26; }
.alliance-entry__d { margin-top: 8rpx; font-size: 22rpx; color: #8a9aa3; line-height: 1.5; }
.alliance-entry__x { margin-left: 20rpx; font-size: 38rpx; color: #0b8b7b; }
</style>
