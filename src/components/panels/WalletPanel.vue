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

/** 有缓存或已有列表时绝不闪骨架。 */
const showSkeleton = computed(() => loading.value && !list.value.length && !wallet.snapshot(status.value).ready);

function hydrate() {
  const snap = wallet.snapshot(status.value);
  list.value = snap.rows;
  total.value = snap.total;
  page.value = snap.page;
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
    // 有缓存时保持 loading=false，静默刷新不挡界面
    loading.value = !had && list.value.length === 0;
  } else {
    if (list.value.length >= 50) return;
    loadingMore.value = true;
  }
  try {
    if (reset) {
      await wallet.warm(status.value, force);
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
    <view class="tabs">
      <view
        v-for="tab in tabs"
        :key="tab.key"
        class="tab pressable"
        :class="{ 'is-on': status === tab.key }"
        hover-class="press"
        hover-start-time="20"
        @tap="switchTab(tab.key)"
      >{{ tab.text }}</view>
    </view>
    <view class="list">
      <skeleton v-if="showSkeleton" type="wallet" :count="4" />
      <view v-else-if="errorText && !list.length" class="fail">{{ errorText }}</view>
      <empty-state v-else-if="!list.length" title="这个分类里还没有券" hint="兑换或到店领取后，会出现在这里" />
      <template v-else>
        <view
          v-for="(item, index) in list"
          :key="item.id"
          class="card tap-card list-rise"
          :style="{ animationDelay: Math.min(index, 8) * 50 + 'ms' }"
          hover-class="press"
          hover-start-time="20"
          @tap="open(item)"
        >
          <view class="card__face">¥{{ item.face }}</view>
          <view class="card__main">
            <text class="card__name">{{ item.name }}</text>
            <text class="card__date">有效期至 {{ item.expire }}</text>
          </view>
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
.page { min-height: 100vh; padding: 12rpx 32rpx 220rpx; box-sizing: border-box; }
.tabs { display: flex; gap: 16rpx; }
.tab { flex: 1; text-align: center; padding: 16rpx 0; color: #64748b; border-radius: 999rpx; background: rgba(255,255,255,.7); border: 1px solid rgba(255,255,255,.9); }
.tab.is-on { color: #fff; font-weight: 700; background: #0b1220; border-color: #0b1220; }
.list { margin-top: 24rpx; }
.qr-cache { position: fixed; left: -400px; top: 0; width: 220px; height: 220px; pointer-events: none; }
.card {
  display: flex;
  align-items: center;
  gap: 20rpx;
  background: #fff;
  border-radius: 32rpx;
  padding: 28rpx;
  margin-bottom: 20rpx;
  box-shadow: 0 12rpx 30rpx rgba(15, 23, 42, 0.05);
}
.card__face {
  width: 120rpx;
  height: 120rpx;
  border-radius: 36rpx;
  background: linear-gradient(160deg, #38bdf8, #14b8a6);
  color: #fff;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 32rpx;
  font-weight: 800;
}
.card__main { flex: 1; min-width: 0; }
.card__name { display: block; font-weight: 700; font-size: 30rpx; }
.card__date { display: block; margin-top: 8rpx; color: #94a3b8; font-size: 24rpx; }
.more { display: block; text-align: center; color: #64748b; padding: 24rpx 0; }
.fail { color: #b91c1c; font-weight: 700; padding: 24rpx 0; }
</style>
