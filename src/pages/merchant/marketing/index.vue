<script setup lang="ts">
import { ref } from 'vue';
import { onLoad, onPullDownRefresh } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { request } from '@/utils/request';
import { friendlyMessage } from '@/utils/errors';
import { useDeskStore } from '@/stores/desk';

type TemplateRow = {
  id: number;
  name: string;
  status?: string;
  faceValue?: number;
  thresholdAmount?: number;
  type?: string;
  remainingStock?: number;
  totalStock?: number;
};

const loading = ref(true);
const errorText = ref('');
const list = ref<TemplateRow[]>([]);

onLoad(() => { load(); });
onPullDownRefresh(() => { load(); });

async function load() {
  loading.value = true;
  errorText.value = '';
  try {
    const data = await request<{ list?: TemplateRow[]; items?: TemplateRow[] } | TemplateRow[]>({
      url: '/coupon-templates?page=1&pageSize=50',
      redirectOn401: false,
    });
    const rows = Array.isArray(data)
      ? data
      : (data?.list || data?.items || []);
    list.value = rows;
  } catch (error) {
    errorText.value = friendlyMessage(error, '券模板加载失败');
    list.value = [];
  } finally {
    loading.value = false;
    uni.stopPullDownRefresh();
  }
}

function statusLabel(s?: string) {
  if (s === 'PUBLISHED' || s === 'ON') return '已上架';
  if (s === 'DRAFT') return '草稿';
  if (s === 'OFF' || s === 'UNPUBLISHED') return '已下架';
  return s || '—';
}

function money(n?: number) {
  if (n == null) return '—';
  return `¥${Number(n).toFixed(n % 1 ? 2 : 0)}`;
}

function goVerify() {
  useDeskStore().merchant = 'verify';
  uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/merchant/workbench/index' }) });
}

function goAiCopy() {
  useDeskStore().merchant = 'ai';
  uni.navigateBack({ fail: () => uni.reLaunch({ url: '/pages/merchant/workbench/index' }) });
}

function goIssue(templateId?: number) {
  const q = templateId ? `?templateId=${templateId}` : '';
  uni.navigateTo({ url: `/pages/merchant/issue/index${q}` });
}
</script>

<template>
  <view class="page">
    <network-banner />
    <view class="hero">
      <text class="hero__t">营销与卡券</text>
      <text class="hero__d">券模板 · 主体发券 · 核销与促销</text>
    </view>

    <view class="actions">
      <view class="action" @tap="goIssue()">
        <text class="at">发放代金券</text>
        <text class="ad">发给会员手机号</text>
      </view>
      <view class="action" @tap="goVerify">
        <text class="at">去核销</text>
        <text class="ad">扫券码核销</text>
      </view>
      <view class="action" @tap="goAiCopy">
        <text class="at">写促销文案</text>
        <text class="ad">交给小Z</text>
      </view>
    </view>

    <view v-if="loading" class="skel" />
    <view v-else-if="errorText" class="fail">{{ errorText }}</view>
    <view v-else-if="!list.length" class="empty">
      <text class="empty__t">暂无可见券模板</text>
      <text class="empty__d">主体创建并授权后，这里会列出可核销的券。</text>
    </view>
    <view v-else class="list">
      <view v-for="item in list" :key="item.id" class="card">
        <view class="card__top">
          <text class="name">{{ item.name || `券模板 #${item.id}` }}</text>
          <text class="badge">{{ statusLabel(item.status) }}</text>
        </view>
        <view class="meta">
          <text>面额 {{ money(item.faceValue) }}</text>
          <text class="dot">·</text>
          <text>门槛 {{ money(item.thresholdAmount) }}</text>
          <text v-if="item.remainingStock != null" class="dot">·</text>
          <text v-if="item.remainingStock != null">余 {{ item.remainingStock }}</text>
        </view>
        <view v-if="item.status === 'PUBLISHED'" class="card__act">
          <text class="issue-btn" @tap.stop="goIssue(item.id)">发放</text>
        </view>
      </view>
    </view>
  </view>
</template>

<style scoped>
.page { min-height: 100vh; padding-bottom: 80rpx; box-sizing: border-box; background: #f3f7f8; }
.hero {
  padding: 36rpx 32rpx 48rpx;
  background: linear-gradient(135deg, #00c9a7 0%, #2e90ff 100%);
  border-radius: 0 0 40rpx 40rpx;
}
.hero__t { display: block; font-size: 40rpx; font-weight: 800; color: #fff; }
.hero__d { display: block; margin-top: 10rpx; font-size: 24rpx; color: rgba(255,255,255,.9); }
.actions {
  display: flex; flex-wrap: wrap; gap: 16rpx; margin: -28rpx 32rpx 0; position: relative; z-index: 1;
}
.action {
  width: calc(50% - 8rpx); box-sizing: border-box;
  background: #fff; border-radius: 28rpx; padding: 24rpx;
  box-shadow: 0 12rpx 36rpx rgba(10, 60, 58, 0.08);
}
.at { display: block; font-size: 28rpx; font-weight: 800; color: #0e1f26; }
.ad { display: block; margin-top: 6rpx; font-size: 22rpx; color: #8a9aa3; }
.list { margin: 24rpx 32rpx 0; }
.card {
  background: #fff; border-radius: 28rpx; padding: 28rpx; margin-bottom: 16rpx;
  box-shadow: 0 8rpx 28rpx rgba(10, 60, 58, 0.05);
}
.card__top { display: flex; align-items: center; justify-content: space-between; gap: 16rpx; }
.name { font-size: 30rpx; font-weight: 800; color: #0e1f26; flex: 1; }
.badge {
  padding: 6rpx 14rpx; border-radius: 999rpx; background: #e8fbf7;
  color: #00766a; font-size: 22rpx; font-weight: 700; flex-shrink: 0;
}
.meta {
  margin-top: 12rpx; font-size: 24rpx; color: #556670; display: flex; align-items: center; flex-wrap: wrap;
}
.dot { margin: 0 10rpx; color: #c5d0d6; }
.card__act { margin-top: 16rpx; display: flex; justify-content: flex-end; }
.issue-btn {
  padding: 10rpx 28rpx; border-radius: 999rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8); color: #fff;
  font-size: 24rpx; font-weight: 700;
}
.empty {
  margin: 48rpx 32rpx; padding: 48rpx 32rpx; background: #fff; border-radius: 28rpx; text-align: center;
}
.empty__t { display: block; font-size: 30rpx; font-weight: 800; color: #0e1f26; }
.empty__d { display: block; margin-top: 12rpx; font-size: 24rpx; color: #8a9aa3; line-height: 1.5; }
.fail { margin: 32rpx; color: #c22a2e; font-weight: 700; }
.skel { margin: 32rpx; height: 180rpx; border-radius: 28rpx; background: #e2eaee; }
</style>
