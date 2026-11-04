<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import SlideSheet from '@/components/SlideSheet.vue';
import { confirmSettlement, fetchBillInsight, type BillInsight } from '@/services/settlement';
import { friendlyMessage } from '@/utils/errors';
import { money, periodFull } from '@/utils/format';

const id = ref(0);
const loading = ref(true);
const errorText = ref('');
const data = ref<BillInsight | null>(null);
const acting = ref(false);
const disputeOpen = ref(false);
const disputeReason = ref('');

const STATUS: Record<string, { label: string; cls: string }> = {
  GENERATED: { label: '待确认', cls: 'pill--pending' },
  CONFIRMED: { label: '已确认', cls: 'pill--done' },
  DISPUTED: { label: '有异议', cls: 'pill--dispute' },
  GENERATING: { label: '生成中', cls: 'pill--muted' },
};

const statusMeta = computed(() => {
  const s = data.value?.bill.status ?? '';
  return STATUS[s] ?? { label: s, cls: 'pill--muted' };
});

/** 只有 GENERATED 能操作，其余状态界面上不给按钮，避免点了必然报错 */
const canAct = computed(() => data.value?.bill.status === 'GENERATED');

const hourSegments = computed(() => {
  const h = data.value?.hourly ?? [];
  const segs = [
    { label: '0-4', from: 0, to: 4 },
    { label: '4-8', from: 4, to: 8 },
    { label: '8-12', from: 8, to: 12 },
    { label: '12-16', from: 12, to: 16 },
    { label: '16-20', from: 16, to: 20 },
    { label: '20-24', from: 20, to: 24 },
  ];
  const counts = segs.map((s) => h.slice(s.from, s.to).reduce((a, b) => a + b, 0));
  const max = Math.max(1, ...counts);
  return segs.map((s, i) => ({
    label: s.label,
    count: counts[i],
    pct: Math.max(4, Math.round((counts[i] / max) * 100)),
  }));
});

const storeRows = computed(() => {
  const rows = data.value?.byStore ?? [];
  const total = rows.reduce((s, r) => s + r.amount, 0) || 1;
  return rows.slice(0, 5).map((r) => ({
    ...r,
    pct: Math.max(3, Math.round((r.amount / total) * 100)),
  }));
});

const deltaText = computed(() => {
  const d = data.value?.prevCompare;
  if (!d || d.delta == null) return '';
  return `${d.delta > 0 ? '+' : ''}${d.delta}%`;
});

onLoad((q) => {
  id.value = Number(q?.id || 0);
  if (!id.value) {
    errorText.value = '缺少账单编号';
    loading.value = false;
    return;
  }
  void load();
});

async function load() {
  loading.value = true;
  errorText.value = '';
  try {
    data.value = await fetchBillInsight(id.value);
    // 有严重异常时把异议草稿预填进输入框，商家可改
    disputeReason.value = data.value.disputeDraft || '';
  } catch (e) {
    const msg = friendlyMessage(e, '账单读不出来');
    errorText.value = msg.includes('权限') ? `${msg}，结算请用商家主体或附属管理员账号查看` : msg;
  } finally {
    loading.value = false;
  }
}

function askConfirm() {
  const v = data.value?.verdict;
  if (!v || acting.value) return;
  uni.showModal({
    title: v.canConfirm ? '确认对账' : '存在待核实异常',
    content: v.canConfirm
      ? '确认后该账期进入结算流程，不可再修改。'
      : `${v.reason}。确认后同样会锁定账期，建议先核对明细。`,
    confirmText: '确认',
    confirmColor: v.canConfirm ? '#00766a' : '#c8323a',
    success: (res) => {
      if (res.confirm) void submit(true);
    },
  });
}

async function submit(confirm: boolean) {
  if (acting.value) return;
  acting.value = true;
  try {
    await confirmSettlement(
      id.value,
      confirm ? { confirm: true } : { confirm: false, disputeReason: disputeReason.value.trim() },
    );
    uni.showToast({ title: confirm ? '已确认' : '已提异议', icon: 'success' });
    disputeOpen.value = false;
    await load();
  } catch (e) {
    uni.showToast({ title: friendlyMessage(e, confirm ? '确认失败' : '提交失败'), icon: 'none' });
  } finally {
    acting.value = false;
  }
}

function submitDispute() {
  if (disputeReason.value.trim().length < 5) {
    uni.showToast({ title: '异议原因至少 5 个字', icon: 'none' });
    return;
  }
  void submit(false);
}
</script>

