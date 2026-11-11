<template>
  <div class="h5">
    <van-nav-bar title="积分兑换" />

    <van-notice-bar
      left-icon="info-o"
      color="#166534"
      background="#f0fdf4"
      text="测试环境专用：当前登录来自模拟 code，不是微信开放平台。userId 取自 C 端令牌。"
    />

    <div class="h5__user">
      <span class="h5__user-label">当前用户</span>
      <span style="font-weight: 600; color: #1e293b">
        {{ currentUser?.nickname || currentUser?.phone || '—' }}
      </span>
      <van-button size="mini" plain @click="onLogout">退出</van-button>
      <span v-if="account" class="h5__balance">
        积分 <b>{{ account.account.balance }}</b>
        <span class="h5__dim">（可用 {{ account.summary.available }}）</span>
      </span>
    </div>

    <div class="h5__tabs">
      <van-tabs v-model:active="tab" sticky>
        <van-tab title="可兑换券" name="list">
          <van-loading v-if="loading" size="20px" class="h5__loading">加载中...</van-loading>
          <van-empty v-else-if="!exchangeable.length" description="暂无可兑换的代金券" />
          <div v-else class="h5__cards">
            <div v-for="t in exchangeable" :key="t.id" class="h5__card">
              <div class="h5__card-left">
                <div class="h5__face">¥<b>{{ t.faceValue }}</b></div>
                <div class="h5__cond">{{ t.thresholdAmount > 0 ? `满 ${t.thresholdAmount} 可用` : '无门槛' }}</div>
              </div>
              <div class="h5__card-body">
                <div class="h5__name">{{ t.name }}</div>
                <div class="h5__sub">{{ t.subtitle || '—' }}</div>
                <div class="h5__meta">
                  剩余 {{ t.remainingStock }} 张 · 限领 {{ t.perUserLimit }} 张
                </div>
              </div>
              <div class="h5__card-right">
                <div class="h5__cost">{{ t.pointsCost }} 积分</div>
                <van-button
                  type="primary"
                  size="small"
                  :loading="submitId === t.id"
                  :disabled="submitId !== null || !canExchange(t)"
                  @click="onExchange(t)"
                >
                  兑换
                </van-button>
              </div>
            </div>
          </div>
        </van-tab>

        <van-tab title="我的兑换" name="records">
          <van-loading v-if="recLoading" size="20px" class="h5__loading">加载中...</van-loading>
          <van-empty v-else-if="!records.length" description="还没有兑换记录" />
          <div v-else class="h5__records">
            <div v-for="r in records" :key="r.id" class="h5__record">
              <div class="h5__record-top">
                <span class="h5__rname">{{ r.templateName }}</span>
                <span class="h5__rcost">-{{ r.pointsCost }} 积分</span>
              </div>
              <div class="h5__rcode">
                券码 <b>{{ r.code || '—' }}</b>
                <span class="h5__dim">（{{ formatDateTime(r.createdAt) }}）</span>
              </div>
            </div>
          </div>
        </van-tab>
      </van-tabs>
    </div>

    <!-- 兑换成功：给券码 + 有效期 + 引导去卡包 -->
    <van-dialog
      v-model:show="successVisible"
      title="兑换成功"
      confirm-button-text="去卡包查看"
      @confirm="onGoWallet"
    >
      <div class="h5__result">
        <div class="h5__result-code">{{ result?.code }}</div>
        <div class="h5__result-row">
          <span>有效期至</span><b>{{ result?.expireAt ? formatDateTime(result.expireAt).slice(0, 10) : '—' }}</b>
        </div>
        <div class="h5__result-row">
          <span>消耗积分</span><b>{{ result?.pointsCost }}</b>
        </div>
        <div class="h5__result-row">
          <span>剩余积分</span><b>{{ result?.balance ?? account?.account.balance }}</b>
        </div>
        <div v-if="result?.deductions?.length" class="h5__result-tip">
          已按最早过期批次优先扣减（{{ result.deductions.length }} 个批次），过期积分不参与兑换。
        </div>
      </div>
    </van-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showDialog, showFailToast, showSuccessToast } from 'vant';
import { h5Api, type H5Template, type H5User } from '@/api/h5';
import { h5Auth } from '@/utils/h5Request';
import type { ExchangeRecord, ExchangeResult, PointAccountDetail } from '@/types/business';
import { formatDateTime } from '@/utils/dict';

const router = useRouter();
const currentUser = ref<H5User | null>(h5Auth.user<H5User>());
const account = ref<PointAccountDetail | null>(null);
const templates = ref<H5Template[]>([]);
const records = ref<ExchangeRecord[]>([]);
const loading = ref(false);
const recLoading = ref(false);
const tab = ref<'list' | 'records'>('list');
const submitId = ref<number | null>(null);
const successVisible = ref(false);
const result = ref<ExchangeResult | null>(null);

