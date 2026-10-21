<script setup lang="ts">
import { ref, watch } from 'vue';
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
type MemberCard = { name: string; avatar: string; balance: number; unused: number };
const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const loading = ref(true);
const name = ref('');
const avatar = ref('');
const balance = ref(0);
const unused = ref(0);
const errorText = ref('');
const switching = ref('');

function applyCard(card: MemberCard) {
  name.value = card.name || '会员';
  avatar.value = card.avatar || '';
  balance.value = card.balance || 0;
  unused.value = card.unused || 0;
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
    await useWalletStore().warm('UNUSED').catch(() => undefined);
    unused.value = useWalletStore().snapshot('UNUSED').total || 0;
    session.profileName = name.value;
    session.avatar = avatar.value;
    uni.setStorageSync('mini_profile_name', name.value);
    if (avatar.value) uni.setStorageSync('mini_avatar', avatar.value);
    writeSticky(CARD_KEY, {
      name: name.value,
      avatar: avatar.value,
      balance: balance.value,
      unused: unused.value,
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

function goHome() {
  useDeskStore().member = 'home';
}

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
    <view class="hero">
      <view class="hero__row">
        <image v-if="avatar" class="avatar" :src="avatar" mode="aspectFill" lazy-load />
        <view v-else class="avatar avatar--ph">{{ name.slice(0, 1) }}</view>
        <view class="meta">
          <view class="name">{{ name }}</view>
          <view class="sub">黄金会员 · 积分 {{ balance }}</view>
        </view>
      </view>
    </view>

    <view v-if="loading" class="skel" />
    <template v-else>
      <view v-if="errorText" class="fail">{{ errorText }}</view>
      <view class="card stats">
        <view class="stat" @tap="go('/pages/member/points/index')">
          <view class="num">{{ balance }}</view>
          <view class="lab">积分</view>
        </view>
        <view class="stat" @tap="goWallet">
          <view class="num">{{ unused }}</view>
          <view class="lab">待用券</view>
        </view>
        <view class="stat" @tap="goHome">
          <view class="num">码</view>
          <view class="lab">会员码</view>
        </view>
      </view>

      <view class="card list">
        <view class="row" @tap="goHome">
          <view class="ico">码</view>
          <view class="row__main">
            <view class="t">我的会员码</view>
            <view class="d">到店出示，店员扫码录积分</view>
          </view>
          <text class="act">打开</text>
        </view>
        <view class="row" @tap="go('/pages/member/points/index')">
          <view class="ico">分</view>
          <view class="row__main">
            <view class="t">积分明细</view>
            <view class="d">查看收支流水</view>
          </view>
          <text class="act">查看</text>
        </view>
        <view class="row" @tap="goWallet">
          <view class="ico">券</view>
          <view class="row__main">
            <view class="t">我的卡包</view>
            <view class="d">{{ unused }} 张待用</view>
          </view>
          <text class="act">查看</text>
        </view>
        <view class="row" @tap="go('/pages/member/galaxy/index')">
          <view class="ico">盟</view>
          <view class="row__main">
            <view class="t">周围商家联盟</view>
            <view class="d">看看联盟里有哪些店</view>
          </view>
          <text class="act">打开</text>
        </view>
      </view>

      <view class="label">开发：直接进入商家</view>
      <view
        v-for="item in MERCHANT_TEST_ACCOUNTS"
        :key="item.username"
        class="dev-row"
        @tap="enterMerchant(item.username)"
      >
        <text>{{ item.label }} · {{ item.hint }}</text>
        <text>{{ switching === item.username ? '进入中' : '进入' }}</text>
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
}
.avatar--ph {
  color: #fff; display: flex; align-items: center; justify-content: center;
  font-size: 40rpx; font-weight: 800;
}
.meta { color: #fff; }
.name { font-size: 38rpx; font-weight: 800; }
.sub { margin-top: 6rpx; font-size: 22rpx; opacity: .88; }
.card {
  margin: 0 32rpx 20rpx; background: #fff; border-radius: 40rpx; padding: 8rpx 24rpx;
  box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.08);
}
.stats { margin-top: -40rpx; display: flex; padding: 28rpx 8rpx; }
.stat { flex: 1; text-align: center; }
.num { font-size: 36rpx; font-weight: 800; color: #0e1f26; }
.lab { margin-top: 6rpx; color: #8a9aa3; font-size: 22rpx; }
.list { padding: 8rpx 20rpx; }
.row {
  display: flex; align-items: center; gap: 16rpx; padding: 24rpx 0;
  border-bottom: 1px solid #eaf0f2;
}
.row:last-child { border-bottom: none; }
.ico {
  width: 72rpx; height: 72rpx; border-radius: 22rpx; background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 26rpx;
}
.row__main { flex: 1; min-width: 0; }
.t { font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.d { margin-top: 4rpx; color: #8a9aa3; font-size: 22rpx; }
.act { color: #009784; font-weight: 700; font-size: 24rpx; }
.label { margin: 8rpx 32rpx 12rpx; color: #8a9aa3; font-size: 24rpx; }
.dev-row {
  margin: 0 32rpx 12rpx; background: #fff; border-radius: 28rpx; padding: 24rpx;
  display: flex; justify-content: space-between; color: #33454f; font-size: 26rpx;
  box-shadow: 0 8rpx 24rpx rgba(10, 60, 58, 0.05);
}
.logout {
  margin: 24rpx 32rpx 0; background: #fff; color: #c22a2e; border-radius: 999rpx;
  font-weight: 700; border: 1px solid #eaf0f2;
}
.fail { margin: 0 32rpx 16rpx; color: #c22a2e; font-weight: 700; }
.skel { margin: -40rpx 32rpx 20rpx; height: 200rpx; border-radius: 40rpx; background: #e2eaee; }
</style>
