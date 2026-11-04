<script setup lang="ts">
import { computed, getCurrentInstance, nextTick, ref, watch } from 'vue';
import { useSessionStore } from '@/stores/session';
import { fetchMemberAlliances, type AllianceGroup } from '@/services/galaxy';
import {
  fetchMe,
  fetchMemberQrTicket,
  fetchPointAccount,
  type AlliancePointAccount,
} from '@/services/member';
import { friendlyMessage } from '@/utils/errors';
import { useDeskStore } from '@/stores/desk';
import { useMallStore } from '@/stores/mall';
import { useWalletStore } from '@/stores/wallet';
import { enableShareMenu, rememberMember } from '@/utils/share';
import { boostBrightness, restoreBrightness } from '@/utils/brightness';
import { buildTicketPayload } from '@/utils/memberQr';
import { renderQrOnce } from '@/utils/qrImage';

const QR_SIZE = 220;
const QR_CANVAS_ID = 'qrHome';
/** 票据失效前 15 秒自动重签，避免店员扫到刚过期的码。 */
const QR_REFRESH_LEAD = 15;
/** 切回本面板 30 秒内的重复激活不重新拉全量数据。 */
const SILENT_WINDOW_MS = 30_000;
/** 新手引导只在用户真正「零资产」时出现，关掉后不再打扰。 */
const GUIDE_KEY = 'mini_guide_dismissed';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const pageInst = getCurrentInstance();
const loading = ref(true);
const errorText = ref('');
const nickname = ref('');
const balance = ref(0);
const pointAccounts = ref<AlliancePointAccount[]>([]);
const unusedCoupons = ref(0);
/** null = 已用券数据还没就绪（不能当成 0，否则会误判新用户） */
const usedCoupons = ref<number | null>(null);
const userId = ref(0);
const memberAvatar = ref('');
const qrSrc = ref('');
const qrCountdown = ref(0);
const alliances = ref<AllianceGroup[]>([]);
const allianceHint = ref('');
const totalEarned = ref(0);
const guideDismissed = ref(!!uni.getStorageSync(GUIDE_KEY));

/** 成长标签：用真实累计获得积分分级，不承诺任何权益，只做身份感。 */
const levelText = computed(() => {
  const earned = totalEarned.value;
  if (earned >= 2000) return '老友';
  if (earned >= 500) return '熟客';
  if (earned >= 1) return '常客';
  return '新会员';
});

/** 头像优先用会员资料里的微信头像，没有就退回昵称首字。 */
const avatarSrc = computed(() => memberAvatar.value || session.avatar || '');

/** 三个数字都为「确定的 0」才算新用户；任一未就绪就不弹引导，避免误伤老用户。 */
const isNewbie = computed(
  () =>
    !loading.value &&
    balance.value === 0 &&
    unusedCoupons.value === 0 &&
    usedCoupons.value === 0,
);

function dismissGuide() {
  guideDismissed.value = true;
  uni.setStorageSync(GUIDE_KEY, 1);
}

let qrTimer: ReturnType<typeof setInterval> | undefined;
let ticketExpiresAt = 0;
let lastLoadedAt = 0;

async function load(silent = false) {
  if (!silent) loading.value = true;
  errorText.value = '';
  try {
    const [me, account] = await Promise.all([
      fetchMe(),
      fetchPointAccount(),
    ]);
    rememberMember(me.id);
    nickname.value = me.nickname || session.profileName || '会员';
    memberAvatar.value = me.avatar || '';
    userId.value = me.id;
    pointAccounts.value = account.accounts?.length
      ? account.accounts
      : [
          {
            accountId: 0,
            allianceId: account.account.allianceId || 1,
            allianceName: account.account.allianceName || '积分',
            balance: account.account.balance,
            totalEarned: 0,
            totalSpent: 0,
            available: account.summary?.available ?? account.account.balance,
            mainPoints: account.account.mainPoints ?? account.summary?.mainPoints ?? 0,
            subPoints: account.account.subPoints ?? account.summary?.subPoints ?? 0,
          },
        ];
    balance.value =
      account.summary?.totalBalance ??
      pointAccounts.value.reduce((s, a) => s + a.balance, 0) ??
      account.summary?.available ??
      account.account.balance;
    totalEarned.value = pointAccounts.value.reduce((sum, item) => sum + (item.totalEarned || 0), 0);
    await Promise.all([
      useWalletStore().warm('UNUSED'),
      useWalletStore().warm('USED'),
    ]).catch(() => undefined);
    const unusedSnap = useWalletStore().snapshot('UNUSED');
    const usedSnap = useWalletStore().snapshot('USED');
    unusedCoupons.value = unusedSnap.total || 0;
    // ready=false 说明这一路没拉成功，宁可显示「—」也不能冒充 0
    usedCoupons.value = usedSnap.ready ? usedSnap.total : null;
    useMallStore().warm().catch(() => undefined);
    loadAlliancesPreview();
    lastLoadedAt = Date.now();
    loading.value = false;
    await nextTick();
    await loadQr();
  } catch (error) {
    errorText.value = friendlyMessage(error, '会员码没有加载出来');
    loading.value = false;
  } finally {
    uni.stopPullDownRefresh();
  }
}

