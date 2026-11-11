<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useSessionStore } from '@/stores/session';
import { phoneLoginAndRoute, switchRole, MERCHANT_TEST_ACCOUNTS } from '@/services/auth';
import { fetchMe, fetchPointAccount, type AlliancePointAccount } from '@/services/member';
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
const pointAccounts = ref<AlliancePointAccount[]>([]);
const errorText = ref('');
const switching = ref('');

/** 累计获得积分：只增不减，作为身份分级依据，消费兑换都不影响。 */
const totalEarned = computed(() =>
  pointAccounts.value.reduce((sum, item) => sum + (item.totalEarned || 0), 0),
);

/**
 * 三级身份 + 到下一级的进度。
 * 阈值只是身份感，不承诺任何折扣权益，避免运营侧兑现不了。
 */
const level = computed(() => {
  const earned = totalEarned.value;
  if (earned >= 2000) return { text: '老友', next: '', need: 0, pct: 100 };
  if (earned >= 500) {
    return {
      text: '熟客',
      next: '老友',
      need: 2000 - earned,
      pct: Math.min(99, Math.round((earned / 2000) * 100)),
    };
  }
  return {
    text: earned > 0 ? '常客' : '新会员',
    next: earned > 0 ? '熟客' : '常客',
    need: 500 - earned,
    pct: Math.round((earned / 500) * 100),
  };
});

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
    pointAccounts.value = account.accounts?.length ? account.accounts : [];
    balance.value =
      account.summary?.totalBalance ??
      pointAccounts.value.reduce((s, a) => s + a.balance, 0) ??
      account.summary?.available ??
      account.account.balance;
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

async function enterMerchant(phone: string) {
  if (switching.value) return;
  switching.value = phone;
  try {
    await phoneLoginAndRoute(phone);
  } catch (error) {
    switching.value = '';
    uni.showToast({ title: friendlyMessage(error, '商家账号没有登录成功'), icon: 'none' });
  }
}

