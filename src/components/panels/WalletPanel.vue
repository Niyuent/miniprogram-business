<script setup lang="ts">
import { computed, getCurrentInstance, ref, watch } from 'vue';
import QrMask from '@/components/QrMask.vue';
import { useDeskStore } from '@/stores/desk';
import { useSessionStore } from '@/stores/session';
import { fetchMe } from '@/services/member';
import { useWalletStore, daysUntil, type WalletRow, type WalletTab } from '@/stores/wallet';
import { cachedQr, clearQrCanvas, disposeQrCache, prefetchQr } from '@/utils/qrImage';
import { friendlyMessage } from '@/utils/errors';
import { enableShareMenu, rememberMember } from '@/utils/share';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const wallet = useWalletStore();
const desk = useDeskStore();
const inst = getCurrentInstance();

const tabs = [
  { key: 'UNUSED', text: '未使用' },
  { key: 'USED', text: '已使用' },
  { key: 'EXPIRED', text: '已过期' },
] as const;

const status = ref<WalletTab>('UNUSED');
const list = ref<WalletRow[]>([]);
const total = ref(0);
const page = ref(1);
const loading = ref(false);
const loadingMore = ref(false);
const errorText = ref('');
const qrImages = ref<Record<string, string>>({});
const qrCode = ref('');
const qrOpen = ref(false);
const counts = ref({ UNUSED: 0, USED: 0, EXPIRED: 0 });

const showSkeleton = computed(() => loading.value && !list.value.length && !wallet.snapshot(status.value).ready);

/** 7 天内到期（含今天）的未使用券；只统计已加载行，用作提醒足够了。 */
const expiringRows = computed(() =>
  status.value === 'UNUSED'
    ? list.value.filter((row) => {
        const days = daysUntil(row.expireAt);
        return days !== null && days <= 7;
      })
    : [],
);

function isUrgent(row: WalletRow) {
  if (status.value !== 'UNUSED') return false;
  const days = daysUntil(row.expireAt);
  return days !== null && days <= 7;
}

function urgentText(row: WalletRow) {
  if (!isUrgent(row)) return '';
  const days = daysUntil(row.expireAt);
  if (days === null) return '';
  return days <= 0 ? ' · 今天到期' : ` · ${days} 天后到期`;
}

function hydrate() {
  const snap = wallet.snapshot(status.value);
  list.value = snap.rows;
  total.value = snap.total;
  page.value = snap.page;
  counts.value = {
    UNUSED: wallet.snapshot('UNUSED').total,
    USED: wallet.snapshot('USED').total,
    EXPIRED: wallet.snapshot('EXPIRED').total,
  };
  if (snap.ready) warmQr(list.value);
  return snap.ready;
}

function warmQr(rows: WalletRow[]) {
  const codes = rows.map((row) => row.code).filter(Boolean);
  codes.forEach((code) => {
    const hit = cachedQr(code);
    if (hit) qrImages.value[code] = hit;
  });
  prefetchQr(codes, inst?.proxy, (code, path) => {
    qrImages.value[code] = path;
  });
}

async function load(reset: boolean, force = false) {
  errorText.value = '';
  if (reset) {
    const had = hydrate();
    loading.value = !had && list.value.length === 0;
  } else {
    if (list.value.length >= 50) return;
    loadingMore.value = true;
  }
  try {
    if (reset) {
      await Promise.all([
        wallet.warm(status.value, force),
        wallet.warm('UNUSED').catch(() => undefined),
        wallet.warm('USED').catch(() => undefined),
        wallet.warm('EXPIRED').catch(() => undefined),
      ]);
      if (!props.active) return;
      hydrate();
    } else {
      const next = page.value + 1;
      await wallet.loadPage(status.value, next, { append: true });
      if (!props.active) return;
      const snap = wallet.snapshot(status.value);
      list.value = snap.rows;
      total.value = snap.total;
      page.value = snap.page;
      warmQr(snap.rows.slice(-10));
    }
  } catch (error) {
    if (!list.value.length) errorText.value = friendlyMessage(error, '卡包没有加载出来');
  } finally {
    loading.value = false;
    loadingMore.value = false;
    uni.stopPullDownRefresh();
  }
}

function switchTab(next: WalletTab) {
  if (next === status.value) return;
  status.value = next;
  qrOpen.value = false;
  clearQrCanvas();
  hydrate();
  load(true);
}

function more() {
  if (loading.value || loadingMore.value || list.value.length >= total.value) return;
  load(false);
}

function open(item: WalletRow) {
  if (status.value !== 'UNUSED' || !item.code) return;
  qrCode.value = item.code;
  const ready = qrImages.value[item.code] || cachedQr(item.code);
  if (ready) qrImages.value[item.code] = ready;
  qrOpen.value = true;
}

function shutQr() {
  qrOpen.value = false;
  clearQrCanvas();
}

watch(() => desk.pull, () => { if (props.active) load(true, true); });
watch(() => desk.reach, () => { if (props.active) more(); });

watch(
  () => props.active,
  (on) => {
    if (!on) {
      qrOpen.value = false;
      clearQrCanvas();
      return;
    }
    session.hydrate();
    enableShareMenu();
    fetchMe().then((me) => rememberMember(me.id)).catch(() => undefined);
    hydrate();
    load(true);
  },
  { immediate: true },
);

defineExpose({ dispose: () => { clearQrCanvas(); disposeQrCache(); } });
</script>

