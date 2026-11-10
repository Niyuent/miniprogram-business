<script setup lang="ts">
import { ref } from 'vue';
import { onPullDownRefresh, onReachBottom, onShow } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { dayText, fetchPointAccount, fetchPointTransactions } from '@/services/member';
import type { MerchantPointBucket } from '@/services/member';
import { friendlyMessage } from '@/utils/errors';

const loading = ref(true);
const loadingMore = ref(false);
const errorText = ref('');
/** 汇总取自账户接口的真实全量数据；拉不到就整块不渲染，不用流水列表去凑数字。 */
const summary = ref<{ available: number; expiringSoon: number } | null>(null);
/** 按发分商家拆开的可用积分：在哪家消费就在哪家获得 */
const buckets = ref<MerchantPointBucket[]>([]);

async function loadSummary() {
  try {
    const data = await fetchPointAccount();
    summary.value = {
      available: data.summary?.available ?? data.account?.balance ?? 0,
      expiringSoon: data.summary?.expiringSoon ?? 0,
    };
    buckets.value = data.byMerchant ?? [];
  } catch {
    summary.value = null;
    buckets.value = [];
  }
}
type PointRow = {
  id: number;
  label: string;
  amount: number;
  day: string;
  allianceName: string;
  merchantName: string;
  kindTag: string;
  kindClass: string;
  isEarn: boolean;
};
const list = ref<PointRow[]>([]);
const page = ref(1);
const total = ref(0);

const typeText: Record<string, string> = {
  EARN: '获得',
  SPEND: '使用',
  EXPIRE: '过期',
  ADJUST: '调整',
  REFUND: '退回',
};

function mapRow(row: {
  id: number;
  type: string;
  amount: number;
  createdAt: string;
  allianceName?: string | null;
  sourceRole?: 'MAIN' | 'SUB' | null;
  merchantName?: string | null;
}): PointRow {
  const isEarn = row.type === 'EARN' && row.amount > 0;
  const isSub = row.sourceRole === 'SUB';
  let label = typeText[row.type] || row.type;
  let kindTag = '';
  let kindClass = '';
  if (isEarn) {
    kindTag = isSub ? '专属积分' : '通用积分';
    kindClass = isSub ? 'pm-pill--warn' : 'pm-pill--teal';
    label = isSub ? '本店消费获得' : '联盟内消费获得';
  }
  return {
    id: row.id,
    label,
    amount: row.amount,
    day: dayText(row.createdAt),
    allianceName: row.allianceName || '',
    merchantName: row.merchantName || '',
    kindTag,
    kindClass,
    isEarn,
  };
}

async function load(reset: boolean) {
  if (reset) {
    page.value = 1;
    loading.value = list.value.length === 0;
  } else {
    if (list.value.length >= 50) return;
    loadingMore.value = true;
  }
  try {
    const data = await fetchPointTransactions(reset ? 1 : page.value, 10);
    total.value = data.total;
    const rows = (data.list || []).map(mapRow);
    list.value = reset ? rows : list.value.concat(rows).slice(0, 50);
    errorText.value = '';
  } catch (error) {
    if (!list.value.length) errorText.value = friendlyMessage(error, '积分明细没有加载出来');
  } finally {
    loading.value = false;
    loadingMore.value = false;
    uni.stopPullDownRefresh();
  }
}

function more() {
  if (loading.value || loadingMore.value || list.value.length >= total.value) return;
  page.value += 1;
  load(false);
}

/** 从某家店点「去兑换」：带着 merchantId 直达那家店自己的兑换区 */
function goExchange(merchantId: number) {
  uni.navigateTo({ url: `/pages/member/galaxy/index?merchantId=${merchantId}` });
}

onShow(() => {
  loadSummary();
  load(true);
});
onPullDownRefresh(() => load(true));
onReachBottom(() => more());
</script>

