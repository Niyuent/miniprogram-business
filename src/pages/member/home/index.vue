<script setup lang="ts">
import { watch } from 'vue';
import { onHide, onLoad, onPullDownRefresh, onReachBottom, onShareAppMessage, onShareTimeline, onShow, onUnload } from '@dcloudio/uni-app';
import { storeToRefs } from 'pinia';
import AppTabBar from '@/components/AppTabBar.vue';
import HomePanel from '@/components/panels/HomePanel.vue';
import MallPanel from '@/components/panels/MallPanel.vue';
import ProfilePanel from '@/components/panels/ProfilePanel.vue';
import WalletPanel from '@/components/panels/WalletPanel.vue';
import { useDeskStore } from '@/stores/desk';
import { acceptInviteQuery, enableShareMenu, memberSharePath } from '@/utils/share';
import { clearQrCanvas, disposeQrCache } from '@/utils/qrImage';

const desk = useDeskStore();
const { member } = storeToRefs(desk);
const titles: Record<string, string> = {
  home: '会员码',
  wallet: '卡包',
  mall: '积分商城',
  profile: '我的',
};

onLoad((query) => {
  const tab = String(query?.tab || '');
  if (tab) desk.member = tab;
  const { invite } = acceptInviteQuery(query);
  if (invite) uni.showToast({ title: '已收到好友邀请', icon: 'none' });
});

watch(member, (key) => {
  uni.setNavigationBarTitle({ title: titles[key] || '会员码' });
}, { immediate: true });

onShow(() => enableShareMenu());
onHide(() => clearQrCanvas());
onUnload(() => disposeQrCache());
onPullDownRefresh(() => { desk.pull += 1; });
onReachBottom(() => { desk.reach += 1; });

onShareAppMessage(() => ({
  title: '来小Z领券，积分当钱花',
  path: memberSharePath(),
}));

onShareTimeline(() => ({
  title: '来小Z领券，积分当钱花',
  query: memberSharePath().split('?')[1] || '',
}));
</script>

<template>
  <view class="desk">
    <home-panel v-show="member === 'home'" :active="member === 'home'" />
    <wallet-panel v-show="member === 'wallet'" :active="member === 'wallet'" />
    <mall-panel v-show="member === 'mall'" :active="member === 'mall'" />
    <profile-panel v-show="member === 'profile'" :active="member === 'profile'" />
    <app-tab-bar :active="member" />
  </view>
</template>

<style scoped>
.desk { min-height: 100vh; background: #f3f7f8; }
</style>
