<script setup lang="ts">
import { computed, ref } from 'vue';
import { onLoad, onPullDownRefresh, onShareAppMessage } from '@dcloudio/uni-app';
import NetworkBanner from '@/components/NetworkBanner.vue';
import { request } from '@/utils/request';
import { friendlyMessage } from '@/utils/errors';
import { applySharePath, merchantInviteCode } from '@/utils/share';
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
  issuedCount?: number;
  usedCount?: number;
  /** 下面三个由 load() 预先算好，避免模板里重复调用函数 */
  progIssued?: number;
  progUsed?: number;
  progRate?: number;
};

const loading = ref(true);
const errorText = ref('');
const list = ref<TemplateRow[]>([]);

/** 券模板上的 issuedCount / usedCount 是后端冗余计数，直接用来算真实核销率。 */
const totals = computed(() => {
  const issued = list.value.reduce((sum, item) => sum + (item.issuedCount || 0), 0);
  const used = list.value.reduce((sum, item) => sum + (item.usedCount || 0), 0);
  return { issued, used, rate: issued ? Math.round((used / issued) * 100) : 0 };
});

/** 单张券的核销进度；没发放过就不写这三个字段，卡片不渲染空进度条。 */
function withProgress(row: TemplateRow): TemplateRow {
  const issued = row.issuedCount || 0;
  if (!issued) return row;
  const used = row.usedCount || 0;
  return { ...row, progIssued: issued, progUsed: used, progRate: Math.min(100, Math.round((used / issued) * 100)) };
}

const statusText = computed(() => {
  const on = list.value.filter((item) => item.status === 'PUBLISHED').length;
  return on ? `已上架 ${on} 个` : '暂无上架';
});

onShareAppMessage(() => ({
  title: '邀请商家一起用小Z做营销',
  path: applySharePath(merchantInviteCode(Number(uni.getStorageSync('mini_merchant_id') || 0))),
}));

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
    list.value = rows.map(withProgress);
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
  <view class="pm-page pm-page--plain">
    <network-banner />

    <view class="pm-hero pm-hero--short">
      <view class="pm-hero__glow" />
      <view class="pm-hero__glow2" />
      <view class="pm-hero__inner">
        <view class="hero-top">
          <text class="pm-hero__title">营销与卡券</text>
          <text class="hero-sub">{{ statusText }}</text>
        </view>
        <view class="pm-bignum hero-num">
          <text class="pm-bignum__v">{{ list.length }}</text>
          <text class="pm-bignum__u">个券模板</text>
        </view>
        <text class="pm-hero__cap hero-cap">
          已发放 {{ totals.issued }} 张 · 已核销 {{ totals.used }} 张<text v-if="totals.issued"> · 核销率 {{ totals.rate }}%</text>
        </text>
      </view>
    </view>

    <view class="pm-body">
      <view class="actions">
        <view class="action" hover-class="press" @tap="goIssue()">
          <view class="action__ico action__ico--teal">券</view>
          <text class="action__t">发放代金券</text>
          <text class="action__d">发给会员</text>
        </view>
        <view class="action" hover-class="press" @tap="goVerify">
          <view class="action__ico action__ico--blue">扫</view>
          <text class="action__t">去核销</text>
          <text class="action__d">扫券码核销</text>
        </view>
        <view class="action" hover-class="press" @tap="goAiCopy">
          <view class="action__ico action__ico--dark">AI</view>
          <text class="action__t">写促销文案</text>
          <text class="action__d">交给小Z</text>
        </view>
      </view>

      <view class="pm-section">
        <text class="pm-section__t">券模板</text>
        <text class="pm-section__more" @tap="goIssue()">新建 ›</text>
      </view>

      <view v-if="loading">
        <view v-for="i in 3" :key="i" class="pm-skel skel-row" />
      </view>
      <view v-else-if="errorText" class="pm-card fail">
        <text class="fail__t">{{ errorText }}</text>
      </view>
      <view v-else-if="!list.length" class="pm-card pm-empty">
        <view class="pm-empty__t">暂无可见券模板</view>
        <view class="pm-empty__d">联盟创建并授权后，这里会列出可核销的券</view>
      </view>
      <template v-else>
        <view v-for="item in list" :key="item.id" class="tpl">
          <view class="tpl__top">
            <text class="tpl__name">{{ item.name || `券模板 #${item.id}` }}</text>
            <text class="pm-pill" :class="item.status === 'PUBLISHED' ? 'pm-pill--teal' : 'pm-pill--muted'">
              {{ statusLabel(item.status) }}
            </text>
          </view>
          <view class="tpl__meta">
            <text>面额 {{ money(item.faceValue) }}</text>
            <text class="sep">·</text>
            <text>门槛 {{ money(item.thresholdAmount) }}</text>
            <text v-if="item.remainingStock != null" class="sep">·</text>
            <text v-if="item.remainingStock != null">余 {{ item.remainingStock }} 张</text>
          </view>

          <view v-if="item.progIssued" class="tpl__prog">
            <view class="pm-bar">
              <view class="pm-bar__fill" :style="{ width: (item.progRate || 0) + '%' }" />
            </view>
            <view class="tpl__prog-foot">
              <text>已核销 {{ item.progUsed }} / {{ item.progIssued }}</text>
              <text class="tpl__rate">{{ item.progRate }}%</text>
            </view>
          </view>

          <view v-if="item.status === 'PUBLISHED'" class="tpl__act">
            <view class="mini-btn" hover-class="press" @tap.stop="goIssue(item.id)">发放</view>
          </view>
        </view>
      </template>
    </view>
  </view>