/** 只有「已上架 + 还有库存 + 设了兑换积分」的券才展示给用户 */
const exchangeable = computed(() =>
  templates.value.filter((t) => t.status === 'PUBLISHED' && t.remainingStock > 0 && t.pointsCost > 0),
);

function canExchange(t: H5Template) {
  return (account.value?.summary.available ?? 0) >= t.pointsCost;
}

async function loadAccount() {
  try {
    account.value = await h5Api.account();
  } catch {
    account.value = null;
  }
}

async function loadTemplates() {
  loading.value = true;
  try {
    templates.value = (await h5Api.templates()).list;
  } finally {
    loading.value = false;
  }
}

async function loadRecords() {
  recLoading.value = true;
  try {
    records.value = (await h5Api.exchangeRecords({ page: 1, pageSize: 20 })).list;
  } catch {
    records.value = [];
  } finally {
    recLoading.value = false;
  }
}

function onLogout() {
  h5Auth.clear();
  router.replace('/h5/login');
}

/**
 * 兑换：requestId 由前端生成一次并**在本次按钮点击内复用**（重试时不重新生成）。
 * userId 取自 C 端令牌（仍显式带上，后端会校验「令牌 userId === 请求 userId」，伪造 → 403）。
 */
function onExchange(t: H5Template) {
  const requestId = crypto.randomUUID();
  const tplName = t.name;
  const userId = currentUser.value?.id;
  if (!userId) {
    showFailToast('未登录');
    return;
  }

  showDialog({
    title: '确认兑换',
    message: `消耗 ${t.pointsCost} 积分兑换「${tplName}」\n当前可用 ${account.value?.summary.available ?? 0} 积分，兑换后剩余 ${
      (account.value?.summary.available ?? 0) - t.pointsCost
    } 积分`,
    showCancelButton: true,
    confirmButtonText: '确认兑换',
    cancelButtonText: '再想想',
  })
    .then(async () => {
      submitId.value = t.id;
      try {
        const res = await h5Api.exchange({ userId, templateId: t.id, requestId, channel: 'H5' });
        result.value = res;
        if (res.idempotent) {
          showSuccessToast('已兑换过，为您展示上次那张券');
        }
        successVisible.value = true;
        await Promise.all([loadAccount(), loadRecords()]);
      } catch (e) {
        showFailToast((e as Error).message || '兑换失败');
      } finally {
        submitId.value = null;
      }
    })
    .catch(() => {
      /* 用户取消 */
    });
}

function onGoWallet() {
  successVisible.value = false;
  tab.value = 'records';
}

onMounted(async () => {
  await Promise.all([loadAccount(), loadTemplates(), loadRecords()]);
});
</script>

<style scoped>
.h5 {
  min-height: 100vh;
  background: #f5f6f8;
  padding-bottom: 24px;
}
.h5__user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #fff;
}
.h5__user-label {
  font-size: 13px;
  color: #64748b;
  white-space: nowrap;
}
.h5__balance {
  margin-left: auto;
  font-size: 13px;
  color: #475569;
  white-space: nowrap;
}
.h5__balance b {
  color: #f59e0b;
  font-size: 16px;
}
.h5__dim {
  color: #94a3b8;
  font-size: 12px;
}
.h5__loading {
  padding: 24px;
  text-align: center;
}
.h5__cards {
  padding: 12px;
}
.h5__card {
  display: flex;
  align-items: center;
  gap: 12px;
  background: #fff;
  border-radius: 10px;
  padding: 14px;
  margin-bottom: 10px;
}
.h5__card-left {
  width: 84px;
  text-align: center;
  border-right: 1px dashed #e2e8f0;
}
.h5__face {
  color: #ef4444;
  font-size: 13px;
}
.h5__face b {
  font-size: 26px;
}
.h5__cond {
  font-size: 12px;
  color: #94a3b8;
}
.h5__card-body {
  flex: 1;
  min-width: 0;
}
.h5__name {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}
.h5__sub,
.h5__meta {
  font-size: 12px;
  color: #94a3b8;
  margin-top: 4px;
}
.h5__card-right {
  text-align: right;
}
.h5__cost {
  font-size: 13px;
  color: #f59e0b;
  margin-bottom: 6px;
}
.h5__records {
  padding: 12px;
}
.h5__record {
  background: #fff;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.h5__record-top {
  display: flex;
  justify-content: space-between;
  font-size: 14px;
}
.h5__rname {
  font-weight: 600;
}
.h5__rcost {
  color: #ef4444;
}
.h5__rcode {
  margin-top: 6px;
  font-size: 12px;
  color: #64748b;
}
.h5__result {
  padding: 8px 4px;
}
.h5__result-code {
  text-align: center;
  font-size: 22px;
  letter-spacing: 2px;
  font-weight: 700;
  color: #16a34a;
  margin-bottom: 12px;
}
.h5__result-row {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  color: #64748b;
  padding: 4px 8px;
}
.h5__result-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #94a3b8;
}
</style>
