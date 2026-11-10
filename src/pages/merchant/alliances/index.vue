<script setup lang="ts">
import { computed, ref } from 'vue';
import { onPullDownRefresh, onShow } from '@dcloudio/uni-app';
import {
  fetchMyAlliances,
  type MyAllianceRow,
  type MyAlliancesView,
} from '@/services/alliance-insight';
import { useSessionStore } from '@/stores/session';
import { friendlyMessage } from '@/utils/errors';

/**
 * 商家端「我的联盟」。
 * 登录只分商家 / 会员两类，这里不再出现主体 / 附属字样；
 * 「可管理」表示在该联盟能查看全部成员的经营数字。
 */
const session = useSessionStore();
const loading = ref(true);
const errorText = ref('');
const data = ref<MyAlliancesView | null>(null);

const list = computed<MyAllianceRow[]>(() => data.value?.list ?? []);
const currentId = computed(() => session.currentAllianceId);
const currentName = computed(
  () => list.value.find((r) => r.allianceId === currentId.value)?.name ?? '',
);

async function load(silent = false) {
  if (!silent) loading.value = true;
  errorText.value = '';
  try {
    session.hydrate();
    const res = await fetchMyAlliances();
    data.value = res;
    const ids = res.list.map((r) => r.allianceId);
    // 校验缓存里的当前联盟仍然有效；只有一个联盟时自动设为默认，避免每次发分都要手选
    if (currentId.value && !ids.includes(currentId.value)) session.setCurrentAlliance(0);
    if (!session.currentAllianceId && ids.length === 1) session.setCurrentAlliance(ids[0]);
    if (!session.currentAllianceId && ids.length > 1) {
      // 多联盟不替商家做主：列表页会显示「设为默认」提示
    }
  } catch (e) {
    errorText.value = friendlyMessage(e, '联盟数据暂时读不到');
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function setCurrent(row: MyAllianceRow) {
  session.setCurrentAlliance(row.allianceId);
  uni.showToast({ title: `已设为默认：${row.name}`, icon: 'none' });
}

function openDetail(row: MyAllianceRow) {
  uni.navigateTo({ url: `/pages/merchant/alliances/detail?id=${row.allianceId}` });
}

onShow(() => load(true));
onPullDownRefresh(() => load(true));
</script>

<template>
  <view class="page">
    <view class="hero">
      <view class="hero__eyebrow">我的联盟 · 只看已加入的</view>
      <view class="hero__title">{{ currentName || '未设置默认联盟' }}</view>
      <view class="hero__sub">
        {{
          currentName
            ? '录单发分、发放券默认归属这个联盟，可在下方切换'
            : '选一个联盟作为默认归属；发分和发券会记到它名下'
        }}
      </view>
      <view class="hero__count">{{ data?.total ?? 0 }} 个联盟</view>
    </view>

    <view v-if="errorText" class="err">{{ errorText }}</view>
    <view v-if="loading && !data" class="empty">正在读取联盟…</view>

    <view v-else-if="!list.length" class="empty">
      <view class="empty__t">还没有加入任何联盟</view>
      <view class="empty__d">加入联盟后，这里会列出成员商家、门店与本店的经营数据</view>
    </view>

    <template v-else>
      <view class="section">联盟列表</view>
      <view
        v-for="row in list"
        :key="row.allianceId"
        class="card"
        :class="{ 'card--on': row.allianceId === currentId }"
        hover-class="press"
        @tap="openDetail(row)"
      >
        <view class="card__hd">
          <text class="card__name">{{ row.name }}</text>
          <text v-if="row.allianceId === currentId" class="tag tag--on">默认</text>
          <text v-if="row.isManager" class="tag">可管理</text>
        </view>
        <view class="card__meta">
          {{ row.memberCount }} 家商家 · {{ row.storeCount }} 家门店
        </view>

        <view class="grid">
          <view class="grid__cell">
            <text class="grid__v">{{ row.myStats.issuedPoints }}</text>
            <text class="grid__l">发出积分</text>
          </view>
          <view class="grid__cell">
            <text class="grid__v">{{ row.myStats.exchangeCount }}</text>
            <text class="grid__l">被兑换券</text>
          </view>
          <view class="grid__cell">
            <text class="grid__v">{{ row.myStats.redeemCount }}</text>
            <text class="grid__l">核销券</text>
          </view>
          <view class="grid__cell">
            <text class="grid__v">{{ row.myStats.templateCount }}</text>
            <text class="grid__l">发布券种</text>
          </view>
        </view>

        <view class="card__ft">
          <text class="card__link">查看成员与结算 ›</text>
          <view
            v-if="row.allianceId !== currentId"
            class="card__btn"
            hover-class="press"
            @tap.stop="setCurrent(row)"
          >设为默认</view>
        </view>
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 24rpx 28rpx 60rpx; box-sizing: border-box; }
.hero {
  position: relative; padding: 34rpx 32rpx 30rpx; border-radius: 26rpx;
  background: linear-gradient(135deg, #006d63, #0b8b7b); color: #fff; overflow: hidden;
}
.hero__eyebrow { font-size: 22rpx; opacity: .82; }
.hero__title { margin-top: 14rpx; font-size: 42rpx; font-weight: 800; }
.hero__sub { margin-top: 12rpx; font-size: 23rpx; line-height: 1.6; opacity: .88; }
.hero__count {
  position: absolute; right: 28rpx; top: 32rpx; font-size: 22rpx;
  padding: 6rpx 16rpx; border-radius: 20rpx; background: rgba(255,255,255,.18);
}
.err { margin-top: 20rpx; padding: 18rpx 22rpx; border-radius: 16rpx; background: #fff4e5; color: #a4611f; font-size: 23rpx; }
.empty { margin-top: 60rpx; text-align: center; color: #8a9aa3; font-size: 25rpx; }
.empty__t { font-size: 28rpx; color: #47606a; font-weight: 600; }
.empty__d { margin-top: 12rpx; font-size: 22rpx; line-height: 1.6; }
.section { margin: 34rpx 4rpx 16rpx; font-size: 26rpx; font-weight: 700; color: #213a43; }
.card {
  margin-bottom: 20rpx; padding: 26rpx 28rpx 20rpx; border-radius: 22rpx;
  background: #fff; box-shadow: 0 6rpx 24rpx rgba(15, 55, 62, .06);
}
.card--on { border: 2rpx solid #0b8b7b; }
.card__hd { display: flex; align-items: center; gap: 12rpx; }
.card__name { font-size: 31rpx; font-weight: 800; color: #0e1f26; }
.tag {
  font-size: 20rpx; color: #4b6a73; padding: 4rpx 12rpx;
  border-radius: 12rpx; background: #eef4f5;
}
.tag--on { color: #fff; background: #0b8b7b; }
.card__meta { margin-top: 8rpx; font-size: 22rpx; color: #7e939b; }
.grid { display: flex; margin-top: 24rpx; padding: 20rpx 0; border-top: 1rpx solid #eef3f4; }
.grid__cell { flex: 1; display: flex; flex-direction: column; align-items: center; }
.grid__v { font-size: 32rpx; font-weight: 800; color: #006d63; font-variant-numeric: tabular-nums; }
.grid__l { margin-top: 6rpx; font-size: 20rpx; color: #8a9aa3; }
.card__ft { display: flex; align-items: center; justify-content: space-between; padding-top: 16rpx; border-top: 1rpx solid #eef3f4; }
.card__link { font-size: 23rpx; color: #0b8b7b; }
.card__btn { font-size: 22rpx; color: #006d63; padding: 10rpx 22rpx; border: 1rpx solid #0b8b7b; border-radius: 30rpx; }
</style>