<template>
  <view class="page">
    <network-banner />

    <view class="hero">
      <view class="hero__glow" />
      <view class="hero__top">
        <text class="hero__no">{{ data?.bill.reportNo ?? '对账单' }}</text>
        <text class="pill" :class="statusMeta.cls">{{ statusMeta.label }}</text>
      </view>
      <view class="hero__period">{{ data ? periodFull(data.bill.periodStart, data.bill.periodEnd) : '' }}</view>
      <view class="hero__amount">
        <text class="hero__cur">¥</text>
        <text class="hero__num">{{ money(data?.bill.totalAmount ?? 0) }}</text>
      </view>
      <view class="hero__sub">
        共 {{ data?.bill.totalCount ?? 0 }} 笔核销
        <text v-if="data?.bill.merchantName"> · {{ data.bill.merchantName }}</text>
      </view>
    </view>

    <view v-if="errorText" class="error">{{ errorText }}</view>
    <view v-else-if="loading && !data" class="hint">正在核查账单…</view>

    <template v-if="data">
      <!-- AI 核查结论 -->
      <view class="verdict" :class="data.verdict.canConfirm ? 'verdict--ok' : 'verdict--risk'">
        <view class="verdict__icon">{{ data.verdict.canConfirm ? '✓' : '!' }}</view>
        <view class="verdict__body">
          <view class="verdict__t">{{ data.verdict.canConfirm ? '可以确认' : '建议先核实' }}</view>
          <view class="verdict__d">{{ data.verdict.reason }}</view>
        </view>
      </view>

      <view class="card">
        <view class="card__head">
          <text class="card__badge">小Z 说</text>
          <text class="card__src">{{ data.insight.source === 'llm' ? '模型解读' : '规则解读' }}</text>
        </view>
        <view class="card__headline">{{ data.insight.headline }}</view>
        <view v-for="(p, i) in data.insight.points" :key="i" class="point">
          <view class="dot" :class="`dot--${p.tone}`" />
          <text class="point__t">{{ p.text }}</text>
        </view>
      </view>

      <!-- 核查项 -->
      <view class="section">核查明细</view>
      <view class="checks">
        <view
          v-for="(c, i) in data.checks"
          :key="i"
          class="check"
          :class="`check--${c.level}`"
        >
          <view class="check__mark">{{ c.level === 'ok' ? '✓' : c.level === 'warn' ? '!' : 'i' }}</view>
          <view class="check__body">
            <view class="check__t">
              {{ c.title }}
              <text v-if="c.critical" class="check__flag">需核实</text>
            </view>
            <view class="check__d">{{ c.detail }}</view>
          </view>
        </view>
      </view>

      <!-- 时段分布 -->
      <view class="section">核销时段</view>
      <view class="card">
        <view class="hours">
          <view v-for="s in hourSegments" :key="s.label" class="hour">
            <text class="hour__n">{{ s.count }}</text>
            <view class="hour__track">
              <view class="hour__fill" :style="{ height: `${s.pct}%` }" />
            </view>
            <text class="hour__l">{{ s.label }}</text>
          </view>
        </view>
        <view class="hours__hint">0–5 点核销占比偏高时，核查项会单独提示</view>
      </view>

      <!-- 门店分布 -->
      <template v-if="storeRows.length">
        <view class="section">门店分布</view>
        <view class="card">
          <view v-for="s in storeRows" :key="s.name" class="store">
            <view class="store__head">
              <text class="store__name">{{ s.name }}</text>
              <text class="store__amt">¥{{ money(s.amount) }}</text>
            </view>
            <view class="store__track">
              <view class="store__fill" :style="{ width: `${s.pct}%` }" />
            </view>
            <view class="store__meta">{{ s.count }} 笔 · 占 {{ s.pct }}%</view>
          </view>
        </view>
      </template>

      <!-- 环比 -->
      <template v-if="data.prevCompare">
        <view class="section">与上期对比</view>
        <view class="card compare">
          <view class="compare__col">
            <text class="compare__l">上期</text>
            <text class="compare__v">¥{{ money(data.prevCompare.amount) }}</text>
          </view>
          <view class="compare__mid">→</view>
          <view class="compare__col">
            <text class="compare__l">本期</text>
            <text class="compare__v compare__v--on">¥{{ money(data.bill.totalAmount) }}</text>
          </view>
          <text v-if="deltaText" class="compare__delta" :class="{ 'compare__delta--down': (data.prevCompare.delta ?? 0) < 0 }">
            {{ deltaText }}
          </text>
        </view>
      </template>

      <view v-if="data.bill.disputeReason" class="dispute">
        <text class="dispute__t">异议原因</text>
        <text class="dispute__d">{{ data.bill.disputeReason }}</text>
      </view>

      <view v-if="!canAct" class="locked">
        {{ data.bill.status === 'CONFIRMED' ? '该账期已确认并冻结，不可再修改' : '该账单当前状态不可操作，需重新生成后才能确认' }}
      </view>
    </template>

    <!-- 底部操作栏 -->
    <view v-if="data && canAct" class="actions">
      <button class="btn btn--ghost" :disabled="acting" @tap="disputeOpen = true">提异议</button>
      <button
        class="btn"
        :class="data.verdict.canConfirm ? 'btn--primary' : 'btn--risk'"
        :loading="acting"
        @tap="askConfirm"
      >{{ data.verdict.canConfirm ? '确认对账' : '仍然确认' }}</button>
    </view>

    <slide-sheet :visible="disputeOpen" @close="disputeOpen = false">
      <view class="sheet__title">提交异议</view>
      <view class="sheet__hint">说明哪里对不上，平台会据此重新生成对账单（至少 5 个字）</view>
      <textarea
        v-model="disputeReason"
        class="sheet__area"
        placeholder="例如：10 月 12 日有 2 笔核销不是我店发生，请核实"
        maxlength="500"
      />
      <button class="btn btn--primary btn--block" :loading="acting" @tap="submitDispute">提交异议</button>
    </slide-sheet>
  </view>
