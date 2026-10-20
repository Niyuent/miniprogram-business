<script setup lang="ts">
import { computed, getCurrentInstance, ref, watch } from 'vue';
import EmptyState from '@/components/EmptyState.vue';
import ListSkeleton from '@/components/ListSkeleton.vue';
import QrMask from '@/components/QrMask.vue';
import { useDeskStore } from '@/stores/desk';
import { useSessionStore } from '@/stores/session';
import { fetchMe, fetchMyCoupons } from '@/services/member';
import { toWalletRow, useWalletStore, type WalletRow } from '@/stores/wallet';
import { clearQrCanvas, prefetchQr } from '@/utils/qrImage';
import { sliceWindow } from '@/utils/windowList';
import { friendlyMessage } from '@/utils/errors';
import { enableShareMenu, rememberMember } from '@/utils/share';

const props = defineProps<{ active?: boolean }>();
const session = useSessionStore();
const tabs = [
  { key: 'UNUSED', text: '未使用' },
  { key: 'USED', text: '已使用' },
  { key: 'EXPIRED', text: '已过期' },
] as const;
type Tab = (typeof tabs)[number]['key'];

const status = ref<Tab>('UNUSED');
const loading = ref(true);
const loadingMore = ref(false);
const refreshing = ref(false);
const errorText = ref('');
const wallet = useWalletStore();
const inst = getCurrentInstance();
const list = ref<WalletRow[]>([]);
const qrImages = ref<Record<string, string>>({});
const page = ref(1);
const total = ref(0);
const qrCode = ref('');
const qrOpen = ref(false);
const pageSize = 10;

function paint(rows: WalletRow[]) {
  prefetchQr(rows.map((row) => row.code), inst?.proxy, (code, path) => {
    qrImages.value[code] = path;
  });
}

async function load(reset: boolean) {
  if (reset && status.value === 'UNUSED' && wallet.ready) {
    page.value = 1;
    list.value = wallet.rows.slice();
    total.value = wallet.total;
    loading.value = false;
    paint(list.value);
  } else if (reset) {
    page.value = 1;
    loading.value = list.value.length === 0;
  } else {
    loadingMore.value = true;
  }
  errorText.value = '';
  try {
    if (reset && status.value === 'UNUSED') {
      await wallet.warm(wallet.ready);
      if (status.value !== 'UNUSED') return;
      list.value = wallet.rows.slice();
      total.value = wallet.total;
      paint(list.value);
      return;
    }
    const data = await fetchMyCoupons(status.value, reset ? 1 : page.value, pageSize);
    total.value = data.total;
    const rows = (data.list || []).map(toWalletRow);
    list.value = reset ? rows : list.value.concat(rows);
    paint(rows);
  } catch (error) {
    errorText.value = friendlyMessage(error, '卡包没有加载出来');
  } finally {
    loading.value = false;
    loadingMore.value = false;
    refreshing.value = false;
    uni.stopPullDownRefresh();
  }
}

function switchTab(next: Tab) {
  if (next === status.value) return;
  status.value = next;
  list.value = [];
  loading.value = true;
  load(true);
}

function more() {
  if (loading.value || loadingMore.value || list.value.length >= total.value) return;
  page.value += 1;
  load(false);
}

const desk = useDeskStore();
const windowed = computed(() => sliceWindow(list.value, desk.scrollTop));

function open(item: WalletRow) {
  if (status.value !== 'UNUSED' || !item.code) return;
  qrCode.value = item.code;
  qrOpen.value = true;
}

function shutQr() {
  qrOpen.value = false;
  clearQrCanvas();
}

watch(() => desk.pull, () => { if (props.active) load(true); });
watch(() => desk.reach, () => { if (props.active) more(); });

watch(
  () => props.active,
  (on) => {
    if (!on) return;
    session.hydrate();
    enableShareMenu();
    fetchMe().then((me) => rememberMember(me.id)).catch(() => undefined);
    load(true);
  },
  { immediate: true },
);
</script>

<template>
  <view class="page">
    <view class="tabs">
      <view
        v-for="tab in tabs"
        :key="tab.key"
        class="tab"
        :class="{ 'is-on': status === tab.key }"
        @tap="switchTab(tab.key)"
      hover-class="press"
      >{{ tab.text }}</view>
    </view>
    <view class="list">
      <list-skeleton v-if="loading" />
      <view v-else-if="errorText" class="fail">{{ errorText }}</view>
      <empty-state v-else-if="!list.length" title="这个分类里还没有券" hint="兑换或到店领取后，会出现在这里" />
      <view :style="{ height: windowed.padTop + 'px' }" />
      <view v-for="item in windowed.items" :key="item.id" class="card" hover-class="press" @tap="open(item)">
        <view class="card__face">¥{{ item.face }}</view>
        <view class="card__main">
          <view class="card__name">{{ item.name }}</view>
          <view class="card__date">有效期至 {{ item.expire }}</view>
        </view>
      </view>
      <view :style="{ height: windowed.padBottom + 'px' }" />
      <view v-if="loadingMore" class="more">正在加载…</view>
      <view v-else-if="list.length && list.length >= total" class="more">没有更多了</view>
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
.qr-cache { position: fixed; left: -400px; top: 0; width: 220px; height: 220px; }
.card { display: flex; align-items: center; gap: 20rpx; background: #fff; border-radius: 32rpx; padding: 28rpx; margin-bottom: 20rpx; box-shadow: 0 12rpx 30rpx rgba(15, 23, 42, 0.05); }
.card__face { width: 120rpx; height: 120rpx; border-radius: 36rpx; background: linear-gradient(160deg, #38bdf8, #14b8a6); color: #fff; display: flex; align-items: center; justify-content: center; font-size: 32rpx; font-weight: 800; }
.card__main { flex: 1; }
.card__name { font-weight: 700; font-size: 30rpx; }
.card__date { margin-top: 8rpx; color: #94a3b8; font-size: 24rpx; }
.empty, .more { text-align: center; color: #64748b; padding: 24rpx 0; }
.fail { color: #b91c1c; font-weight: 700; padding: 24rpx 0; }
.skel { height: 140rpx; border-radius: 16rpx; background: #e2e8f0; }
</style>
