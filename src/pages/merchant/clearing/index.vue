<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import {
  fetchClearingBillDetail,
  fetchMyClearing,
  type ClearingBill,
  type ClearingBillDetail,
  type ClearingMyView,
} from '@/services/clearing';
import { friendlyMessage } from '@/utils/errors';
import { money } from '@/utils/format';

const loading = ref(true);
const errorText = ref('');
const data = ref<ClearingMyView | null>(null);
const activePeriod = ref('');
const expandedId = ref(0);
const detail = ref<ClearingBillDetail | null>(null);
const detailLoading = ref(false);

const periods = computed(() => data.value?.periods ?? []);
const current = computed(() =>
  periods.value.find((p) => p.periodKey === activePeriod.value) ?? data.value?.current ?? null,
);
const bills = computed(() =>
  (data.value?.bills ?? []).filter((b) => !activePeriod.value || b.periodKey === activePeriod.value),
);

function isPayable(b: ClearingBill) {
  return data.value ? b.payerMerchantId === data.value.merchantId : false;
}

function counterpart(b: ClearingBill) {
  return isPayable(b) ? b.receiverMerchantName : b.payerMerchantName;
}

function shortTime(iso: string) {
  return iso ? iso.replace('T', ' ').slice(0, 16) : '';
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  errorText.value = '';
  try {
    const res = await fetchMyClearing();
    data.value = res;
    if (!activePeriod.value && res.periods.length) activePeriod.value = res.periods[0].periodKey;
  } catch (e) {
    errorText.value = friendlyMessage(e, '商家互结数据暂时读不到');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

async function toggle(b: ClearingBill) {
  if (expandedId.value === b.id) {
    expandedId.value = 0;
    detail.value = null;
    return;
  }
  expandedId.value = b.id;
  detail.value = null;
  detailLoading.value = true;
  try {
    detail.value = await fetchClearingBillDetail(b.id);
  } catch (e) {
    errorText.value = friendlyMessage(e, '明细暂时读不到');
  } finally {
    detailLoading.value = false;
  }
}

function pickPeriod(key: string) {
  activePeriod.value = key;
  expandedId.value = 0;
  detail.value = null;
}

onShow(() => load(true));
onPullDownRefresh(() => load(true));
</script>

<template>
  <view class="page">
    <view class="hero">
      <view class="hero__eyebrow">商家互结 · {{ current?.periodKey || '暂无账期' }}</view>
      <view class="hero__label">本期净额（应收 − 应付）</view>
      <view class="hero__amount">
        <text class="hero__cur">¥</text>
        <text class="hero__num">{{ money(current?.net ?? 0) }}</text>
      </view>
      <view class="hero__sub">
        会员在本店兑换别家发的券，用掉后本店按券面值补给发券商家；自然月双向轧差。
      </view>
    </view>

    <view class="pair">
      <view class="pair__cell">
        <text class="pair__label">我该补给别家</text>
        <text class="pair__num pair__num--out">¥{{ money(current?.payable ?? 0) }}</text>
      </view>
      <view class="pair__line" />
      <view class="pair__cell">
        <text class="pair__label">别家该补我</text>
        <text class="pair__num pair__num--in">¥{{ money(current?.receivable ?? 0) }}</text>
      </view>
    </view>

    <view v-if="errorText" class="err">{{ errorText }}</view>

    <scroll-view v-if="periods.length > 1" scroll-x class="chips" :show-scrollbar="false">
      <view
        v-for="p in periods"
        :key="p.periodKey"
        class="chip"
        :class="{ on: p.periodKey === activePeriod }"
        @tap="pickPeriod(p.periodKey)"
      >{{ p.periodKey }}</view>
    </scroll-view>

    <view class="section">
      <view class="section__title">清分账单</view>
      <view v-if="loading && !data" class="empty">正在读取账期…</view>
      <view v-else-if="!bills.length" class="empty">
        <view class="empty__t">这个账期还没有跨商家核销</view>
        <view class="empty__d">只有当会员在别家兑换的券被核销后，才会产生互结账单</view>
      </view>

      <view v-for="b in bills" :key="b.id" class="bill" @tap="toggle(b)">
        <view class="bill__top">
          <view class="bill__left">
            <view class="bill__dir" :class="isPayable(b) ? 'bill__dir--out' : 'bill__dir--in'">
              {{ isPayable(b) ? '应付' : '应收' }}
            </view>
            <view class="bill__name">{{ counterpart(b) }}</view>
          </view>
          <view class="bill__right">
            <text class="bill__amount" :class="isPayable(b) ? 'bill__amount--out' : 'bill__amount--in'">
              ¥{{ money(b.netAmount) }}
            </text>
            <text class="bill__arrow">{{ expandedId === b.id ? '收起' : '明细' }}</text>
          </view>
        </view>
        <view class="bill__meta">
          <text>{{ b.periodKey }} · {{ b.forwardCount }} 笔 / {{ b.reverseCount }} 笔抵扣</text>
          <text class="pill" :class="b.status === 'SETTLED' ? 'pill--done' : 'pill--pending'">
            {{ b.status === 'SETTLED' ? '已结算' : '待结算' }}
          </text>
        </view>

        <view v-if="expandedId === b.id" class="detail" @tap.stop>
          <view v-if="detailLoading" class="detail__tip">读取明细…</view>
          <view v-else-if="detail" class="detail__list">
            <view class="detail__head">
              原始 ¥{{ money(detail.grossForward) }} − 抵扣 ¥{{ money(detail.grossReverse) }}
              = 应付 ¥{{ money(detail.netAmount) }}
            </view>
            <view v-for="it in detail.items" :key="it.id" class="item">
              <view class="item__row">
                <text class="item__code">{{ it.code || it.templateName || '代金券' }}</text>
                <text class="item__amount">¥{{ money(it.faceValue) }}</text>
              </view>
              <view class="item__row item__row--sub">
                <text>{{ it.payerMerchantName }} 兑换 → {{ it.receiverMerchantName }} 发券</text>
                <text class="item__effect" :class="it.effect === 'ADD' ? 'item__effect--add' : ''">
                  {{ it.effect === 'ADD' ? '计入' : '抵扣' }}
                </text>
              </view>
              <view class="item__row item__row--sub">
                <text>{{ it.redeemMerchantName }}{{ it.storeName ? ' / ' + it.storeName : '' }} 核销 · {{ shortTime(it.redeemedAt) }}</text>
              </view>
            </view>
          </view>
        </view>
      </view>
    </view>

    <view class="foot">
      只统计已核销的券，按核销时间归月；同一家商家兑换自家发的券不产生账单。
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; background: #f3f7f8; padding-bottom: 40rpx; }
.hero {
  margin: 24rpx; padding: 34rpx 30rpx 30rpx; border-radius: 24rpx;
  background: linear-gradient(135deg, #07262f 0%, #0d4b4a 100%); color: #fff;
}
.hero__eyebrow { font-size: 22rpx; color: #8fd6c8; letter-spacing: 1rpx; }
.hero__label { margin-top: 22rpx; font-size: 24rpx; color: #b9d4d2; }
.hero__amount { display: flex; align-items: baseline; gap: 6rpx; margin-top: 6rpx; }
.hero__cur { font-size: 30rpx; }
.hero__num { font-size: 68rpx; font-weight: 800; font-variant-numeric: tabular-nums; }
.hero__sub { margin-top: 14rpx; font-size: 22rpx; color: #a9c8c6; line-height: 1.6; }
.pair {
  display: flex; margin: 0 24rpx 20rpx; padding: 26rpx 0; border-radius: 20rpx;
  background: #fff; box-shadow: 0 6rpx 24rpx rgba(7, 38, 47, 0.05);
}
.pair__cell { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10rpx; }
.pair__line { width: 1rpx; background: #e8eff0; }
.pair__label { font-size: 22rpx; color: #7d9095; }
.pair__num { font-size: 36rpx; font-weight: 800; font-variant-numeric: tabular-nums; }
.pair__num--out { color: #d03050; }
.pair__num--in { color: #00766a; }
.err { margin: 0 24rpx 16rpx; padding: 20rpx; border-radius: 14rpx; background: #fff2f0; color: #c0392b; font-size: 24rpx; }
.chips { white-space: nowrap; padding: 0 24rpx 12rpx; }
.chip {
  display: inline-block; padding: 12rpx 26rpx; margin-right: 14rpx; border-radius: 999rpx;
  background: #fff; color: #5b7178; font-size: 24rpx; border: 1rpx solid #e2ebec;
}
.chip.on { background: #07262f; color: #fff; border-color: #07262f; }
.section { margin: 12rpx 24rpx 0; }
.section__title { font-size: 28rpx; font-weight: 700; color: #173b40; margin: 12rpx 0 18rpx; }
.empty { padding: 60rpx 20rpx; text-align: center; }
.empty__t { font-size: 26rpx; color: #47636a; }
.empty__d { margin-top: 10rpx; font-size: 22rpx; color: #93a6aa; line-height: 1.6; }
.bill {
  background: #fff; border-radius: 20rpx; padding: 26rpx; margin-bottom: 18rpx;
  box-shadow: 0 6rpx 24rpx rgba(7, 38, 47, 0.05);
}
.bill__top { display: flex; justify-content: space-between; align-items: center; }
.bill__left { display: flex; align-items: center; gap: 14rpx; min-width: 0; }
.bill__dir { padding: 6rpx 14rpx; border-radius: 8rpx; font-size: 20rpx; flex-shrink: 0; }
.bill__dir--out { background: #ffedef; color: #d03050; }
.bill__dir--in { background: #e6f5f1; color: #00766a; }
.bill__name { font-size: 28rpx; font-weight: 600; color: #173b40; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bill__right { display: flex; flex-direction: column; align-items: flex-end; gap: 6rpx; flex-shrink: 0; }
.bill__amount { font-size: 32rpx; font-weight: 800; font-variant-numeric: tabular-nums; }
.bill__amount--out { color: #d03050; }
.bill__amount--in { color: #00766a; }
.bill__arrow { font-size: 20rpx; color: #93a9ac; }
.bill__meta { display: flex; justify-content: space-between; align-items: center; margin-top: 18rpx; font-size: 22rpx; color: #93a6aa; }
.pill { padding: 4rpx 14rpx; border-radius: 999rpx; font-size: 20rpx; }
.pill--pending { background: #fff5e6; color: #b8791b; }
.pill--done { background: #e6f5f1; color: #00766a; }
.detail { margin-top: 20rpx; padding-top: 20rpx; border-top: 1rpx dashed #e2ebec; }
.detail__tip { font-size: 22rpx; color: #93a6aa; text-align: center; padding: 20rpx; }
.detail__head { font-size: 22rpx; color: #47636a; margin-bottom: 16rpx; }
.item { padding: 16rpx 0; border-bottom: 1rpx solid #f1f5f6; }
.item:last-child { border-bottom: none; }
.item__row { display: flex; justify-content: space-between; gap: 16rpx; }
.item__row--sub { margin-top: 8rpx; font-size: 21rpx; color: #8a9ea2; }
.item__code { font-size: 25rpx; color: #173b40; font-weight: 600; }
.item__amount { font-size: 25rpx; color: #d03050; font-weight: 700; }
.item__effect { color: #8a9ea2; flex-shrink: 0; }
.item__effect--add { color: #d03050; }
.foot { margin: 24rpx; font-size: 21rpx; color: #9aabae; line-height: 1.7; }
</style>