</template>

<style scoped>
.page {
  min-height: 100vh;
  background: #f3f7f8;
  padding-bottom: 220rpx;
}

/* ---------------- hero ---------------- */
.hero {
  position: relative;
  overflow: hidden;
  padding: 32rpx 40rpx 56rpx;
  background: linear-gradient(148deg, #07262f 0%, #0a2338 52%, #0d2f4a 100%);
  border-radius: 0 0 48rpx 48rpx;
}
.hero__glow {
  position: absolute;
  right: -140rpx;
  top: -180rpx;
  width: 460rpx;
  height: 460rpx;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(0, 214, 178, 0.32) 0%, rgba(0, 214, 178, 0) 70%);
}
.hero__top {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16rpx;
}
.hero__no {
  font-size: 22rpx;
  font-weight: 700;
  letter-spacing: 1rpx;
  color: rgba(255, 255, 255, 0.62);
}
.hero__period {
  position: relative;
  z-index: 2;
  margin-top: 26rpx;
  font-size: 24rpx;
  color: rgba(255, 255, 255, 0.55);
}
.hero__amount {
  position: relative;
  z-index: 2;
  display: flex;
  align-items: baseline;
  gap: 10rpx;
  margin-top: 8rpx;
}
.hero__cur {
  font-size: 32rpx;
  font-weight: 700;
  color: #7fe9d6;
}
.hero__num {
  font-size: 80rpx;
  line-height: 1.08;
  font-weight: 800;
  letter-spacing: -2rpx;
  color: #ffffff;
}
.hero__sub {
  position: relative;
  z-index: 2;
  margin-top: 12rpx;
  font-size: 22rpx;
  color: rgba(255, 255, 255, 0.5);
}

/* ---------------- 结论 ---------------- */
.verdict {
  display: flex;
  gap: 18rpx;
  margin: -28rpx 32rpx 0;
  padding: 26rpx 28rpx;
  border-radius: 28rpx;
  background: #ffffff;
  box-shadow: 0 18rpx 48rpx rgba(9, 48, 58, 0.12);
  position: relative;
  z-index: 3;
}
.verdict__icon {
  width: 56rpx;
  height: 56rpx;
  border-radius: 50%;
  text-align: center;
  line-height: 56rpx;
  font-size: 30rpx;
  font-weight: 800;
  flex-shrink: 0;
}
.verdict--ok .verdict__icon {
  background: #e8fbf7;
  color: #00766a;
}
.verdict--risk .verdict__icon {
  background: #ffeff0;
  color: #c8323a;
}
.verdict__body {
  flex: 1;
  min-width: 0;
}
.verdict__t {
  font-size: 30rpx;
  font-weight: 800;
  color: #0e1f26;
}
.verdict--risk .verdict__t {
  color: #c8323a;
}
.verdict__d {
  margin-top: 8rpx;
  font-size: 23rpx;
  line-height: 1.5;
  color: #5b6f78;
}

