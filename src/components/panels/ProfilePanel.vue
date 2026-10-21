<script setup lang="ts">
import { ref, watch } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import { useSessionStore } from '@/stores/session';
import { loginMerchantAndRoute, MERCHANT_TEST_ACCOUNTS } from '@/services/auth';
import { fetchMe, fetchPointAccount } from '@/services/member';
import { friendlyMessage } from '@/utils/errors';
import { useDeskStore } from '@/stores/desk';
import { useWalletStore } from '@/stores/wallet';
import { logoutToLogin } from '@/utils/logout';
import { rememberMember } from '@/utils/share';
import { readSticky, writeSticky } from '@/utils/sticky';

const CARD_KEY = 'mini_member_card';
type MemberCard = { name: string; avatar: string; balance: number; rule: string };
const RULE_TEXT = '到店消费后，记录会出现在这里';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const name = ref('');
const avatar = ref('');
const balance = ref(0);
const errorText = ref('');
const ruleText = ref(RULE_TEXT);

function applyCard(card: MemberCard) {
  name.value = card.name || '会员';
  avatar.value = card.avatar || '';
  balance.value = card.balance || 0;
  ruleText.value = card.rule || RULE_TEXT;
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  errorText.value = '';
  try {
    const [me, account] = await Promise.all([fetchMe(), fetchPointAccount()]);
    rememberMember(me.id);
    name.value = me.nickname || session.profileName || '会员';
    avatar.value = me.avatar || session.avatar || '';
    balance.value = account.summary?.available ?? account.account.balance;
    session.profileName = name.value;
    session.avatar = avatar.value;
    uni.setStorageSync('mini_profile_name', name.value);
    if (avatar.value) uni.setStorageSync('mini_avatar', avatar.value);
    writeSticky(CARD_KEY, {
      name: name.value,
      avatar: avatar.value,
      balance: balance.value,
      rule: RULE_TEXT,
    } satisfies MemberCard);
  } catch (error) {
    errorText.value = friendlyMessage(error, '个人资料没有加载出来');
    if (!name.value) name.value = session.profileName || '会员';
  } finally {
    loading.value = false;
  }
}

function go(url: string) {
  uni.navigateTo({ url });
}

function goWallet() {
  useWalletStore().warm('UNUSED').catch(() => undefined);
  useDeskStore().member = 'wallet';
}

const switching = ref('');

function logout() {
  logoutToLogin();
}

async function enterMerchant(username: string) {
  if (switching.value) return;
  switching.value = username;
  try {
    await loginMerchantAndRoute(username);
  } catch (error) {
    switching.value = '';
    uni.showToast({ title: friendlyMessage(error, '商家账号没有登录成功'), icon: 'none' });
  }
}

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    const cached = readSticky<MemberCard>(CARD_KEY);
    if (cached?.name) {
      applyCard(cached);
      loading.value = false;
      load(true);
    } else if (session.profileName) {
      name.value = session.profileName;
      avatar.value = session.avatar || '';
      loading.value = false;
      load(true);
    } else {
      load();
    }
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <view v-if="loading" class="skel" />
    <template v-else>
      <view v-if="errorText" class="fail">{{ errorText }}</view>
      <view class="head">
        <image v-if="avatar" class="avatar" :src="avatar" mode="aspectFill" lazy-load />
        <view v-else class="avatar avatar--ph">{{ name.slice(0, 1) }}</view>
        <view class="name">{{ name }}</view>
      </view>
      <view class="member-code" hover-class="press" hover-start-time="20" @tap="go('/pages/member/qrcode/index')">
        <text class="member-code__title">我的会员码</text>
        <text class="member-code__hint">到店出示，店员扫码录积分</text>
      </view>
      <view class="logout" @tap="logout">退出登录</view>
      <view class="label">直接进入商家</view>
      <view
        v-for="item in MERCHANT_TEST_ACCOUNTS"
        :key="item.username"
        class="row"
        @tap="enterMerchant(item.username)"
      >
        <text>{{ item.label }} · {{ item.hint }}</text>
        <text>{{ switching === item.username ? '进入中' : '进入' }}</text>
      </view>
      <view class="row" @tap="go('/pages/member/points/index')">
        <text>我的积分</text><text>{{ balance }}</text>
      </view>
      <view class="row" @tap="goWallet">
        <text>我的卡包</text><text>查看</text>
      </view>
      <view class="block">
        <view class="block__title">消费记录</view>
        <empty-state title="还没有消费记录" :hint="ruleText" />
      </view>
    </template>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 12rpx 32rpx 220rpx; box-sizing: border-box; }
.head { display: flex; align-items: center; gap: 20rpx; margin-bottom: 12rpx; }
.avatar { width: 112rpx; height: 112rpx; border-radius: 36rpx; background: linear-gradient(160deg, #38bdf8, #14b8a6); }
.avatar--ph { color: #fff; display: flex; align-items: center; justify-content: center; font-size: 44rpx; font-weight: 700; }
.name { font-size: 56rpx; font-weight: 800; }
.member-code {
  margin: 8rpx 0 20rpx;
  padding: 36rpx 28rpx;
  border-radius: 28rpx;
  background: linear-gradient(135deg, #1d4ed8 0%, #0ea5e9 100%);
  color: #fff;
  box-shadow: 0 16rpx 36rpx rgba(29, 78, 216, 0.28);
}
.member-code__title { display: block; font-size: 40rpx; font-weight: 800; }
.member-code__hint { display: block; margin-top: 10rpx; font-size: 24rpx; opacity: 0.9; }
.row { background: rgba(255,255,255,.92); border-radius: 28rpx; padding: 28rpx 24rpx; margin-bottom: 16rpx; display: flex; justify-content: space-between; box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.04); }
.block { background: rgba(255,255,255,.92); border-radius: 32rpx; padding: 8rpx 8rpx 16rpx; margin-bottom: 16rpx; box-shadow: 0 10rpx 24rpx rgba(15, 23, 42, 0.04); }
.block__title { padding: 20rpx 16rpx 0; font-weight: 700; }
.label { margin: 8rpx 0 12rpx; color: #64748b; font-size: 24rpx; }
.logout {
  margin: 8rpx 0 20rpx;
  background: #fff;
  color: #b91c1c;
  text-align: center;
  border-radius: 16rpx;
  padding: 28rpx 24rpx;
  font-weight: 700;
}
.fail { color: #b91c1c; font-weight: 700; margin-bottom: 16rpx; }
.skel { height: 220rpx; border-radius: 16rpx; background: #e2e8f0; }
</style>
