<script setup lang="ts">
import { computed } from 'vue';
import { storeToRefs } from 'pinia';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { useDeskStore } from '@/stores/desk';
import { MEMBER_TABS, MERCHANT_TABS, useSessionStore, type MiniRole } from '@/stores/session';

const props = defineProps<{
  active: string;
}>();

const session = useSessionStore();
const { role, tabs } = storeToRefs(session);

interface TabItem {
  key: string;
  text: string;
  url: string;
}

const catalog: Record<string, { text: string; member: string; merchant: string }> = {
  home: { text: '会员码', member: '/pages/member/home/index', merchant: '/pages/member/home/index' },
  wallet: { text: '卡包', member: '/pages/member/wallet/index', merchant: '/pages/member/wallet/index' },
  mall: { text: '积分商城', member: '/pages/member/mall/index', merchant: '/pages/member/mall/index' },
  workbench: { text: '首页', member: '/pages/merchant/workbench/index', merchant: '/pages/merchant/workbench/index' },
  ai: { text: 'AI助手', member: '/pages/merchant/workbench/index', merchant: '/pages/merchant/workbench/index' },
  verify: { text: '核销', member: '/pages/merchant/verify/index', merchant: '/pages/merchant/verify/index' },
  profile: { text: '我的', member: '/pages/member/profile/index', merchant: '/pages/merchant/mine/index' },
};

const keys = computed(() => {
  if (tabs.value.length) {
    return tabs.value.map((k) => (k === 'notification' ? 'ai' : k));
  }
  if (role.value === 'merchant') return [...MERCHANT_TABS];
  if (role.value === 'member') return [...MEMBER_TABS];
  return [];
});

const items = computed<TabItem[]>(() => {
  const side: MiniRole = role.value === 'merchant' ? 'merchant' : 'member';
  return keys.value
    .map((key) => {
      const item = catalog[key];
      if (!item) return null;
      return { key, text: item.text, url: item[side] };
    })
    .filter((item): item is TabItem => item !== null);
});

const accent = computed(() => (role.value === 'merchant' ? '#00b8a0' : '#0e1f26'));

function go(item: TabItem) {
  if (item.key === props.active) return;
  const desk = useDeskStore();
  const route = getCurrentPages().slice(-1)[0]?.route || '';
  const merchantHere = route === 'pages/merchant/workbench/index';
  const memberHere = route === 'pages/member/home/index';
  if (session.role === 'merchant') {
    desk.merchant = item.key;
    if (!merchantHere) uni.reLaunch({ url: '/pages/merchant/workbench/index' });
    return;
  }
  desk.member = item.key;
  if (!memberHere) uni.reLaunch({ url: '/pages/member/home/index' });
}
</script>

<template>
  <view>
    <network-banner />
    <view class="tabbar" :style="{ '--accent': accent }">
      <view class="tabbar__tag">{{ role === 'merchant' ? '商家端' : '会员端' }}</view>
      <view
        v-for="item in items"
        :key="item.key"
        class="tabbar__item"
        :class="{ 'is-active': item.key === active }"
        hover-class="press"
        @tap="go(item)"
      >
        <text class="tabbar__text">{{ item.text }}</text>
      </view>
    </view>
  </view>
</template>

<style scoped>
.tabbar {
  position: fixed;
  left: 28rpx;
  right: 28rpx;
  bottom: 28rpx;
  z-index: 20;
  display: flex;
  align-items: stretch;
  height: 108rpx;
  padding: 8rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.94);
  border: 1px solid #eaf0f2;
  border-radius: 999rpx;
  box-shadow: 0 16rpx 40rpx rgba(10, 60, 58, 0.1);
}
.tabbar__tag {
  position: absolute;
  top: -28rpx;
  left: 28rpx;
  padding: 2rpx 12rpx;
  border-radius: 999rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff;
  font-size: 20rpx;
  line-height: 32rpx;
  font-weight: 700;
}
.tabbar__item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a9aa3;
}
.tabbar__item.is-active {
  color: #fff;
  font-weight: 700;
  background: var(--accent);
  border-radius: 999rpx;
}
.tabbar__text {
  font-size: 26rpx;
}
</style>