/* ---------------- 通用卡片 ---------------- */
.card {
  margin: 24rpx 32rpx 0;
  padding: 28rpx 30rpx;
  border-radius: 28rpx;
  background: #ffffff;
  box-shadow: 0 8rpx 28rpx rgba(12, 52, 50, 0.05);
}
.card__head {
  display: flex;
  align-items: center;
  gap: 12rpx;
}
.card__badge {
  font-size: 20rpx;
  font-weight: 800;
  color: #00766a;
  background: #e8fbf7;
  padding: 6rpx 16rpx;
  border-radius: 999rpx;
}
.card__src {
  margin-left: auto;
  font-size: 18rpx;
  color: #b3c0c7;
}
.card__headline {
  margin-top: 16rpx;
  font-size: 28rpx;
  font-weight: 800;
  line-height: 1.5;
  color: #0e1f26;
}
.point {
  display: flex;
  gap: 12rpx;
  margin-top: 12rpx;
}
.point__t {
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

.section {
  margin: 32rpx 32rpx 12rpx;
  font-size: 23rpx;
  font-weight: 800;
  color: #6d818b;
  letter-spacing: 1rpx;
}

/* ---------------- 核查项 ---------------- */
.checks {
  margin: 0 32rpx;
}
.check {
  display: flex;
  gap: 16rpx;
  padding: 22rpx 24rpx;
  margin-bottom: 12rpx;
  border-radius: 22rpx;
  background: #ffffff;
  border-left: 6rpx solid #dde9ec;
}
.check--ok {
  border-left-color: #00b8a0;
}
.check--info {
  border-left-color: #9fc6d8;
}
.check--warn {
  border-left-color: #ff9f1c;
  background: #fffdf8;
}
.check__mark {
  width: 36rpx;
  height: 36rpx;
  border-radius: 50%;
  text-align: center;
  line-height: 36rpx;
  font-size: 22rpx;
  font-weight: 800;
  flex-shrink: 0;
  background: #eef4f6;
  color: #6d818b;
}
.check--ok .check__mark {
  background: #e8fbf7;
  color: #00766a;
}
.check--warn .check__mark {
  background: #fff1de;
  color: #b26a2e;
}
.check__body {
  flex: 1;
  min-width: 0;
}
.check__t {
  font-size: 26rpx;
  font-weight: 700;
  color: #0e1f26;
}
.check__flag {
  margin-left: 10rpx;
  font-size: 18rpx;
  font-weight: 700;
  color: #c8323a;
  background: #ffeff0;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
}
.check__d {
  margin-top: 6rpx;
  font-size: 22rpx;
  line-height: 1.55;
  color: #67787f;
}

/* ---------------- 时段 ---------------- */
.hours {
  display: flex;
  align-items: flex-end;
  gap: 14rpx;
  height: 220rpx;
}
.hour {
  flex: 1;
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-end;
}
.hour__n {
  font-size: 18rpx;
  color: #a7bac3;
  margin-bottom: 6rpx;
}
.hour__track {
  width: 100%;
  flex: 1;
  display: flex;
  align-items: flex-end;
  background: #f6fafb;
  border-radius: 10rpx;
  overflow: hidden;
}
.hour__fill {
  width: 100%;
  border-radius: 10rpx 10rpx 0 0;
  background: linear-gradient(180deg, #00d6b2 0%, #19a7f8 100%);
}
.hour__l {
  margin-top: 10rpx;
  font-size: 18rpx;
  color: #a7bac3;
}
.hours__hint {
  margin-top: 18rpx;
  font-size: 20rpx;
  color: #a7bac3;
  line-height: 1.5;
}

/* ---------------- 门店 ---------------- */
.store {
  padding: 16rpx 0;
}
.store + .store {
  border-top: 1px solid #f1f5f7;
}
.store__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}
.store__name {
  font-size: 25rpx;
  font-weight: 700;
  color: #33454f;
}
.store__amt {
  font-size: 25rpx;
  font-weight: 800;
  color: #0e1f26;
}
.store__track {
  margin-top: 12rpx;
  height: 12rpx;
  border-radius: 999rpx;
  background: #f1f5f7;
  overflow: hidden;
}
.store__fill {
  height: 100%;
  border-radius: 999rpx;
  background: linear-gradient(90deg, #00d6b2 0%, #19a7f8 100%);
}
.store__meta {
  margin-top: 8rpx;
  font-size: 19rpx;
  color: #a7bac3;
}

/* ---------------- 环比 ---------------- */
.compare {
  display: flex;
  align-items: center;
  gap: 20rpx;
}
.compare__col {
  flex: 1;
}
.compare__l {
  display: block;
  font-size: 19rpx;
  color: #a7bac3;
}
.compare__v {
  display: block;
  margin-top: 6rpx;
  font-size: 30rpx;
  font-weight: 800;
  color: #67787f;
}
.compare__v--on {
  color: #0e1f26;
}
.compare__mid {
  font-size: 26rpx;
  color: #c7d5da;
}
.compare__delta {
  margin-left: auto;
  font-size: 24rpx;
  font-weight: 800;
  color: #00766a;
}
.compare__delta--down {
  color: #c8323a;
}

.dispute {
  margin: 24rpx 32rpx 0;
  padding: 22rpx 24rpx;
  border-radius: 20rpx;
  background: #ffeff0;
}
.dispute__t {
  display: block;
  font-size: 21rpx;
  font-weight: 800;
  color: #c8323a;
}
.dispute__d {
  display: block;
  margin-top: 8rpx;
  font-size: 22rpx;
  line-height: 1.55;
  color: #8e3c42;
}
.locked {
  margin: 30rpx 32rpx 0;
  padding: 22rpx;
  border-radius: 20rpx;
  background: #f1f5f7;
  color: #8a9aa3;
  font-size: 22rpx;
  text-align: center;
}

/* ---------------- 底部操作 ---------------- */
.actions {
  position: fixed;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 20;
  display: flex;
  gap: 20rpx;
  padding: 18rpx 32rpx calc(18rpx + env(safe-area-inset-bottom));
  background: rgba(255, 255, 255, 0.97);
  border-top: 1px solid #eaf0f2;
}
.btn {
  flex: 1;
  margin: 0;
  height: 88rpx;
  line-height: 88rpx;
  border-radius: 999rpx;
  font-size: 27rpx;
  font-weight: 800;
}
/* 小程序 button 自带 ::after 边框，会破坏圆角与渐变，去掉 */
.btn::after {
  border: none;
}
.btn--ghost {
  flex: 0 0 200rpx;
  background: #f1f5f7;
  color: #33454f;
}
.btn--primary {
  background: linear-gradient(135deg, #00d6b2 0%, #19a7f8 100%);
  color: #ffffff;
}
.btn--risk {
  background: linear-gradient(135deg, #ff7a6e 0%, #e0453c 100%);
  color: #ffffff;
}
.btn--block {
  width: 100%;
  margin-top: 24rpx;
}

/* ---------------- 抽屉 ---------------- */
.sheet__title {
  font-size: 32rpx;
  font-weight: 800;
  color: #0e1f26;
}
.sheet__hint {
  margin-top: 10rpx;
  font-size: 22rpx;
  line-height: 1.5;
  color: #8a9aa3;
}
.sheet__area {
  width: 100%;
  height: 220rpx;
  margin-top: 20rpx;
  padding: 20rpx;
  box-sizing: border-box;
  border-radius: 18rpx;
  background: #f6fafb;
  font-size: 24rpx;
  line-height: 1.55;
  color: #0e1f26;
}

.hint {
  padding: 40rpx 32rpx;
  font-size: 23rpx;
  color: #8a9aa3;
  text-align: center;
}
.error {
  margin: 24rpx 32rpx 0;
  padding: 18rpx 22rpx;
  border-radius: 18rpx;
  background: #fff4e5;
  color: #a4611f;
  font-size: 22rpx;
}
.pill {
  display: inline-block;
  padding: 6rpx 18rpx;
  border-radius: 999rpx;
  font-size: 19rpx;
  font-weight: 700;
}
.pill--pending {
  background: rgba(255, 244, 229, 0.16);
  color: #ffce93;
}
.pill--done {
  background: rgba(232, 251, 247, 0.16);
  color: #8ff0df;
}
.pill--dispute {
  background: rgba(255, 239, 240, 0.16);
  color: #ff9ea3;
}
.pill--muted {
  background: rgba(255, 255, 255, 0.12);
  color: rgba(255, 255, 255, 0.6);
}
</style>
