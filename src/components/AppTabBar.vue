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
  shops: { text: '逛商家', member: '/pages/member/galaxy/index', merchant: '/pages/member/galaxy/index' },
  workbench: { text: '首页', member: '/pages/merchant/workbench/index', merchant: '/pages/merchant/workbench/index' },
  ai: { text: 'AI助手', member: '/pages/merchant/workbench/index', merchant: '/pages/merchant/workbench/index' },
  verify: { text: '核销', member: '/pages/merchant/verify/index', merchant: '/pages/merchant/verify/index' },
  profile: { text: '我的', member: '/pages/member/profile/index', merchant: '/pages/merchant/mine/index' },
};

const keys = computed(() => {
  let list: string[] = [];
  if (tabs.value.length) {
    // 老版本 bootstrap / 本地缓存里还是 'mall'，统一收敛到新的「逛商家」
    list = tabs.value.map((k) => (k === 'notification' ? 'ai' : k === 'mall' ? 'shops' : k));
  } else if (role.value === 'merchant') list = [...MERCHANT_TABS];
  else if (role.value === 'member') list = [...MEMBER_TABS];
  // 老缓存可能压根没有商城/商家这一项，硬补上，避免「逛商家」入口消失
  if (role.value !== 'merchant' && list.length && !list.includes('shops')) {
    const at = list.indexOf('wallet');
    list.splice(at >= 0 ? at + 1 : list.length, 0, 'shops');
  }
  return list;
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

function go(item: TabItem) {
  if (item.key === props.active) return;
  const desk = useDeskStore();
  const route = getCurrentPages().slice(-1)[0]?.route || '';
  const merchantHere = route === 'pages/merchant/workbench/index';
  const memberHere = route === 'pages/member/home/index';
  // 「逛商家」是独立页面（不是首页里的面板），整页切换过去
  if (item.key === 'shops') {
    if (route !== 'pages/member/galaxy/index') {
      uni.reLaunch({ url: '/pages/member/galaxy/index' });
    }
    return;
  }
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
    <view class="tabbar">
      <view class="tabbar__tag">
        <view class="tabbar__dot" />
        <text class="tabbar__tagtext">{{ role === 'merchant' ? '商家端' : '会员端' }}</text>
      </view>
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
  bottom: calc(28rpx + env(safe-area-inset-bottom));
  z-index: 20;
  display: flex;
  align-items: stretch;
  height: 108rpx;
  padding: 8rpx;
  box-sizing: border-box;
  background: rgba(255, 255, 255, 0.96);
  border: 1rpx solid #eaf0f2;
  border-radius: 999rpx;
  box-shadow: 0 20rpx 48rpx rgba(7, 38, 47, 0.14);
}
.tabbar__tag {
  position: absolute;
  top: -34rpx;
  left: 32rpx;
  display: flex;
  align-items: center;
  gap: 6rpx;
  padding: 0 16rpx;
  height: 32rpx;
  border-radius: 999rpx;
  background: #07262f;
}
.tabbar__dot {
  width: 8rpx;
  height: 8rpx;
  border-radius: 50%;
  background: #00d6b2;
}
.tabbar__tagtext {
  font-size: 18rpx;
  line-height: 32rpx;
  color: #d8f7f1;
  letter-spacing: 1rpx;
}
.tabbar__item {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #8a9aa3;
  border-radius: 999rpx;
  transition: background 0.18s ease, color 0.18s ease;
}
.tabbar__item.is-active {
  color: #ffffff;
  background: #07262f;
  box-shadow: 0 10rpx 24rpx rgba(7, 38, 47, 0.22);
}
.tabbar__text {
  font-size: 26rpx;
}
.tabbar__item.is-active .tabbar__text {
  font-weight: 700;
}
</style>