/** 手机号同时挂了商家账号时，一键切到商家端（后端按手机号换发令牌） */
async function switchToMerchant() {
  if (switching.value) return;
  switching.value = 'switch';
  try {
    await switchRole('merchant');
  } catch (error) {
    switching.value = '';
    uni.showToast({ title: friendlyMessage(error, '这个手机号没有商家账号'), icon: 'none' });
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
  <view class="pm-page">
    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="me-row">
          <image v-if="avatar" class="me-avatar" :src="avatar" mode="aspectFill" lazy-load />
          <view v-else class="me-avatar">{{ name.slice(0, 1) }}</view>
          <view class="me-main">
            <text class="pm-hero__title">{{ name }}</text>
            <text class="me-sub">{{ level.text }} · 累计获得 {{ totalEarned }} 分</text>
          </view>
          <view class="pm-hero__chip">
            <view class="pm-hero__dot" />
            <text>会员</text>
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

        <view class="pm-card growth" @tap="go('/pages/member/points/index')">
          <view class="growth__top">
            <text class="growth__l">
              {{ level.next ? `距${level.next}还差 ${level.need} 分` : '已是最高等级' }}
            </text>
            <text class="growth__p">{{ level.pct }}%</text>
          </view>
          <view class="pm-bar growth__bar">
            <view class="pm-bar__fill" :style="{ width: level.pct + '%' }" />
          </view>
          <text class="growth__hint">等级按累计获得积分计算，消费和兑换都不减分</text>
        </view>

        <view class="pm-card stats-card">
          <view class="pm-stats">
            <view class="pm-stat" hover-class="press" @tap="go('/pages/member/points/index')">
              <view class="pm-stat__v">{{ balance }}</view>
              <view class="pm-stat__l">可用积分</view>
            </view>
            <view class="pm-stat" hover-class="press" @tap="goWallet">
              <view class="pm-stat__v">{{ unused }}</view>
              <view class="pm-stat__l">待用券</view>
            </view>
            <view class="pm-stat" hover-class="press" @tap="goHome">
              <view class="pm-stat__v">码</view>
              <view class="pm-stat__l">去亮码</view>
            </view>
          </view>
        </view>

        <view class="pm-section">
          <text class="pm-section__t">我的</text>
        </view>
        <view class="pm-card pm-card--flush">
          <view class="pm-row" hover-class="press" @tap="goHome">
            <view class="row-ico">码</view>
            <view class="pm-row__main">
              <view class="pm-row__t">我的会员码</view>
              <view class="pm-row__d">到店出示，店员扫码录积分</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
          <view class="pm-row" hover-class="press" @tap="go('/pages/member/points/index')">
            <view class="row-ico row-ico--blue">分</view>
            <view class="pm-row__main">
              <view class="pm-row__t">积分明细</view>
              <view class="pm-row__d">查看收支流水与即将过期积分</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
          <view class="pm-row" hover-class="press" @tap="goWallet">
            <view class="row-ico row-ico--warm">券</view>
            <view class="pm-row__main">
              <view class="pm-row__t">我的卡包</view>
              <view class="pm-row__d">{{ unused }} 张待用</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
          <view class="pm-row" hover-class="press" @tap="go('/pages/member/galaxy/index')">
            <view class="row-ico">店</view>
            <view class="pm-row__main">
              <view class="pm-row__t">逛商家</view>
              <view class="pm-row__d">按距离找附近的店，用攒的积分换券</view>
            </view>
            <text class="pm-row__x">›</text>
          </view>
          <view v-if="session.switchable" class="pm-row" hover-class="press" @tap="switchToMerchant">
            <view class="row-ico row-ico--warm">商</view>
            <view class="pm-row__main">
              <view class="pm-row__t">切换到商家端</view>
              <view class="pm-row__d">这个手机号也绑定了商家账号</view>
            </view>
            <text class="pm-row__x">{{ switching === 'switch' ? '切换中' : '›' }}</text>
          </view>
        </view>

        <block v-if="MERCHANT_TEST_ACCOUNTS.length">
          <view class="pm-section">
            <text class="pm-section__t">开发：直接进入商家</text>
          </view>
          <view class="pm-card pm-card--flush">
            <view
              v-for="item in MERCHANT_TEST_ACCOUNTS"
              :key="item.phone"
              class="pm-row"
              hover-class="press"
              @tap="enterMerchant(item.phone)"
            >
              <view class="pm-row__main">
                <view class="pm-row__t">{{ item.label }}</view>
                <view class="pm-row__d">{{ item.hint }} · {{ item.phone }}</view>
              </view>
              <text class="pm-row__x">{{ switching === item.phone ? '进入中' : '进入 ›' }}</text>
            </view>
          </view>
        </block>

        <view class="pm-btn pm-btn--ghost logout" hover-class="press" @tap="logout">退出登录</view>
        <view class="foot-hint">小Z 随身版 · 商盟会员服务</view>
      </template>
    </view>
  </view>
</template>

<style scoped>
.me-row { display: flex; align-items: center; gap: 22rpx; }
.me-avatar {
  width: 108rpx; height: 108rpx; border-radius: 999rpx; flex-shrink: 0;
  border: 2rpx solid rgba(255, 255, 255, 0.22);
  background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 40rpx; font-weight: 800;
}
.me-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.me-sub { margin-top: 8rpx; font-size: 22rpx; color: rgba(255, 255, 255, 0.5); }

.growth__top { display: flex; align-items: center; justify-content: space-between; }
.growth__l { font-size: 26rpx; font-weight: 700; color: #0e1f26; }
.growth__p { font-size: 22rpx; color: #00a08c; font-weight: 700; }
.growth__bar { margin-top: 16rpx; }
.growth__hint { display: block; margin-top: 14rpx; font-size: 20rpx; color: #8a9aa3; }

.stats-card { padding: 30rpx 16rpx; }
.row-ico {
  width: 72rpx; height: 72rpx; border-radius: 22rpx; flex-shrink: 0;
  background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; font-weight: 800;
}
.row-ico--blue { background: #eaf2ff; color: #1c6dd0; }
.row-ico--warm { background: #fff6e8; color: #a9670a; }

.logout { margin-top: 32rpx; color: #c0342f; }
.foot-hint { margin: 28rpx 0 8rpx; text-align: center; font-size: 20rpx; color: #b3c0c7; }
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
</style>
