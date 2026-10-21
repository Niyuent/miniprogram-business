<script setup lang="ts">
import { getCurrentInstance, nextTick, ref, watch } from 'vue';
import UQRCode from 'uqrcodejs';
import { useSessionStore } from '@/stores/session';
import { fetchMemberAlliances, type AllianceGroup } from '@/services/galaxy';
import { fetchMe, fetchPointAccount } from '@/services/member';
import { friendlyMessage } from '@/utils/errors';
import { useDeskStore } from '@/stores/desk';
import { useMallStore } from '@/stores/mall';
import { useWalletStore } from '@/stores/wallet';
import { enableShareMenu, rememberMember } from '@/utils/share';

const QR_SIZE = 220;
const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const pageInst = getCurrentInstance();
const loading = ref(true);
const errorText = ref('');
const nickname = ref('');
const balance = ref(0);
const unusedCoupons = ref(0);
const userId = ref(0);
const payload = ref('');
const drawn = ref(false);
const alliances = ref<AllianceGroup[]>([]);
const allianceHint = ref('');
let savedBrightness: number | null = null;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function boostBrightness() {
  try {
    const cur = await new Promise<{ value: number }>((resolve, reject) => {
      uni.getScreenBrightness({ success: resolve as (res: { value: number }) => void, fail: reject });
    });
    if (typeof cur.value === 'number') savedBrightness = cur.value;
  } catch {
    savedBrightness = null;
  }
  try {
    uni.setScreenBrightness({ value: 1 });
  } catch {
    /* H5 / 无权限时忽略 */
  }
}

function restoreBrightness() {
  if (savedBrightness == null) return;
  try {
    uni.setScreenBrightness({ value: savedBrightness });
  } catch {
    /* ignore */
  }
  savedBrightness = null;
}