async function loadAlliancesPreview() {
  try {
    const data = await fetchMemberAlliances();
    alliances.value = (data.alliances || []).slice(0, 3);
    const totalShops = (data.alliances || []).reduce((sum, a) => sum + a.merchantCount, 0);
    allianceHint.value = data.total
      ? `${data.total} 个联盟 · ${totalShops} 家店`
      : '暂无联盟';
  } catch {
    alliances.value = [];
    allianceHint.value = '点开查看联盟商家';
  }
}

async function loadQr() {
  const { ticket, expiresAt } = await fetchMemberQrTicket();
  ticketExpiresAt = new Date(expiresAt).getTime() || Date.now() + 5 * 60 * 1000;
  const src = await renderQrOnce(buildTicketPayload(ticket), {
    size: QR_SIZE,
    component: pageInst?.proxy,
    canvasId: QR_CANVAS_ID,
  });
  if (src) qrSrc.value = src;
  startCountdown();
}

function stopCountdown() {
  if (qrTimer) {
    clearInterval(qrTimer);
    qrTimer = undefined;
  }
}

function startCountdown() {
  stopCountdown();
  const tick = () => {
    const left = Math.max(0, Math.round((ticketExpiresAt - Date.now()) / 1000));
    qrCountdown.value = left;
    if (left <= QR_REFRESH_LEAD) {
      stopCountdown();
      // 静默重签：失败时保留旧码，下次激活或手动刷新再试
      loadQr().catch(() => undefined);
    }
  };
  tick();
  qrTimer = setInterval(tick, 1000);
}

function refreshQr() {
  loadQr().catch((error) => {
    errorText.value = friendlyMessage(error, '会员码刷新失败，请稍后重试');
  });
}

function goPoints() {
  uni.navigateTo({ url: '/pages/member/points/index' });
}

function showPointsHelp() {
  uni.showModal({
    title: '积分说明',
    content: '通用积分可在所有店换券，专属积分仅限在主体店换券。',
    showCancel: false,
    confirmText: '知道了',
  });
}

function goMall() {
  useMallStore().warm().catch(() => undefined);
  useDeskStore().member = 'mall';
}

function goAlliance() {
  uni.navigateTo({ url: '/pages/member/galaxy/index' });
}

function goQrPage() {
  uni.navigateTo({ url: '/pages/member/qrcode/index' });
}

/** 联盟卡片的一句门店概况：列前三家，超出的用「等」收口，避免长列表换行。 */
function allianceShops(item: AllianceGroup): string {
  const names = (item.merchants || [])
    .map((m) => m.name)
    .slice(0, 3)
    .join('、');
  if (!names) return `${item.merchantCount} 家门店`;
  return item.merchantCount > 3 ? `${names} 等` : names;
}

const desk = useDeskStore();
watch(() => desk.pull, () => { if (props.active) load(true); });

watch(
  () => props.active,
  (on) => {
    if (!on) {
      stopCountdown();
      restoreBrightness();
      return;
    }
    session.hydrate();
    enableShareMenu();
    boostBrightness();
    if (Date.now() - lastLoadedAt < SILENT_WINDOW_MS) {
      // 刚加载过：只补一次二维码，不重复拉全量
      if (!qrSrc.value) loadQr().catch(() => undefined);
      return;
    }
    load();
  },
  { immediate: true },
);
</script>

