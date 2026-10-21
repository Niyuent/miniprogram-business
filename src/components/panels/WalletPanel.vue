<script setup lang="ts">
import { computed, getCurrentInstance, ref, watch } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import Skeleton from '@/components/Skeleton.vue';
import QrMask from '@/components/QrMask.vue';
import { useDeskStore } from '@/stores/desk';
import { useSessionStore } from '@/stores/session';
import { fetchMe } from '@/services/member';
import { useWalletStore, type WalletRow, type WalletTab } from '@/stores/wallet';
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
  <view class="page">
    <view class="nav">
      <text class="nav__title">我的卡包</text>
    </view>
    <view class="tabs">
      <view
        v-for="tab in tabs"
        :key="tab.key"
        class="tab pressable"
        :class="{ 'is-on': status === tab.key }"
        hover-class="press"
        @tap="switchTab(tab.key)"
      >{{ tab.text }} {{ counts[tab.key] || 0 }}</view>
    </view>
    <view class="list">
      <skeleton v-if="showSkeleton" type="wallet" :count="4" />
      <view v-else-if="errorText && !list.length" class="fail">{{ errorText }}</view>
      <empty-state v-else-if="!list.length" title="这里还没有券" hint="去积分商城看看，或到店消费领券" />
      <template v-else>
        <view
          v-for="(item, index) in list"
          :key="item.id"
          class="card tap-card list-rise"
          :style="{ animationDelay: Math.min(index, 8) * 50 + 'ms' }"
          hover-class="press"
          @tap="open(item)"
        >
          <view class="card__face">¥{{ item.face }}</view>
          <view class="card__main">
            <text class="card__name">{{ item.name }}</text>
            <text class="card__date">有效期至 {{ item.expire }}</text>
          </view>
          <text v-if="status === 'UNUSED'" class="card__act">亮码</text>
        </view>
        <text v-if="loadingMore" class="more">正在加载…</text>
        <text v-else-if="list.length >= total || list.length >= 50" class="more">没有更多了</text>
      </template>
    </view>
    <canvas canvas-id="qrCache" id="qrCache" class="qr-cache" />
    <qr-mask :visible="qrOpen" :code="qrCode" :image="qrImages[qrCode] || ''" @close="shutQr" />
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding: 12rpx 32rpx 220rpx; box-sizing: border-box; background: #f3f7f8; }
.nav { padding: 8rpx 0 20rpx; }
.nav__title { font-size: 44rpx; font-weight: 800; letter-spacing: -1rpx; color: #0e1f26; }
.tabs { display: flex; gap: 12rpx; }
.tab {
  flex: 1; text-align: center; padding: 18rpx 0; color: #8a9aa3; border-radius: 999rpx;
  background: #fff; border: 1px solid #eaf0f2; font-size: 24rpx;
}
.tab.is-on {
  color: #fff; font-weight: 700;
  background: linear-gradient(135deg, #00d6b2, #19a7f8); border-color: transparent;
}
.list { margin-top: 24rpx; }
.qr-cache { position: fixed; left: -400px; top: 0; width: 220px; height: 220px; pointer-events: none; }
.card {
  display: flex; align-items: center; gap: 20rpx;
  background: #fff; border-radius: 40rpx; padding: 28rpx;
  margin-bottom: 20rpx; box-shadow: 0 16rpx 48rpx rgba(10, 60, 58, 0.06);
}
.card__face {
  width: 120rpx; height: 120rpx; border-radius: 36rpx;
  background: linear-gradient(160deg, #00d6b2, #19a7f8); color: #fff;
  display: flex; align-items: center; justify-content: center;
  font-size: 32rpx; font-weight: 800;
}
.card__main { flex: 1; min-width: 0; }
.card__name { display: block; font-weight: 700; font-size: 30rpx; color: #0e1f26; }
.card__date { display: block; margin-top: 8rpx; color: #8a9aa3; font-size: 24rpx; }
.card__act { color: #009784; font-weight: 700; font-size: 24rpx; }
.more { display: block; text-align: center; color: #8a9aa3; padding: 24rpx 0; }
.fail { color: #c22a2e; font-weight: 700; padding: 24rpx 0; }
</style>
