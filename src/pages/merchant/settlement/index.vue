<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import EmptyState from '@/components/EmptyState.vue';
import NetworkBanner from '@/components/NetworkBanner.vue';
import {
  fetchSettlementOverview,
  type SettlementBillRow,
  type SettlementOverview,
} from '@/services/settlement';
import { friendlyMessage } from '@/utils/errors';
import { money, periodShort } from '@/utils/format';

const loading = ref(true);
const errorText = ref('');
const data = ref<SettlementOverview | null>(null);
const filter = ref<'ALL' | 'GENERATED' | 'CONFIRMED' | 'DISPUTED'>('ALL');

const STATUS: Record<string, { label: string; cls: string }> = {
  GENERATED: { label: '待确认', cls: 'pill--pending' },
  CONFIRMED: { label: '已确认', cls: 'pill--done' },
  DISPUTED: { label: '有异议', cls: 'pill--dispute' },
  GENERATING: { label: '生成中', cls: 'pill--muted' },
};

const bills = computed(() => {
  const list = data.value?.bills ?? [];
  if (filter.value === 'ALL') return list;
  return list.filter((b) => b.status === filter.value);
});

const filters = computed(() => [
  { key: 'ALL' as const, label: '全部', count: data.value?.bills.length ?? 0 },
  { key: 'GENERATED' as const, label: '待确认', count: data.value?.pending.count ?? 0 },
  { key: 'CONFIRMED' as const, label: '已确认', count: data.value?.confirmed.count ?? 0 },
  { key: 'DISPUTED' as const, label: '异议', count: data.value?.disputed.count ?? 0 },
]);

/** hero 主数字：有待确认就催结算，没有就展示累计已结 */
const hero = computed(() => {
  const d = data.value;
  if (!d) return { label: '待确认金额', amount: 0, sub: '正在读取对账数据' };
  if (d.pending.count > 0) {
    return {
      label: '待确认金额',
      amount: d.pending.amount,
      sub: `${d.pending.count} 张账单 · 确认后进入结算流程`,
    };
  }
  return {
    label: '累计已结算',
    amount: d.confirmed.amount,
    sub: d.confirmed.count > 0 ? `${d.confirmed.count} 张账单已确认` : '暂无已确认账单',
  };
});

const maxTrend = computed(() => {
  const list = data.value?.trend ?? [];
  return Math.max(1, ...list.map((t) => t.totalAmount));
});

function barHeight(t: SettlementBillRow): string {
  const ratio = maxTrend.value > 0 ? t.totalAmount / maxTrend.value : 0;
  return `${Math.max(6, Math.round(ratio * 100))}%`;
}

function monthLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}月`;
}

function statusOf(s: string) {
  return STATUS[s] ?? { label: s, cls: 'pill--muted' };
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  errorText.value = '';
  try {
    data.value = await fetchSettlementOverview();
  } catch (e) {
    const msg = friendlyMessage(e, '结算数据暂时读不到');
    // 店员账号没有 settlement:view，直接告诉他换账号，而不是让他反复重试
    errorText.value = msg.includes('权限') ? `${msg}，结算请用商家主体或附属管理员账号查看` : msg;
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

onShow(() => load(true));
onPullDownRefresh(() => load(true));

function openBill(b: SettlementBillRow) {
  uni.navigateTo({ url: `/pages/merchant/settlement/detail?id=${b.id}` });
}
</script>

<template>
  <view class="page">
    <network-banner />

    <view class="hero">
      <view class="hero__glow" />
      <view class="hero__glow2" />
      <view class="hero__top">
        <text class="hero__eyebrow">智能结算</text>
        <view class="ai-chip">
          <view class="ai-dot" />
          <text class="ai-text">小Z 在线</text>
        </view>
      </view>

      <view class="hero__label">{{ hero.label }}</view>
      <view class="hero__amount">
        <text class="hero__cur">¥</text>
        <text class="hero__num">{{ money(hero.amount) }}</text>
      </view>
      <view class="hero__sub">{{ hero.sub }}</view>

      <view class="hero__stats">
        <view class="hs">
          <view class="hs__v">{{ data?.latest?.totalCount ?? 0 }}</view>
          <view class="hs__l">本期核销笔数</view>
        </view>
        <view class="hs">
          <view class="hs__v">¥{{ money(data?.confirmed.amount ?? 0) }}</view>
          <view class="hs__l">累计已结算</view>
        </view>
        <view class="hs">
          <view class="hs__v">{{ data?.disputed.count ?? 0 }}</view>
          <view class="hs__l">待处理异议</view>
        </view>
      </view>
    </view>

    <view v-if="errorText" class="error">{{ errorText }}</view>

    <view v-if="data" class="insight">
      <view class="insight__head">
        <text class="insight__badge">小Z 说</text>
        <text class="insight__src">{{ data.insight.source === 'llm' ? '模型解读' : '规则解读' }}</text>
      </view>
      <view class="insight__headline">{{ data.insight.headline }}</view>
      <view v-for="(p, i) in data.insight.points" :key="i" class="insight__point">
        <view class="dot" :class="`dot--${p.tone}`" />
        <text class="insight__pt">{{ p.text }}</text>
      </view>
    </view>

    <view v-if="data && data.trend.length > 1" class="trend">
      <view class="trend__head">
        <text class="trend__title">账期趋势</text>
        <text class="trend__hint">近 {{ data.trend.length }} 期</text>
      </view>
      <view class="trend__bars">
        <view v-for="(t, i) in data.trend" :key="t.id" class="bar">
          <view
            class="bar__fill"
            :class="{ 'bar__fill--on': i === data.trend.length - 1 }"
            :style="{ height: barHeight(t) }"
          />
          <text class="bar__l">{{ monthLabel(t.periodStart) }}</text>
        </view>
      </view>
    </view>

    <view class="filters">
      <view
        v-for="f in filters"
        :key="f.key"
        class="f"
        :class="{ 'f--on': filter === f.key }"
        @tap="filter = f.key"
      >
        {{ f.label }}<text v-if="f.count" class="f__n">{{ f.count }}</text>
      </view>
    </view>

    <view v-if="loading && !data" class="hint">正在读取对账数据…</view>

    <empty-state
      v-else-if="!bills.length"
      :title="data ? '这个分类下暂无账单' : '暂无对账数据'"
      hint="对账单按账期自动生成，生成后可在此确认"
    />

    <view
      v-for="b in bills"
      :key="b.id"
      class="bill"
      hover-class="bill--press"
      @tap="openBill(b)"
    >
      <view class="bill__l">
        <view class="bill__period">{{ periodShort(b.periodStart, b.periodEnd) }}</view>
        <view class="bill__no">{{ b.reportNo }}</view>
        <text class="pill" :class="statusOf(b.status).cls">{{ statusOf(b.status).label }}</text>
      </view>
      <view class="bill__r">
        <view class="bill__amt">¥{{ money(b.totalAmount) }}</view>
        <view class="bill__cnt">{{ b.totalCount }} 笔核销</view>
      </view>
      <text class="bill__arrow">›</text>
    </view>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f7f8;
  padding-bottom: 64rpx;
}

/* ---------------- hero ---------------- */
.hero {
  position: relative;
  overflow: hidden;
  padding: 36rpx 40rpx 96rpx;
  background: linear-gradient(148deg, #07262f 0%, #0a2338 52%, #0d2f4a 100%);
  border-radius: 0 0 52rpx 52rpx;
}
.hero__glow {
  position: absolute;
  right: -140rpx;
  top: -180rpx;
  width: 480rpx;
  height: 480rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 214, 178, 0.34) 0%, rgba(0, 214, 178, 0) 70%);
}
.hero__glow2 {
  position: absolute;
  left: -120rpx;
  bottom: -200rpx;
  width: 420rpx;
  height: 420rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(46, 144, 255, 0.3) 0%, rgba(46, 144, 255, 0) 70%);
}
.hero__top {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.hero__eyebrow {
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 4rpx;
  color: rgba(255, 255, 255, 0.58);
}
.ai-chip {
  display: flex;
  align-items: center;
  gap: 8rpx;
  padding: 8rpx 18rpx;
  border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.1);
  border: 1px solid rgba(255, 255, 255, 0.16);
}
.ai-dot {
  width: 12rpx;
  height: 12rpx;
  border-radius: 50%;
  background: #00d6b2;
  box-shadow: 0 0 14rpx rgba(0, 214, 178, 0.9);
}
.ai-text {
  font-size: 20rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  color: #d8f7f1;
}
.hero__label {
  position: relative;
  z-index: 2;
  margin-top: 40rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.62);
}
.hero__amount {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  margin-top: 10rpx;
}
.hero__cur {
  font-size: 34rpx;
  font-weight: 700;
  color: #7fe9d6;
}
.hero__num {
  font-size: 88rpx;
  line-height: 1.05;
  font-weight: 800;
  letter-spacing: -2rpx;
  color: #ffffff;
}
.hero__sub {
  position: relative;
  z-index: 2;
  margin-top: 14rpx;
  font-size: 23rpx;
  color: rgba(255, 255, 255, 0.55);
}
.hero__stats {
  position: relative;
  z-index: 2;
  display: flex;
  margin-top: 44rpx;
  padding-top: 28rpx;
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}
.hs {
  flex: 1;
  min-width: 0;
}
.hs + .hs {
  padding-left: 26rpx;
  border-left: 1px solid rgba(255, 255, 255, 0.1);
}
.hs__v {
  font-size: 30rpx;
  font-weight: 800;
  color: #ffffff;
}
.hs__l {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: rgba(255, 255, 255, 0.48);
}

/* ---------------- AI 洞察 ---------------- */
.insight {
  position: relative;
  z-index: 3;
  margin: -60rpx 32rpx 0;
  padding: 28rpx 30rpx;
  border-radius: 32rpx;
  background: #ffffff;
  border: 1px solid rgba(255, 255, 255, 0.9);
  box-shadow: 0 24rpx 64rpx rgba(9, 48, 58, 0.16);
}
.insight__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.insight__badge {
  font-size: 20rpx;
  font-weight: 800;
  letter-spacing: 1rpx;
  color: #00766a;
  background: #e8fbf7;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
}
.insight__src {
  margin-left: auto;
  font-size: 18rpx;
  color: #b3c0c7;
}
.insight__headline {
  margin-top: 18rpx;
  font-size: 30rpx;
  font-weight: 800;
  line-height: 1.45;
  color: #0e1f26;
}
.insight__point {
  display: flex;
  gap: 12rpx;
  margin-top: 14rpx;
}
.insight__pt {
  flex: 1;
  font-size: 23rpx;
  line-height: 1.5;
  color: #5b6f78;
}
.dot {
  width: 10rpx;
  height: 10rpx;
  margin-top: 13rpx;
  border-radius: 50%;
  flex-shrink: 0;
}
.dot--good {
  background: #00b8a0;
}
.dot--warn {
  background: #ff9f1c;
}
.dot--info {
  background: #a7bac3;
}

/* ---------------- 趋势 ---------------- */
.trend {
  margin: 26rpx 32rpx 0;
  padding: 28rpx 30rpx;
  border-radius: 32rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 32rpx rgba(12, 52, 50, 0.05);
}
.trend__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.trend__title {
  font-size: 24rpx;
  font-weight: 800;
  color: #33454f;
}
.trend__hint {
  font-size: 19rpx;
  color: #b3c0c7;
}
.trend__bars {
  display: flex;
  align-items: flex-end;
  gap: 18rpx;
  height: 168rpx;
  margin-top: 26rpx;
}
.bar {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  align-items: center;
}
.bar__fill {
  width: 100%;
  border-radius: 10rpx 10rpx 4rpx 4rpx;
  background: #dde9ec;
}
.bar__fill--on {
  background: linear-gradient(180deg, #00d6b2 0%, #19a7f8 100%);
  box-shadow: 0 8rpx 22rpx rgba(0, 184, 160, 0.32);
}
.bar__l {
  margin-top: 12rpx;
  font-size: 18rpx;
  color: #a7bac3;
}

/* ---------------- 列表 ---------------- */
.filters {
  display: flex;
  gap: 14rpx;
  margin: 30rpx 32rpx 0;
  flex-wrap: wrap;
}
.f {
  padding: 12rpx 24rpx;
  border-radius: 999rpx;
  background: #ffffff;
  border: 1px solid #eaf0f2;
  font-size: 23rpx;
  font-weight: 600;
  color: #6d818b;
}
.f--on {
  background: #0e1f26;
  border-color: #0e1f26;
  color: #ffffff;
}
.f__n {
  margin-left: 8rpx;
  font-size: 19rpx;
  opacity: 0.7;
}
.bill {
  display: flex;
  align-items: center;
  gap: 18rpx;
  margin: 16rpx 32rpx 0;
  padding: 28rpx;
  border-radius: 28rpx;
  background: #ffffff;
  box-shadow: 0 6rpx 24rpx rgba(12, 52, 50, 0.05);
}
.bill--press {
  background: #f8fbfc;
}
.bill__l {
  flex: 1;
  min-width: 0;
}
.bill__period {
  font-size: 28rpx;
  font-weight: 800;
  color: #0e1f26;
}
.bill__no {
  margin-top: 6rpx;
  font-size: 19rpx;
  color: #b3c0c7;
}
.bill__r {
  text-align: right;
  flex-shrink: 0;
}
.bill__amt {
  font-size: 32rpx;
  font-weight: 800;
  color: #0e1f26;
}
.bill__cnt {
  margin-top: 6rpx;
  font-size: 20rpx;
  color: #8a9aa3;
}
.bill__arrow {
  font-size: 38rpx;
  color: #ccd8dd;
  font-weight: 300;
}
.pill {
  display: inline-block;
  margin-top: 12rpx;
  padding: 4rpx 16rpx;
  border-radius: 999rpx;
  font-size: 18rpx;
  font-weight: 700;
}
.pill--pending {
  background: #fff4e5;
  color: #b26a2e;
}
.pill--done {
  background: #e8fbf7;
  color: #00766a;
}
.pill--dispute {
  background: #ffeff0;
  color: #c8323a;
}
.pill--muted {
  background: #f1f5f7;
  color: #8a9aa3;
}

.hint {
  padding: 40rpx 32rpx;
  font-size: 23rpx;
  color: #8a9aa3;
  text-align: center;
}
.error {
  margin: 20rpx 32rpx 0;
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background: #fff4e5;
  color: #a4611f;
  font-size: 22rpx;
}
</style>
