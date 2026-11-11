<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import {
  fetchAllianceDetail,
  type AllianceDetailView,
  type AllianceMember,
} from '@/services/alliance-insight';
import { useSessionStore } from '@/stores/session';
import { friendlyMessage } from '@/utils/errors';
import { money } from '@/utils/format';

/** 联盟详情：成员商家与门店、本店经营、清分与对账。 */
const session = useSessionStore();
const allianceId = ref(0);
const loading = ref(true);
const errorText = ref('');
const data = ref<AllianceDetailView | null>(null);
const expanded = ref(0);

const members = computed<AllianceMember[]>(() => data.value?.members ?? []);
const isCurrent = computed(() => session.currentAllianceId === allianceId.value);

function shortDate(iso: string) {
  return iso ? String(iso).replace('T', ' ').slice(0, 10) : '';
}

async function load(silent = false) {
  if (!allianceId.value) return;
  if (!silent) loading.value = true;
  errorText.value = '';
  try {
    data.value = await fetchAllianceDetail(allianceId.value);
  } catch (e) {
    errorText.value = friendlyMessage(e, '联盟详情暂时读不到');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function toggle(id: number) {
  expanded.value = expanded.value === id ? 0 : id;
}

function setCurrent() {
  session.setCurrentAlliance(allianceId.value);
  uni.showToast({ title: '已设为默认联盟', icon: 'none' });
}

onLoad((query) => {
  allianceId.value = Number(query?.id || 0);
  session.hydrate();
  load();
});
onPullDownRefresh(() => load(true));
</script>

<template>
  <view class="page">
    <view v-if="loading && !data" class="empty">正在读取联盟详情…</view>
    <view v-else-if="errorText && !data" class="err">{{ errorText }}</view>

    <template v-else-if="data">
      <view class="hero">
        <view class="hero__eyebrow">联盟详情 · #{{ data.alliance.id }}</view>
        <view class="hero__title">{{ data.alliance.name }}</view>
        <view class="hero__sub">
          发起人 {{ data.alliance.mainMerchantName || '—' }} ·
          {{ data.alliance.memberCount }} 家商家 · {{ data.alliance.storeCount }} 家门店
        </view>
        <view class="hero__note">{{ data.scopeNote }}</view>
      </view>

      <view v-if="errorText" class="err">{{ errorText }}</view>

      <view class="section">本店在这个联盟</view>
      <view class="panel">
        <view class="grid">
          <view class="grid__cell">
            <text class="grid__v">{{ data.myStats.issuedPoints }}</text>
            <text class="grid__l">发出积分</text>
          </view>
          <view class="grid__cell">
            <text class="grid__v">{{ data.myStats.earnCount }}</text>
            <text class="grid__l">发分笔数</text>
          </view>
          <view class="grid__cell">
            <text class="grid__v">{{ data.myStats.exchangeCount }}</text>
            <text class="grid__l">被兑换券</text>
          </view>
        </view>
        <view class="grid grid--second">
          <view class="grid__cell">
            <text class="grid__v">{{ data.myStats.exchangePoints }}</text>
            <text class="grid__l">兑换花掉积分</text>
          </view>
          <view class="grid__cell">
            <text class="grid__v">{{ data.myStats.redeemCount }}</text>
            <text class="grid__l">核销券</text>
          </view>
          <view class="grid__cell">
            <text class="grid__v">¥{{ money(data.myStats.redeemAmount) }}</text>
            <text class="grid__l">核销面值</text>
          </view>
        </view>
        <view class="panel__foot">
          发布 {{ data.myStats.templateCount }} 个券种 · 已发放 {{ data.myStats.issuedCoupons }} 张
        </view>
      </view>

      <view class="section">成员商家与门店</view>
      <view v-if="!members.length" class="empty">暂无成员</view>
      <view v-for="m in members" :key="m.merchantId" class="member">
        <view class="member__row" hover-class="press" @tap="toggle(m.merchantId)">
          <view class="member__main">
            <view class="member__t">
              {{ m.name }}
              <text v-if="m.isSelf" class="tag tag--on">本店</text>
              <text v-if="m.isManager" class="tag">可管理</text>
            </view>
            <view class="member__d">{{ m.storeCount }} 家门店{{ m.address ? ' · ' + m.address : '' }}</view>
            <view v-if="m.stats" class="member__s">
              发分 {{ m.stats.issuedPoints }} · 被兑换 {{ m.stats.exchangeCount }} ·
              核销 {{ m.stats.redeemCount }} · 发券 {{ m.stats.issuedCoupons }}
            </view>
            <view v-else class="member__s member__s--muted">经营数字仅本店可见</view>
          </view>
          <text class="member__x">{{ expanded === m.merchantId ? '收起' : '门店 ›' }}</text>
        </view>
        <view v-if="expanded === m.merchantId" class="shops">
          <view v-for="s in m.stores" :key="s.id" class="shop">
            <text class="shop__n">{{ s.name }}</text>
            <text class="shop__a">{{ s.address }}</text>
          </view>
          <view v-if="!m.stores.length" class="shop shop--muted">这家商家还没有营业中的门店</view>
        </view>
      </view>

      <view class="section">清分与结算</view>
      <view class="panel">
        <view class="pair">
          <view class="pair__cell">
            <text class="pair__l">我该补给别家</text>
            <text class="pair__v pair__v--out">¥{{ money(data.money.payable) }}</text>
          </view>
          <view class="pair__line" />
          <view class="pair__cell">
            <text class="pair__l">别家该补我</text>
            <text class="pair__v pair__v--in">¥{{ money(data.money.receivable) }}</text>
          </view>
        </view>
        <view class="panel__foot">
          净额 ¥{{ money(data.money.net) }} · {{ data.money.billCount }} 条互结账单 ·
          平台对账 {{ data.money.settlement.reportCount }} 张 / ¥{{ money(data.money.settlement.totalAmount) }}
        </view>
        <view class="panel__foot panel__foot--note">{{ data.money.scopeNote }}</view>
      </view>

      <view v-if="data.money.bills.length" class="panel panel--list">
        <view v-for="b in data.money.bills.slice(0, 10)" :key="b.id" class="bill">
          <view class="bill__t">{{ b.payerMerchantName }} → {{ b.receiverMerchantName }}</view>
          <view class="bill__d">{{ b.periodKey }} · {{ b.status === 'SETTLED' ? '已结算' : '待结算' }}</view>
          <text class="bill__v">¥{{ money(b.netAmount) }}</text>
        </view>
      </view>

      <view v-if="data.money.settlement.reports.length" class="panel panel--list">
        <view v-for="r in data.money.settlement.reports.slice(0, 6)" :key="r.id" class="bill">
          <view class="bill__t">对账单 {{ r.reportNo }}</view>
          <view class="bill__d">{{ shortDate(r.periodStart) }} ~ {{ shortDate(r.periodEnd) }} · {{ r.status }}</view>
          <text class="bill__v">¥{{ money(r.totalAmount) }}</text>
        </view>
      </view>

      <view class="btn" :class="{ 'btn--on': isCurrent }" hover-class="press" @tap="setCurrent">
        {{ isCurrent ? '✓ 已是默认联盟' : '设为默认联盟（发分 / 发券归属）' }}
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx 28rpx 70rpx; box-sizing: border-box; }
.hero {
  padding: 32rpx; border-radius: 26rpx; color: #fff;
  background: linear-gradient(135deg, #006d63, #0b8b7b);
}
.hero__eyebrow { font-size: 22rpx; opacity: .82; }
.hero__title { margin-top: 12rpx; font-size: 40rpx; font-weight: 800; }
.hero__sub { margin-top: 10rpx; font-size: 23rpx; opacity: .9; }
.hero__note {
  margin-top: 18rpx; padding: 12rpx 16rpx; border-radius: 14rpx;
  background: rgba(255,255,255,.16); font-size: 21rpx; line-height: 1.5;
}
.err { margin-top: 20rpx; padding: 18rpx 22rpx; border-radius: 16rpx; background: #fff4e5; color: #a4611f; font-size: 23rpx; }
.empty { margin: 50rpx 0; text-align: center; color: #8a9aa3; font-size: 25rpx; }
.section { margin: 32rpx 4rpx 14rpx; font-size: 26rpx; font-weight: 700; color: #213a43; }
.panel {
  padding: 24rpx 26rpx; border-radius: 22rpx; background: #fff;
  box-shadow: 0 6rpx 24rpx rgba(15, 55, 62, .06); margin-bottom: 18rpx;
}
.panel--list { padding: 8rpx 26rpx; }
.grid { display: flex; }
.grid--second { margin-top: 22rpx; padding-top: 22rpx; border-top: 1rpx solid #eef3f4; }
.grid__cell { flex: 1; display: flex; flex-direction: column; align-items: center; }
.grid__v { font-size: 31rpx; font-weight: 800; color: #006d63; font-variant-numeric: tabular-nums; }
.grid__l { margin-top: 6rpx; font-size: 20rpx; color: #8a9aa3; }
.panel__foot {
  margin-top: 20rpx; padding-top: 16rpx; border-top: 1rpx solid #eef3f4;
  font-size: 22rpx; color: #6b838c; line-height: 1.6;
}
.panel__foot--note { border-top: 0; padding-top: 6rpx; margin-top: 0; color: #9aabb1; font-size: 20rpx; }
.member {
  margin-bottom: 16rpx; border-radius: 20rpx; background: #fff; overflow: hidden;
  box-shadow: 0 6rpx 24rpx rgba(15, 55, 62, .05);
}
.member__row { display: flex; align-items: center; padding: 24rpx 26rpx; }
.member__main { flex: 1; min-width: 0; }
.member__t { font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.tag { margin-left: 10rpx; font-size: 19rpx; color: #4b6a73; padding: 3rpx 10rpx; border-radius: 10rpx; background: #eef4f5; }
.tag--on { color: #fff; background: #0b8b7b; }
.member__d { margin-top: 8rpx; font-size: 21rpx; color: #7e939b; }
.member__s { margin-top: 10rpx; font-size: 21rpx; color: #006d63; }
.member__s--muted { color: #a3b3b9; }
.member__x { flex-shrink: 0; margin-left: 16rpx; font-size: 22rpx; color: #0b8b7b; }
.shops { padding: 0 26rpx 20rpx; }
.shop {
  display: flex; justify-content: space-between; gap: 16rpx;
  padding: 14rpx 0; border-top: 1rpx solid #f0f5f6; font-size: 22rpx;
}
.shop__n { color: #35525b; }
.shop__a { color: #93a6ad; text-align: right; }
.shop--muted { color: #a3b3b9; justify-content: center; }
.pair { display: flex; align-items: center; }
.pair__cell { flex: 1; display: flex; flex-direction: column; align-items: center; }
.pair__line { width: 1rpx; height: 60rpx; background: #eef3f4; }
.pair__l { font-size: 21rpx; color: #8a9aa3; }
.pair__v { margin-top: 8rpx; font-size: 34rpx; font-weight: 800; font-variant-numeric: tabular-nums; }
.pair__v--out { color: #c0342f; }
.pair__v--in { color: #006d63; }
.bill { position: relative; padding: 20rpx 0; border-bottom: 1rpx solid #f0f5f6; }
.bill:last-child { border-bottom: 0; }
.bill__t { font-size: 25rpx; color: #213a43; font-weight: 600; padding-right: 140rpx; }
.bill__d { margin-top: 6rpx; font-size: 21rpx; color: #93a6ad; }
.bill__v { position: absolute; right: 0; top: 22rpx; font-size: 27rpx; font-weight: 800; color: #006d63; }
.btn {
  margin-top: 32rpx; padding: 26rpx; border-radius: 20rpx; text-align: center;
  background: #0b8b7b; color: #fff; font-size: 27rpx; font-weight: 700;
}
.btn--on { background: #e6f2f0; color: #006d63; }
</style>