<template>
  <view class="pm-page">
    <view class="pm-hero">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="id-row">
          <image v-if="avatarSrc" class="id-avatar" :src="avatarSrc" mode="aspectFill" />
          <view v-else class="id-avatar">{{ nickname.slice(0, 1) }}</view>
          <view class="id-main">
            <text class="pm-hero__title">{{ nickname }}</text>
            <text class="id-sub">{{ levelText }}<text v-if="userId"> · 编号 {{ userId }}</text></text>
          </view>
          <view class="pm-hero__chip">
            <view class="pm-hero__dot" />
            <text>可亮码</text>
          </view>
        </view>
        <text class="pm-eyebrow id-hint">向店员出示此码，扫码即得积分</text>
      </view>
    </view>

    <view class="pm-body">
      <view v-if="loading" class="pm-card">
        <view class="pm-skel" style="height: 440rpx" />
      </view>
      <view v-else-if="errorText && !qrSrc" class="pm-card fail">
        <text class="fail__t">{{ errorText }}</text>
        <view class="pm-btn pm-btn--primary fail__b" hover-class="press" @tap="load()">重新加载</view>
      </view>
      <view v-else class="pm-card qr-card">
        <view class="qr-wrap">
          <image v-if="qrSrc" class="qr-img" :src="qrSrc" mode="aspectFit" />
          <view v-else class="qr-img qr-img--wait" />
          <view class="qr-logo">Z</view>
        </view>
        <view class="qr-tip">
          <text class="qr-ttl">{{ qrCountdown > 0 ? `${qrCountdown}s 后自动刷新` : '正在刷新' }}</text>
          <text class="qr-act" @tap="goQrPage">放大出示</text>
        </view>
      </view>

      <view class="pm-card stats-card">
        <view class="pm-stats">
          <view class="pm-stat">
            <view class="pm-stat__v">{{ balance }}</view>
            <view class="pm-stat__l">可用积分</view>
          </view>
          <view class="pm-stat">
            <view class="pm-stat__v">{{ unusedCoupons }}</view>
            <view class="pm-stat__l">待用券</view>
          </view>
          <view class="pm-stat">
            <view class="pm-stat__v">{{ usedCoupons ?? '—' }}</view>
            <view class="pm-stat__l">已用券</view>
          </view>
        </view>
      </view>

      <block v-if="pointAccounts.length > 1">
        <view class="pm-section">
          <text class="pm-section__t">积分账户</text>
          <text class="pm-section__more" @tap="showPointsHelp">通用与专属 ›</text>
        </view>
        <swiper
          class="pts-swiper"
          :indicator-dots="true"
          indicator-color="rgba(255,255,255,.25)"
          indicator-active-color="#00d6b2"
          circular
          previous-margin="0rpx"
          next-margin="64rpx"
        >
          <swiper-item v-for="item in pointAccounts" :key="item.allianceId">
            <view class="pts-card">
              <view class="pts-card__hd">
                <text class="pts-card__name">{{ item.allianceName }}</text>
                <view class="pts-card__help" @tap.stop="showPointsHelp">?</view>
              </view>
              <view class="pm-bignum pts-card__n">
                <text class="pm-bignum__v">{{ item.available ?? item.balance }}</text>
                <text class="pm-bignum__u">可用积分</text>
              </view>
              <text class="pts-card__split">
                通用 {{ item.mainPoints ?? item.main_points ?? 0 }} · 专属 {{ item.subPoints ?? item.sub_points ?? 0 }}
              </text>
            </view>
          </swiper-item>
        </swiper>
      </block>

      <view class="acts">
        <view class="pm-btn pm-btn--ghost" hover-class="press" @tap="goPoints">积分明细</view>
        <view class="pm-btn pm-btn--primary" hover-class="press" @tap="goMall">去兑换</view>
      </view>

      <view v-if="isNewbie && !guideDismissed" class="pm-card guide">
        <view class="guide__hd">
          <text class="guide__t">三步玩转商盟</text>
          <text class="guide__x" @tap="dismissGuide">关闭</text>
        </view>
        <view class="guide__step">
          <text class="guide__i">1</text>
          <view class="guide__body">
            <text class="guide__n">到联盟商家消费</text>
            <text class="guide__d">结账时出示上面这张会员码，店员扫一下就登记好了</text>
          </view>
        </view>
        <view class="guide__step">
          <text class="guide__i">2</text>
          <view class="guide__body">
            <text class="guide__n">自动攒积分</text>
            <text class="guide__d">消费金额直接折算积分，不用额外操作</text>
          </view>
        </view>
        <view class="guide__step">
          <text class="guide__i">3</text>
          <view class="guide__body">
            <text class="guide__n">积分换代金券</text>
            <text class="guide__d">在积分商城换券，下次到店直接抵钱</text>
          </view>
        </view>
        <view class="pm-btn pm-btn--dark guide__btn" hover-class="press" @tap="dismissGuide">知道了，开始用</view>
      </view>

      <view class="pm-section">
        <text class="pm-section__t">周围商家联盟</text>
        <text class="pm-section__more" @tap="goAlliance">查看全部 ›</text>
      </view>
      <view class="pm-card pm-card--flush" hover-class="press" @tap="goAlliance">
        <view v-if="alliances.length">
          <view v-for="item in alliances" :key="item.id" class="pm-row">
            <view class="alliance-ico">盟</view>
            <view class="pm-row__main">
              <text class="pm-row__t">{{ item.name }}</text>
              <text class="pm-row__d">{{ allianceShops(item) }}</text>
            </view>
            <text class="pm-row__x">{{ item.merchantCount }} 家 ›</text>
          </view>
        </view>
        <view v-else class="pm-empty">
          <view class="pm-empty__t">{{ allianceHint || '附近还没有联盟' }}</view>
          <view class="pm-empty__d">联盟商家可以互相积分消费，点开看看</view>
        </view>
      </view>

      <view class="foot-hint">积分与券数据来自各联盟实时同步</view>
    </view>

    <canvas canvas-id="qrHome" id="qrHome" class="qr-cache" />
  </view>