<template>
  <view class="pm-page pm-page--plain">
    <network-banner />

    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="hero-top">
          <text class="pm-hero__title">积分明细</text>
          <text class="hero-sub">{{ total }} 条记录</text>
        </view>
        <view class="pm-bignum hero-num">
          <text class="pm-bignum__v">{{ summary ? summary.available : '—' }}</text>
          <text class="pm-bignum__u">积分总览</text>
        </view>
        <view v-if="summary && summary.expiringSoon > 0" class="pm-hero__chip hero-chip">
          <view class="pm-hero__dot" />
          <text>{{ summary.expiringSoon }} 分即将过期</text>
        </view>
      </view>
    </view>

    <view class="pm-body">
      <view class="pm-card hint">
        上面是所有店的积分总览；兑换时按店单独算，在哪家攒的分就只能在那家店换券
      </view>

      <view v-if="buckets.length" class="pm-card pm-card--flush byshop">
        <view class="byshop__head">
          <text class="byshop__title">按店查看</text>
          <text class="byshop__sub">点「去兑换」进这家店自己的兑换区</text>
        </view>
        <view v-for="b in buckets" :key="b.merchantId" class="shop">
          <view class="shop__main">
            <view class="shop__top">
              <text class="shop__name">{{ b.merchantName }}</text>
              <text class="pm-pill" :class="b.role === 'SUB' ? 'pm-pill--warn' : 'pm-pill--teal'">
                {{ b.kindName }}
              </text>
            </view>
            <text class="shop__scope">只在这家店的兑换区可用</text>
            <text v-if="b.expiringSoon > 0" class="shop__soon">{{ b.expiringSoon }} 分即将过期</text>
          </view>
          <view class="shop__right">
            <view class="shop__points">
              <text class="shop__num">{{ b.available }}</text>
              <text class="shop__unit">分</text>
            </view>
            <text class="shop__go" hover-class="press" @tap.stop="goExchange(b.merchantId)">去兑换 ›</text>
          </view>
        </view>
      </view>

      <view v-if="loading && !list.length">
        <view class="pm-card"><view class="pm-skel" style="height: 240rpx" /></view>
      </view>
      <view v-else-if="errorText && !list.length" class="pm-card fail">
        <text class="fail__t">{{ errorText }}</text>
      </view>
      <view v-else-if="!list.length" class="pm-card pm-empty">
        <view class="pm-empty__t">还没有积分明细</view>
        <view class="pm-empty__d">获得或使用积分后会出现在这里</view>
      </view>
      <view v-else class="pm-card pm-card--flush">
        <view v-for="item in list" :key="item.id" class="rec">
          <view class="rec__main">
            <view class="rec__top">
              <text class="rec__label">{{ item.label }}</text>
              <text v-if="item.kindTag" class="pm-pill" :class="item.kindClass">{{ item.kindTag }}</text>
            </view>
            <text class="rec__sub">
              {{ item.day }}<text v-if="item.merchantName || item.allianceName"> · {{ item.merchantName || item.allianceName }}</text>
            </text>
          </view>
          <text class="rec__amt" :class="item.amount >= 0 ? 'is-plus' : 'is-minus'">
            {{ item.amount > 0 ? '+' : '' }}{{ item.amount }}
          </text>
        </view>
      </view>

      <text v-if="loadingMore" class="more">正在加载…</text>
      <text v-else-if="list.length >= total || list.length >= 50" class="more">没有更多了</text>
    </view>
  </view>
</template>

<style scoped>
.hero-top { display: flex; align-items: center; justify-content: space-between; }
.hero-sub { font-size: 20rpx; color: rgba(255, 255, 255, 0.5); }
.hero-num { margin-top: 16rpx; }
.hero-chip { margin-top: 16rpx; }

.hint {
  font-size: 22rpx; color: #00766a; line-height: 1.5;
  background: #e8fbf7; border-color: #c7f5eb;
  margin-bottom: 20rpx;
}

.byshop { margin-bottom: 20rpx; }
.byshop__head {
  display: flex; align-items: baseline; justify-content: space-between;
  padding: 26rpx 30rpx 18rpx;
}
.byshop__title { font-size: 27rpx; font-weight: 700; color: #0e1f26; }
.byshop__sub { font-size: 21rpx; color: #8a9aa3; }

.shop {
  display: flex; align-items: center; gap: 20rpx;
  padding: 22rpx 30rpx;
}
.shop + .shop { border-top: 1rpx solid #f2f6f7; }
.shop__main { flex: 1; min-width: 0; }
.shop__top { display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap; }
.shop__name {
  font-size: 26rpx; font-weight: 600; color: #0e1f26;
  max-width: 340rpx; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.shop__scope { display: block; margin-top: 8rpx; font-size: 21rpx; color: #8a9aa3; line-height: 1.4; }
.shop__soon { display: block; margin-top: 6rpx; font-size: 20rpx; color: #c0342f; }
.shop__right {
  display: flex; flex-direction: column; align-items: flex-end;
  gap: 10rpx; flex-shrink: 0;
}
.shop__points { display: flex; align-items: baseline; gap: 4rpx; }
.shop__num {
  font-size: 32rpx; font-weight: 800; color: #00766a;
  font-variant-numeric: tabular-nums;
}
.shop__unit { font-size: 20rpx; color: #8a9aa3; }
.shop__go {
  padding: 8rpx 18rpx; border-radius: 999rpx;
  background: #e8fbf7; color: #00766a;
  font-size: 21rpx; font-weight: 700; white-space: nowrap;
}

.rec {
  display: flex; align-items: center; gap: 20rpx;
  padding: 26rpx 30rpx;
}
.rec + .rec { border-top: 1rpx solid #f2f6f7; }
.rec__main { flex: 1; min-width: 0; }
.rec__top { display: flex; align-items: center; gap: 12rpx; flex-wrap: wrap; }
.rec__label { font-size: 27rpx; font-weight: 600; color: #0e1f26; }
.rec__sub { display: block; margin-top: 8rpx; font-size: 22rpx; color: #8a9aa3; }
.rec__amt {
  flex-shrink: 0; font-size: 32rpx; font-weight: 800;
  font-variant-numeric: tabular-nums;
}
.is-plus { color: #00766a; }
.is-minus { color: #c0342f; }

.more { display: block; text-align: center; font-size: 22rpx; color: #8a9aa3; padding: 28rpx 0; }
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
</style>
