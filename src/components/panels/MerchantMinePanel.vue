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
  <view class="page">
    <view class="hero">
      <view class="hero__row">
        <view class="avatar">{{ (bossName || '商').slice(0, 1) }}</view>
        <view>
          <view class="name">{{ bossName }}</view>
          <view class="sub">{{ storeName || '门店' }} · 店主 · 全权限</view>
        </view>
      </view>
    </view>

    <view v-if="loading" class="skel" />
    <template v-else>
      <view v-if="errorText" class="fail">{{ errorText }}</view>
      <view class="card stats">
        <view class="stat">
          <view class="num">{{ redemptions }}</view>
          <view class="lab">今日核销</view>
        </view>
        <view class="stat">
          <view class="num">{{ pointsIssued }}</view>
          <view class="lab">今日发积分</view>
        </view>
        <view class="stat">
          <view class="num">{{ score ?? '—' }}</view>
          <view class="lab">健康分</view>
        </view>
        <view class="stat">
          <view class="num">1</view>
          <view class="lab">门店</view>
        </view>
      </view>

      <view class="card list">
        <view class="todo" @tap="go('verify')">
          <view class="ico">核</view>
          <view class="main">
            <view class="t">核销台</view>
            <view class="d">扫券码 / 会员码核销</view>
          </view>
          <text class="act">打开</text>
        </view>
        <view class="todo" @tap="goEarn">
          <view class="ico">录</view>
          <view class="main">
            <view class="t">录单发积分</view>
            <view class="d">扫会员码录入消费</view>
          </view>
          <text class="act">打开</text>
        </view>
        <view class="todo" @tap="go('ai')">
          <view class="ico">AI</view>
          <view class="main">
            <view class="t">小Z 智能助手</view>
            <view class="d">问数 · 简报 · 经营建议</view>
          </view>
          <text class="act">打开</text>
        </view>
        <view class="todo" @tap="goStaff">
          <view class="ico">员</view>
          <view class="main">
            <view class="t">店员与权限</view>
            <view class="d">核销权限管理</view>
          </view>
          <text class="act">打开</text>
        </view>
        <view class="todo" @tap="goMarketing">
          <view class="ico">券</view>
          <view class="main">
            <view class="t">营销与卡券</view>
            <view class="d">活动与券模板</view>
          </view>
          <text class="act">打开</text>
        </view>
      </view>

      <button class="logout" hover-class="press" @tap="logout">退出登录</button>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding-bottom: 220rpx; box-sizing: border-box; background: #f3f7f8; }
.hero {
  padding: 28rpx 32rpx 72rpx;
  background: linear-gradient(135deg, #00c9a7 0%, #2e90ff 100%);
  border-radius: 0 0 48rpx 48rpx;
}
.hero__row { display: flex; align-items: center; gap: 20rpx; }
.avatar {
  width: 104rpx; height: 104rpx; border-radius: 36rpx;
  background: rgba(255,255,255,.22); border: 1px solid rgba(255,255,255,.35);
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 40rpx; font-weight: 800;
}
.name { font-size: 38rpx; font-weight: 800; color: #fff; }
.sub { margin-top: 6rpx; font-size: 22rpx; color: rgba(255,255,255,.88); }
.card {
  margin: 0 32rpx 20rpx; background: #fff; border-radius: 40rpx;
  box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.08);
}
.stats { margin-top: -40rpx; display: flex; padding: 28rpx 8rpx; }
.stat { flex: 1; text-align: center; }
.num { font-size: 34rpx; font-weight: 800; color: #0e1f26; }
.lab { margin-top: 6rpx; color: #8a9aa3; font-size: 22rpx; }
.list { padding: 8rpx 24rpx; }
.todo {
  display: flex; align-items: center; gap: 16rpx; padding: 24rpx 0;
  border-bottom: 1px solid #eaf0f2;
}
.todo:last-child { border-bottom: none; }
.ico {
  width: 72rpx; height: 72rpx; border-radius: 22rpx; background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 24rpx;
}
.main { flex: 1; min-width: 0; }
.t { font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.d { margin-top: 4rpx; color: #8a9aa3; font-size: 22rpx; }
.act { color: #009784; font-weight: 700; font-size: 24rpx; }
.logout {
  margin: 12rpx 32rpx 0; background: #fff; color: #c22a2e; border-radius: 999rpx;
  font-weight: 700; border: 1px solid #eaf0f2;
}
.fail { margin: 0 32rpx 16rpx; color: #c22a2e; font-weight: 700; }
.skel { margin: -40rpx 32rpx 20rpx; height: 200rpx; border-radius: 40rpx; background: #e2eaee; }
</style>
