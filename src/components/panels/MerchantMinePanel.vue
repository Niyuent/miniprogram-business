<script setup lang="ts">
import { ref, watch } from 'vue';
import { useSessionStore } from '@/stores/session';
import { fetchFinance, fetchWorkbench } from '@/services/merchant';
import { logoutToLogin } from '@/utils/logout';
import { useDeskStore } from '@/stores/desk';
import { friendlyMessage } from '@/utils/errors';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const storeName = ref('');
const bossName = ref('');
const redemptions = ref(0);
const pointsIssued = ref(0);
const score = ref<number | null>(null);
const errorText = ref('');

async function load() {
  loading.value = true;
  errorText.value = '';
  try {
    const [wb, finance] = await Promise.all([fetchWorkbench(), fetchFinance()]);
    storeName.value = wb.storeName || wb.merchantName;
    bossName.value = wb.bossName || session.profileName || '店主';
    redemptions.value = wb.today.redemptions;
    pointsIssued.value = wb.today.pointsIssued;
    score.value = finance.has_data ? finance.score : null;
  } catch (error) {
    errorText.value = friendlyMessage(error, '商家资料没有加载出来');
    bossName.value = session.profileName || '商家账号';
  } finally {
    loading.value = false;
  }
}

function logout() {
  logoutToLogin();
}

function go(tab: string) {
  useDeskStore().merchant = tab;
}

function goEarn() {
  uni.navigateTo({ url: '/pages/merchant/earn/index' });
}

function goStaff() {
  uni.navigateTo({ url: '/pages/merchant/staff/index' });
}

function goMarketing() {
  uni.navigateTo({ url: '/pages/merchant/marketing/index' });
}

function goSettlement() {
  uni.navigateTo({ url: '/pages/merchant/settlement/index' });
}

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    load();
  },
  { immediate: true },
);
</script>

<template>
  <view class="pm-page">
    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="me-row">
          <view class="me-avatar">{{ (bossName || '商').slice(0, 1) }}</view>
          <view class="me-main">
            <text class="pm-hero__title">{{ bossName }}</text>
            <text class="me-sub">{{ storeName || '门店' }} · 店主账号</text>
          </view>
          <view class="pm-hero__chip">
            <view class="pm-hero__dot" />
            <text>全权限</text>
          </view>
        </view>
      </view>
    </view>

    <view class="pm-body">
      <view v-if="loading" class="pm-card">
        <view class="pm-skel" style="height: 120rpx" />
      </view>
      <template v-else>
        <view v-if="errorText" class="pm-card fail">
          <text class="fail__t">{{ errorText }}</text>
        </view>

        <view class="pm-card stats-card">
          <view class="pm-stats">
            <view class="pm-stat">
              <view class="pm-stat__v">{{ redemptions }}</view>
              <view class="pm-stat__l">今日核销</view>
            </view>
            <view class="pm-stat">
              <view class="pm-stat__v">{{ pointsIssued }}</view>
              <view class="pm-stat__l">今日发分</view>
            </view>
            <view class="pm-stat">
              <view class="pm-stat__v" :class="{ 'pm-teal': score != null }">{{ score ?? '—' }}</view>
              <view class="pm-stat__l">健康分</view>
            </view>
          </view>
        </view>

        <view class="pm-section">
          <text class="pm-section__t">经营与设置</text>
        </view>
        <view class="pm-card pm-card--flush">
          <view class="pm-row" hover-class="press" @tap="go('verify')">
            <view class="row-ico">核</view>
            <view class="pm-row__main">
              <view class="pm-row__t">核销台</view>
              <view class="pm-row__d">扫券码 / 会员码核销</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
          <view class="pm-row" hover-class="press" @tap="goEarn">
            <view class="row-ico row-ico--blue">录</view>
            <view class="pm-row__main">
              <view class="pm-row__t">录单发积分</view>
              <view class="pm-row__d">扫会员码录入消费</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
          <view class="pm-row" hover-class="press" @tap="goSettlement">
            <view class="row-ico row-ico--dark">结</view>
            <view class="pm-row__main">
              <view class="pm-row__t">智能结算</view>
              <view class="pm-row__d">对账账单 · 确认与异议</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
          <view class="pm-row" hover-class="press" @tap="go('ai')">
            <view class="row-ico row-ico--warm">AI</view>
            <view class="pm-row__main">
              <view class="pm-row__t">小Z 智能助手</view>
              <view class="pm-row__d">问数 · 简报 · 经营建议</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
          <view class="pm-row" hover-class="press" @tap="goMarketing">
            <view class="row-ico row-ico--warm">券</view>
            <view class="pm-row__main">
              <view class="pm-row__t">营销与卡券</view>
              <view class="pm-row__d">活动与券模板</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
          <view class="pm-row" hover-class="press" @tap="goStaff">
            <view class="row-ico">员</view>
            <view class="pm-row__main">
              <view class="pm-row__t">店员与权限</view>
              <view class="pm-row__d">核销权限管理</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
        </view>

        <view class="pm-btn pm-btn--ghost logout" hover-class="press" @tap="logout">退出登录</view>
        <view class="foot-hint">小Z 商家端 · 商盟经营系统</view>
      </template>
    </view>
  </view>
</template>

<style scoped>
.me-row { display: flex; align-items: center; gap: 22rpx; }
.me-avatar {
  width: 108rpx; height: 108rpx; border-radius: 32rpx; flex-shrink: 0;
  border: 2rpx solid rgba(255, 255, 255, 0.22);
  background: rgba(255, 255, 255, 0.12); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 40rpx; font-weight: 800;
}
.me-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.me-sub { margin-top: 8rpx; font-size: 22rpx; color: rgba(255, 255, 255, 0.5); }

.stats-card { padding: 30rpx 16rpx; }
.row-ico {
  width: 72rpx; height: 72rpx; border-radius: 22rpx; flex-shrink: 0;
  background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; font-weight: 800;
}
.row-ico--blue { background: #eaf2ff; color: #1c6dd0; }
.row-ico--warm { background: #fff6e8; color: #a9670a; }
.row-ico--dark { background: #07262f; color: #7ff0dd; }

.logout { margin-top: 32rpx; color: #c0342f; }
.foot-hint { margin: 28rpx 0 8rpx; text-align: center; font-size: 20rpx; color: #b3c0c7; }
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
</style>
