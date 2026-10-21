<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSessionStore } from '@/stores/session';
import { fetchFinance, fetchWorkbench, type FinanceCheckup, type WorkbenchData } from '@/services/merchant';
import { fetchMerchantGalaxy, yuan, type GalaxyChart, type GalaxyPlanet } from '@/services/galaxy';
import GalaxyStage from '@/components/GalaxyStage.vue';
import { friendlyMessage } from '@/utils/errors';
import SlideSheet from '@/components/SlideSheet.vue';
import { useDeskStore } from '@/stores/desk';
import { applyPageUrl, enableShareMenu, merchantInviteCode } from '@/utils/share';
import { readSticky, writeSticky } from '@/utils/sticky';

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
};

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const errorText = ref('');
const desk = ref<WorkbenchData | null>(null);
const finance = ref<FinanceCheckup | null>(null);
const galaxy = ref<GalaxyChart | null>(null);
const picked = ref<GalaxyPlanet | null>(null);
const inviteOpen = ref(false);
const ruleText = ref(RULE_TEXT);
const avatar = ref('');
const inviteCode = computed(() => merchantInviteCode(desk.value?.merchantId));

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
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  errorText.value = '';
  try {
    const [workbench, checkup, chart] = await Promise.all([
      fetchWorkbench(),
      fetchFinance(),
      fetchMerchantGalaxy().catch(() => null),
    ]);
    if (chart) galaxy.value = chart;
    desk.value = workbench;
    finance.value = checkup;
    avatar.value = session.avatar || '';
    if (workbench.storeId) uni.setStorageSync('mini_store_id', workbench.storeId);
    if (workbench.merchantId) uni.setStorageSync('mini_merchant_id', workbench.merchantId);
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
    } satisfies WorkbenchCard);
  } catch (error) {
    errorText.value = friendlyMessage(error, '生意数据暂时没有加载出来');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function go(url: string) {
  if (url.includes('/verify/')) {
    useDeskStore().merchant = 'verify';
    return;
  }
  uni.navigateTo({ url });
}

function copyInvite() {
  // 微信里由 open-type="share" 拉起分享卡片；浏览器里改成复制入驻链接。
  // #ifdef H5
  uni.setClipboardData({
    data: applyPageUrl(inviteCode.value),
    success() {
      uni.showToast({ title: '申请链接已复制', icon: 'none' });
    },
  });
  // #endif
}

function pickPlanet(id: number, role: 'center' | 'planet') {
  if (!galaxy.value) return;
  if (role === 'center') {
    picked.value = null;
    uni.showModal({
      title: galaxy.value.center.name,
      content: galaxy.value.mode === 'MAIN'
        ? `联盟本月 ${yuan(galaxy.value.center.monthAmount)}，${galaxy.value.center.monthOrderCount} 笔，附属 ${galaxy.value.center.planetCount} 家`
        : `本店本月 ${yuan(galaxy.value.center.monthAmount)}，到店 ${galaxy.value.center.monthOrderCount} 笔`,
      showCancel: false,
    });
    return;
  }
  picked.value = galaxy.value.planets.find((item) => item.id === id) || null;
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
    <view v-if="loading" class="skel">
      <view class="skel__line skel__line--lg" />
      <view class="skel__line" />
      <view class="skel__row">
        <view class="skel__card" />
        <view class="skel__card" />
      </view>
      <view class="skel__block" />
    </view>

    <template v-else>
      <view v-if="errorText" class="banner">{{ errorText }}</view>
      <view class="hello-row">
        <image v-if="avatar" class="avatar" :src="avatar" mode="aspectFill" lazy-load />
        <view v-else class="avatar avatar--ph">{{ (desk?.bossName || '商').slice(0, 1) }}</view>
        <view>
          <view class="hello">{{ desk?.greeting }}，{{ desk?.bossName }}</view>
          <view class="store">{{ desk?.storeName }}</view>
        </view>
      </view>

      <galaxy-stage :chart="galaxy" @pick="pickPlanet" />

      <view class="stats">
        <view class="stat">
          <view class="stat__num">{{ desk?.today.redemptions ?? 0 }}</view>
          <view class="stat__label">今日核销笔数</view>
        </view>
        <view class="stat">
          <view class="stat__num">{{ desk?.today.pointsIssued ?? 0 }}</view>
          <view class="stat__label">今日发放积分</view>
        </view>
      </view>

      <view class="finance">
        <view class="finance__title">财务诊断</view>
        <template v-if="finance?.has_data">
          <view class="finance__score">{{ finance.score }}<text class="finance__unit">分</text></view>
          <view class="finance__cash">
            现金支撑
            <text v-if="finance.cash_months != null">{{ finance.cash_months }} 个月</text>
            <text v-else>暂无让利支出，先不估算</text>
          </view>
        </template>
        <template v-else>
          <view class="finance__empty">近 30 天还没有足够的经营流水</view>
          <button class="guide" @tap="guideFinance">完善财务数据，获取 AI 经营建议</button>
        </template>
      </view>

      <view class="actions">
        <button class="action pressable" hover-class="press" hover-start-time="20" @tap="go('/pages/merchant/verify/index')">扫码核销</button>
        <button class="action action--ghost pressable" hover-class="press" hover-start-time="20" @tap="go('/pages/merchant/earn/index')">录单发积分</button>
      </view>
      <button class="invite pressable" hover-class="press" hover-start-time="20" @tap="inviteOpen = true">邀请入驻</button>
    </template>

    <slide-sheet :visible="!!picked" @close="picked = null">
      <view class="sheet__title">{{ picked?.name }}</view>
      <view class="sheet__hint">
        {{ galaxy?.mode === 'SUB' ? '本月消费' : '本月交易额' }} {{ yuan(picked?.monthAmount || 0) }}
        · {{ picked?.orderCount || 0 }} 笔
      </view>
      <button class="action" hover-class="press" @tap="picked = null">知道了</button>
    </slide-sheet>
    <slide-sheet :visible="inviteOpen" @close="inviteOpen = false">
      <view class="sheet__title">邀请入驻</view>
      <view class="sheet__code">{{ inviteCode || '生成中' }}</view>
      <view class="sheet__hint">{{ ruleText }}</view>
      <button class="action" hover-class="press" open-type="share" @tap="copyInvite">发送给其他老板</button>
      <button class="action action--ghost" hover-class="press" @tap="go('/pages/apply/index?invite=' + inviteCode)">预览申请页</button>
    </slide-sheet>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 12rpx 32rpx 220rpx; box-sizing: border-box; }
.hello-row { display: flex; align-items: center; gap: 20rpx; }
.avatar { width: 96rpx; height: 96rpx; border-radius: 32rpx; flex-shrink: 0; background: linear-gradient(160deg, #38bdf8, #14b8a6); }
.avatar--ph { color: #fff; display: flex; align-items: center; justify-content: center; font-size: 40rpx; font-weight: 700; }
.hello { font-size: 56rpx; font-weight: 800; line-height: 1.05; }
.store { margin-top: 8rpx; color: #94a3b8; font-size: 30rpx; }
.stats { display: flex; gap: 20rpx; margin-top: 32rpx; }
.stat { flex: 1; background: #fff; border-radius: 32rpx; padding: 28rpx 24rpx; box-shadow: 0 12rpx 30rpx rgba(15, 23, 42, 0.05); }
.stat__num { font-size: 56rpx; font-weight: 800; color: #0b1220; }
.stat__label { margin-top: 8rpx; color: #64748b; font-size: 24rpx; }
.finance { margin-top: 24rpx; background: linear-gradient(160deg, #0ea5e9, #14b8a6); color: #fff; border-radius: 36rpx; padding: 32rpx; box-shadow: 0 16rpx 40rpx rgba(14, 165, 233, 0.25); }
.finance__title { font-size: 24rpx; color: #94a3b8; }
.finance__score { margin-top: 12rpx; font-size: 88rpx; font-weight: 700; line-height: 1; }
.finance__unit { font-size: 32rpx; margin-left: 8rpx; }
.finance__cash { margin-top: 16rpx; color: #cbd5e1; }
.finance__empty { margin: 16rpx 0 24rpx; line-height: 1.6; }
.guide { background: #fff; color: #0f172a; border-radius: 12rpx; font-size: 28rpx; }
.actions { display: flex; gap: 20rpx; margin-top: 28rpx; }
.action { flex: 1; background: #0b1220; color: #fff; border-radius: 999rpx; font-size: 28rpx; }
.action--ghost { background: #fff; color: #1d4ed8; }
.invite { margin-top: 20rpx; background: #fff; color: #0f172a; border-radius: 16rpx; }
.mask { position: fixed; inset: 0; background: rgba(15, 23, 42, .45); z-index: 30; display: flex; align-items: flex-end; }
.sheet { width: 100%; background: #fff; border-radius: 28rpx 28rpx 0 0; padding: 36rpx 32rpx 48rpx; box-sizing: border-box; }
.sheet__title { font-size: 34rpx; font-weight: 700; }
.sheet__code { margin-top: 16rpx; font-size: 56rpx; font-weight: 700; letter-spacing: 2rpx; color: #1d4ed8; }
.sheet__hint { margin: 12rpx 0 24rpx; color: #64748b; line-height: 1.6; }
.banner { margin-bottom: 20rpx; padding: 16rpx 20rpx; background: #fee2e2; color: #991b1b; border-radius: 12rpx; }
.skel__line, .skel__card, .skel__block { background: #e2e8f0; border-radius: 12rpx; }
.skel__line { height: 36rpx; width: 46%; margin-bottom: 16rpx; }
.skel__line--lg { width: 70%; height: 52rpx; }
.skel__row { display: flex; gap: 20rpx; margin-top: 20rpx; }
.skel__card { flex: 1; height: 160rpx; }
.skel__block { height: 220rpx; margin-top: 20rpx; }
</style>