function drawQr(code: string): Promise<void> {
  return new Promise((resolve, reject) => {
    try {
      const host = pageInst?.proxy ?? pageInst;
      const qr = new UQRCode();
      qr.data = code;
      qr.size = QR_SIZE;
      qr.make();
      const ctx = uni.createCanvasContext('homeMemberQr', host as never);
      qr.canvasContext = ctx as never;
      const done = () => {
        drawn.value = true;
        resolve();
      };
      const drawnResult = qr.drawCanvas() as Promise<void> | void;
      if (drawnResult && typeof (drawnResult as Promise<void>).then === 'function') {
        (drawnResult as Promise<void>).then(done).catch(reject);
      } else {
        setTimeout(done, 80);
      }
    } catch (e) {
      reject(e);
    }
  });
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  errorText.value = '';
  drawn.value = false;
  try {
    const [me, account] = await Promise.all([
      fetchMe(),
      fetchPointAccount(),
    ]);
    rememberMember(me.id);
    nickname.value = me.nickname || session.profileName || '会员';
    userId.value = me.id;
    payload.value = `SM_MEMBER:${me.id}`;
    balance.value = account.summary?.available ?? account.account.balance;
    await useWalletStore().warm('UNUSED').catch(() => undefined);
    unusedCoupons.value = useWalletStore().snapshot('UNUSED').total || 0;
    useMallStore().warm().catch(() => undefined);
    loadAlliancesPreview();
    loading.value = false;
    await nextTick();
    await sleep(80);
    await drawQr(payload.value);
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

function goPoints() {
  uni.navigateTo({ url: '/pages/member/points/index' });
}

function goMall() {
  useMallStore().warm().catch(() => undefined);
  useDeskStore().member = 'mall';
}

function goAlliance() {
  uni.navigateTo({ url: '/pages/member/galaxy/index' });
}

function refreshQr() {
  if (!payload.value) {
    load();
    return;
  }
  drawn.value = false;
  drawQr(payload.value).catch(() => load());
}

const desk = useDeskStore();
watch(() => desk.pull, () => { if (props.active) load(true); });

watch(
  () => props.active,
  (on) => {
    if (!on) {
      restoreBrightness();
      return;
    }
    session.hydrate();
    enableShareMenu();
    boostBrightness();
    load();
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <view class="hero">
      <view class="hero__row">
        <text class="hero__title">我的会员码</text>
        <view class="hero__help" @tap="goPoints">权益</view>
      </view>
    </view>

    <view v-if="loading" class="skel" />
    <view v-else-if="errorText" class="fail">
      <text>{{ errorText }}</text>
      <button class="retry" hover-class="press" @tap="load()">重试</button>
    </view>
    <view v-else class="mem">
      <view class="user-row">
        <view class="avatar">{{ nickname.slice(0, 1) }}</view>
        <text class="nm">{{ nickname }}</text>
        <view class="lv">会员</view>
      </view>
      <view class="qr-wrap">
        <canvas
          canvas-id="homeMemberQr"
          id="homeMemberQr"
          class="qr-canvas"
          :style="{ width: QR_SIZE + 'px', height: QR_SIZE + 'px' }"
        />
        <view class="logo">Z</view>
      </view>
      <view class="qr-tip">
        向店员出示，扫码即得积分
        <text class="refresh" @tap="refreshQr">刷新</text>
      </view>
      <text class="code-num">编号 {{ userId }}</text>
      <view class="pts-row">
        <view class="p">
          <view class="v">{{ balance }}</view>
          <view class="l">可用积分</view>
        </view>
        <view class="div" />
        <view class="p">
          <view class="v">{{ unusedCoupons }}</view>
          <view class="l">待用券</view>
        </view>
        <view class="div" />
        <view class="p">
          <view class="v">—</view>
          <view class="l">已省</view>
        </view>
      </view>
      <view class="acts">
        <button class="btn-ghost" hover-class="press" @tap="goPoints">积分明细</button>
        <button class="btn-primary" hover-class="press" @tap="goMall">去兑换</button>
      </view>
    </view>

    <view class="card alliance" hover-class="press" @tap="goAlliance">
      <view class="card__head row">
        <text>周围商家联盟</text>
        <text class="more">{{ allianceHint || '查看' }} ›</text>
      </view>
      <view v-if="alliances.length" class="alliance-list">
        <view v-for="item in alliances" :key="item.id" class="alliance-row">
          <view class="alliance-ico">盟</view>
          <view class="alliance-main">
            <text class="alliance-name">{{ item.name }}</text>
            <text class="alliance-shops">
              {{ item.merchants.map((m) => m.name).slice(0, 4).join('、') }}
              <text v-if="item.merchantCount > 4"> 等 {{ item.merchantCount }} 家</text>
              <text v-else> · {{ item.merchantCount }} 家</text>
            </text>
          </view>
        </view>
      </view>
      <view v-else class="alliance-empty">看看附近联盟里有哪些店可以积分消费</view>
    </view>

    <view class="card">
      <view class="card__head">会员权益</view>
      <view class="perks">
        <view class="perk"><text class="ico">车</text><text>免配送</text></view>
        <view class="perk"><text class="ico">礼</text><text>生日礼</text></view>
        <view class="perk"><text class="ico">价</text><text>专属价</text></view>
        <view class="perk"><text class="ico">券</text><text>月月券</text></view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding-bottom: 220rpx; box-sizing: border-box; background: #f3f7f8; }
.hero {
  padding: 24rpx 32rpx 80rpx;
  background: linear-gradient(135deg, #00c9a7 0%, #2e90ff 100%);
  border-radius: 0 0 48rpx 48rpx;
}
.hero__row { display: flex; align-items: center; justify-content: space-between; }
.hero__title { color: #fff; font-size: 34rpx; font-weight: 800; }
.hero__help {
  padding: 10rpx 22rpx; border-radius: 999rpx;
  background: rgba(255,255,255,.18); color: #fff; font-size: 24rpx; border: 1px solid rgba(255,255,255,.3);
}
.mem {
  margin: -48rpx 32rpx 24rpx; background: #fff; border-radius: 48rpx; padding: 32rpx 28rpx 36rpx;
  box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.08); display: flex; flex-direction: column; align-items: center;
}
.user-row { width: 100%; display: flex; align-items: center; gap: 16rpx; margin-bottom: 24rpx; }
.avatar {
  width: 72rpx; height: 72rpx; border-radius: 24rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 30rpx;
}
.nm { flex: 1; font-size: 30rpx; font-weight: 800; color: #0e1f26; }
.lv {
  padding: 6rpx 16rpx; border-radius: 999rpx; background: #fff5e5; color: #b26b00;
  font-size: 22rpx; font-weight: 700;
}
.qr-wrap { position: relative; padding: 16rpx; background: #f3f7f8; border-radius: 28rpx; }
.qr-canvas { width: 220px; height: 220px; background: #fff; border-radius: 12rpx; }
.logo {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
  width: 56rpx; height: 56rpx; border-radius: 16rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff;
  font-weight: 800; font-size: 28rpx;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8rpx 20rpx rgba(0,184,160,.35);
}
.qr-tip { margin-top: 20rpx; color: #6d818b; font-size: 24rpx; display: flex; gap: 12rpx; align-items: center; }
.refresh { color: #009784; font-weight: 700; }
.code-num { margin-top: 8rpx; color: #b3c0c7; font-size: 22rpx; letter-spacing: 2rpx; }
.pts-row {
  width: 100%; margin-top: 28rpx; display: flex; align-items: center;
  padding: 20rpx 0; border-top: 1px solid #eaf0f2;
}
.p { flex: 1; text-align: center; }
.v { font-size: 36rpx; font-weight: 800; color: #0e1f26; font-variant-numeric: tabular-nums; }
.l { margin-top: 6rpx; color: #8a9aa3; font-size: 22rpx; }
.div { width: 1px; height: 48rpx; background: #eaf0f2; }
.acts { width: 100%; display: flex; gap: 16rpx; margin-top: 24rpx; }
.btn-ghost, .btn-primary {
  flex: 1; height: 84rpx; line-height: 84rpx; border-radius: 999rpx; font-size: 28rpx; font-weight: 700; margin: 0;
}
.btn-ghost { background: #f1f5f7; color: #33454f; }
.btn-primary {
  background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff;
  box-shadow: 0 16rpx 40rpx rgba(0,184,160,.28);
}
.card {
  margin: 0 32rpx 20rpx; background: #fff; border-radius: 48rpx; padding: 28rpx;
  box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.08);
}
.card__head { font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.card__head.row { display: flex; align-items: center; justify-content: space-between; }
.more { font-size: 22rpx; color: #009784; font-weight: 700; }
.alliance-list { margin-top: 16rpx; }
.alliance-row {
  display: flex; align-items: center; gap: 16rpx;
  padding: 16rpx 0; border-top: 1px solid #eaf0f2;
}
.alliance-row:first-child { border-top: none; }
.alliance-ico {
  width: 64rpx; height: 64rpx; border-radius: 20rpx; background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 24rpx; flex-shrink: 0;
}
.alliance-main { flex: 1; min-width: 0; }
.alliance-name { display: block; font-size: 28rpx; font-weight: 700; color: #0e1f26; }
.alliance-shops {
  display: block; margin-top: 6rpx; font-size: 22rpx; color: #8a9aa3;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.alliance-empty { margin-top: 16rpx; color: #8a9aa3; font-size: 24rpx; line-height: 1.5; }
.perks { display: flex; margin-top: 24rpx; }
.perk { flex: 1; text-align: center; color: #6d818b; font-size: 22rpx; display: flex; flex-direction: column; gap: 8rpx; align-items: center; }
.ico {
  width: 64rpx; height: 64rpx; border-radius: 20rpx; background: #e8fbf7; color: #00766a;
  display: flex; align-items: center; justify-content: center; font-size: 24rpx; font-weight: 800;
}
.skel { margin: -48rpx 32rpx 24rpx; height: 720rpx; border-radius: 48rpx; background: #e2eaee; }
.fail {
  margin: -48rpx 32rpx 24rpx; padding: 48rpx; background: #fff; border-radius: 48rpx;
  color: #c22a2e; font-weight: 700; display: flex; flex-direction: column; gap: 24rpx;
}
.retry { background: #00b8a0; color: #fff; border-radius: 999rpx; }
</style>