<template>
  <view class="pm-page">
    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="hero-top">
          <text class="pm-hero__title">卡包</text>
          <view class="pm-hero__chip">
            <view class="pm-hero__dot" />
            <text>实时同步</text>
          </view>
        </view>
        <view class="pm-bignum hero-num">
          <text class="pm-bignum__v">{{ counts.UNUSED || 0 }}</text>
          <text class="pm-bignum__u">张待用券</text>
        </view>
        <text class="pm-hero__cap hero-cap">已用 {{ counts.USED || 0 }} · 已过期 {{ counts.EXPIRED || 0 }}</text>
      </view>
    </view>

    <view class="pm-body">
      <view v-if="expiringRows.length" class="alert">
        <text class="alert__t">{{ expiringRows.length }} 张券 7 天内到期</text>
        <text class="alert__d">建议优先使用，过期不补</text>
      </view>

      <view class="pm-seg">
        <view
          v-for="tab in tabs"
          :key="tab.key"
          class="pm-seg__i"
          :class="{ 'is-on': status === tab.key }"
          hover-class="press"
          @tap="switchTab(tab.key)"
        >{{ tab.text }} {{ counts[tab.key] || 0 }}</view>
      </view>

      <view class="list">
        <view v-if="showSkeleton">
          <view v-for="i in 3" :key="i" class="pm-skel skel-row" />
        </view>
        <view v-else-if="errorText && !list.length" class="pm-card fail">
          <text class="fail__t">{{ errorText }}</text>
        </view>
        <view v-else-if="!list.length" class="pm-card pm-empty">
          <view class="pm-empty__t">这里还没有券</view>
          <view class="pm-empty__d">去积分商城看看，或到店消费领券</view>
        </view>
        <template v-else>
          <view
            v-for="(item, index) in list"
            :key="item.id"
            class="cpn tap-card list-rise"
            :class="{ 'cpn--off': status !== 'UNUSED' }"
            :style="{ animationDelay: Math.min(index, 8) * 50 + 'ms' }"
            hover-class="press"
            @tap="open(item)"
          >
            <view class="cpn__face" :class="index % 2 ? 'cpn__face--blue' : ''">
              <text class="cpn__cur">¥</text>
              <text class="cpn__val">{{ item.face }}</text>
            </view>
            <view class="cpn__main">
              <text class="cpn__name">{{ item.name }}</text>
              <text v-if="item.allianceName" class="cpn__alliance">{{ item.allianceName }}</text>
              <text class="cpn__date" :class="{ 'cpn__date--urgent': isUrgent(item) }">
                至 {{ item.expire }}{{ urgentText(item) }}
              </text>
            </view>
            <view v-if="status === 'UNUSED'" class="cpn__act">亮码</view>
            <text v-else class="pm-pill pm-pill--muted">{{ status === 'USED' ? '已用' : '已过期' }}</text>
          </view>
          <text v-if="loadingMore" class="more">正在加载…</text>
          <text v-else-if="list.length >= total || list.length >= 50" class="more">没有更多了</text>
        </template>
      </view>
    </view>

    <canvas canvas-id="qrCache" id="qrCache" class="qr-cache" />
    <qr-mask :visible="qrOpen" :code="qrCode" :image="qrImages[qrCode] || ''" @close="shutQr" />
  </view>
</template>

<style scoped>
.hero-top { display: flex; align-items: center; justify-content: space-between; }
.hero-num { margin-top: 18rpx; }
.hero-cap { display: block; margin-top: 10rpx; }

.alert {
  display: flex; align-items: center; gap: 14rpx;
  padding: 18rpx 24rpx; margin-bottom: 18rpx;
  border-radius: 24rpx; background: #fff6e8; border: 1rpx solid #ffe1b8;
}
.alert__t { font-size: 24rpx; font-weight: 700; color: #a9670a; }
.alert__d { margin-left: auto; font-size: 20rpx; color: #c98b2c; }

.list { margin-top: 20rpx; }
.skel-row { height: 168rpx; margin-bottom: 18rpx; }

.cpn {
  display: flex; align-items: center; gap: 22rpx;
  background: #fff; border: 1rpx solid #eaf0f2; border-radius: 32rpx;
  padding: 24rpx; margin-bottom: 18rpx;
  box-shadow: 0 8rpx 28rpx rgba(10, 60, 58, 0.05);
}
.cpn--off { opacity: 0.66; }
.cpn__face {
  width: 112rpx; height: 112rpx; border-radius: 26rpx; flex-shrink: 0;
  background: linear-gradient(150deg, #e8fbf7, #c7f5eb);
  color: #00766a; display: flex; flex-direction: column;
  align-items: center; justify-content: center;
}
.cpn__face--blue {
  background: linear-gradient(150deg, #eaf2ff, #d6e6ff);
  color: #1c6dd0;
}
.cpn--off .cpn__face {
  background: #f0f3f4; color: #8a9aa3;
}
.cpn__cur { font-size: 20rpx; line-height: 1; }
.cpn__val { font-size: 40rpx; font-weight: 800; line-height: 1.15; }
.cpn__main { flex: 1; min-width: 0; }
.cpn__name { display: block; font-size: 30rpx; font-weight: 700; color: #0e1f26; }
.cpn__alliance { display: block; margin-top: 6rpx; font-size: 22rpx; color: #00a08c; font-weight: 600; }
.cpn__date { display: block; margin-top: 6rpx; font-size: 22rpx; color: #8a9aa3; }
.cpn__date--urgent { color: #c0342f; font-weight: 700; }
.cpn__act {
  flex-shrink: 0; padding: 10rpx 22rpx; border-radius: 999rpx;
  background: #07262f; color: #fff; font-size: 22rpx; font-weight: 700;
}
.more { display: block; text-align: center; color: #8a9aa3; font-size: 22rpx; padding: 24rpx 0; }
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
.qr-cache { position: fixed; left: -400px; top: 0; width: 220px; height: 220px; pointer-events: none; }
</style>