</template>

<style scoped>
.hero-top { display: flex; align-items: center; justify-content: space-between; }
.hero-sub { font-size: 20rpx; color: rgba(255, 255, 255, 0.5); }
.hero-num { margin-top: 16rpx; }
.hero-cap { display: block; margin-top: 10rpx; }

.actions { display: flex; gap: 14rpx; }
.action {
  flex: 1; background: #fff; border: 1rpx solid #eaf0f2; border-radius: 28rpx;
  padding: 22rpx 18rpx; box-shadow: 0 8rpx 28rpx rgba(10, 60, 58, 0.05);
}
.action__ico {
  width: 56rpx; height: 56rpx; border-radius: 18rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 22rpx; font-weight: 800;
}
.action__ico--teal { background: #e8fbf7; color: #00766a; }
.action__ico--blue { background: #eaf2ff; color: #1c6dd0; }
.action__ico--dark { background: #07262f; color: #7ff0dd; }
.action__t { display: block; margin-top: 14rpx; font-size: 24rpx; font-weight: 700; color: #0e1f26; }
.action__d { display: block; margin-top: 4rpx; font-size: 20rpx; color: #8a9aa3; }

.skel-row { height: 190rpx; border-radius: 32rpx; margin-bottom: 18rpx; }

.tpl {
  background: #fff; border: 1rpx solid #eaf0f2; border-radius: 32rpx;
  padding: 26rpx 28rpx; margin-bottom: 18rpx;
  box-shadow: 0 8rpx 28rpx rgba(10, 60, 58, 0.05);
}
.tpl__top { display: flex; align-items: center; gap: 16rpx; }
.tpl__name { flex: 1; min-width: 0; font-size: 30rpx; font-weight: 700; color: #0e1f26; }
.tpl__meta { margin-top: 12rpx; display: flex; align-items: center; flex-wrap: wrap; font-size: 22rpx; color: #6d818b; }
.sep { margin: 0 10rpx; color: #cfdce1; }
.tpl__prog { margin-top: 18rpx; }
.tpl__prog-foot {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 10rpx; font-size: 20rpx; color: #8a9aa3;
}
.tpl__rate { color: #00a08c; font-weight: 700; }
.tpl__act { margin-top: 18rpx; display: flex; justify-content: flex-end; }
.mini-btn {
  padding: 12rpx 32rpx; border-radius: 999rpx;
  background: linear-gradient(135deg, #00d6b2, #19a7f8);
  color: #fff; font-size: 24rpx; font-weight: 700;
}
.fail__t { font-size: 26rpx; color: #c0342f; line-height: 1.6; }
</style>