</template>

<style scoped>
/* ---------- 身份区 ---------- */
.id-row { display: flex; align-items: center; gap: 20rpx; }
.id-avatar {
  width: 88rpx; height: 88rpx; border-radius: 999rpx;
  border: 2rpx solid rgba(255, 255, 255, 0.22);
  background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 34rpx; font-weight: 800; flex-shrink: 0;
}
.id-main { flex: 1; min-width: 0; display: flex; flex-direction: column; }
.id-sub { margin-top: 8rpx; font-size: 22rpx; color: rgba(255, 255, 255, 0.5); }
.id-hint { display: block; margin-top: 30rpx; }

/* ---------- 亮码卡 ---------- */
.qr-card { text-align: center; padding: 26rpx 28rpx 24rpx; }
.qr-wrap {
  position: relative; display: inline-block;
  padding: 20rpx; border-radius: 36rpx; background: #f5f8f9;
}
.qr-img { width: 220px; height: 220px; background: #fff; border-radius: 16rpx; display: block; }
.qr-img--wait { background: #e2eaee; }
.qr-logo {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 64rpx; height: 64rpx; border-radius: 18rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff;
  font-size: 30rpx; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10rpx 24rpx rgba(0, 184, 160, 0.35);
}
.qr-tip {
  margin-top: 22rpx; display: flex; align-items: center; justify-content: space-between;
  padding: 0 8rpx;
}
.qr-ttl { font-size: 22rpx; color: #8a9aa3; }
.qr-act { font-size: 22rpx; color: #00a08c; font-weight: 700; padding: 4rpx 8rpx; }

/* ---------- 三段指标 ---------- */
.stats-card { padding: 30rpx 16rpx; }

/* ---------- 积分账户 ---------- */
.pts-swiper { width: 100%; height: 268rpx; }
.pts-card {
  height: 236rpx; box-sizing: border-box; margin-right: 16rpx;
  padding: 26rpx 28rpx; border-radius: 32rpx;
  background: linear-gradient(135deg, #09303a 0%, #103a5a 60%, #123f66 100%);
  color: #fff; display: flex; flex-direction: column; justify-content: center;
}
.pts-card__hd { display: flex; align-items: center; justify-content: space-between; }
.pts-card__name { font-size: 22rpx; color: rgba(255, 255, 255, 0.6); }
.pts-card__help {
  width: 34rpx; height: 34rpx; border-radius: 999rpx; flex-shrink: 0;
  border: 1rpx solid rgba(255, 255, 255, 0.4); color: #fff;
  font-size: 20rpx; line-height: 32rpx; text-align: center;
}
.pts-card__n { margin-top: 10rpx; }
.pts-card__split { margin-top: 8rpx; font-size: 22rpx; color: rgba(255, 255, 255, 0.55); }

/* ---------- 操作 ---------- */
.acts { display: flex; gap: 20rpx; margin-top: 24rpx; }
.acts .pm-btn { flex: 1; }

/* ---------- 新用户引导 ---------- */
.guide__hd { display: flex; align-items: center; justify-content: space-between; }
.guide__t { font-size: 30rpx; font-weight: 800; color: #0e1f26; }
.guide__x { font-size: 22rpx; color: #8a9aa3; padding: 4rpx 8rpx; }
.guide__step { display: flex; align-items: flex-start; gap: 18rpx; margin-top: 22rpx; }
.guide__i {
  width: 44rpx; height: 44rpx; border-radius: 999rpx; flex-shrink: 0;
  background: #e8fbf7; color: #00766a; font-size: 22rpx; font-weight: 800;
  display: flex; align-items: center; justify-content: center;
}
.guide__body { flex: 1; min-width: 0; }
.guide__n { display: block; font-size: 26rpx; font-weight: 700; color: #0e1f26; }
.guide__d { display: block; margin-top: 6rpx; font-size: 22rpx; color: #8a9aa3; line-height: 1.5; }
.guide__btn { margin-top: 28rpx; height: 82rpx; font-size: 26rpx; }

/* ---------- 联盟 ---------- */
.alliance-ico {
  width: 72rpx; height: 72rpx; border-radius: 22rpx; flex-shrink: 0;
  background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center;
  font-size: 24rpx; font-weight: 800;
}

/* ---------- 失败 ---------- */
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
.fail__b { margin-top: 26rpx; }

.foot-hint { margin: 36rpx 0 8rpx; text-align: center; font-size: 20rpx; color: #b3c0c7; }

/* 二维码离屏画布，不能 display:none，否则画不出来 */
.qr-cache { position: fixed; left: -9999px; top: 0; width: 220px; height: 220px; }
</style>
