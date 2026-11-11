<template>
  <div class="h5">
    <van-nav-bar title="积分明细" />

    <van-notice-bar
      left-icon="info-o"
      color="#166534"
      background="#f0fdf4"
      text="测试环境专用：当前登录来自模拟 code。积分明细的 userId 取自 C 端令牌。"
    />

    <div class="h5__user">
      <span class="h5__label">当前用户</span>
      <span style="font-weight: 600; color: #1e293b">
        {{ currentUser?.nickname || currentUser?.phone || '—' }}
      </span>
      <van-button size="mini" plain @click="onLogout">退出</van-button>
      <span v-if="account" class="h5__balance">
        积分 <b>{{ account.account.balance }}</b>
        <span class="h5__dim">（可用 {{ account.summary.available }}）</span>
      </span>
    </div>

    <van-dropdown-menu active-color="#f59e0b">
      <van-dropdown-item v-model="typeFilter" :options="typeOptions" @change="onFilterChange" />
    </van-dropdown-menu>

    <van-loading v-if="loading" size="20px" class="h5__loading">加载中...</van-loading>
    <van-empty v-else-if="!list.length" description="暂无积分明细" />
    <div v-else class="h5__list">
      <div v-for="t in list" :key="t.id" class="h5__row">
        <div class="h5__row-main">
          <span class="h5__type">{{ pointTxnTypeLabel(t.type) }}</span>
          <span class="h5__amount" :class="amountClass(t.amount)">{{ pointAmountText(t.amount) }}</span>
        </div>
        <div class="h5__remark">{{ t.remark || '—' }}</div>
        <div class="h5__meta">
          <span>{{ t.merchantName || '平台' }}</span>
          <span>{{ formatDateTime(t.createdAt) }}</span>
        </div>
        <div class="h5__after">余额 {{ t.balanceAfter }}</div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { showFailToast } from 'vant';
import { h5Api, type H5User } from '@/api/h5';
import { h5Auth } from '@/utils/h5Request';
import type { PointAccountDetail, PointTransaction, PointTxnType } from '@/types/business';
import { formatDateTime, pointAmountText, pointTxnTypeLabel, POINT_TXN_TYPE_OPTIONS } from '@/utils/dict';

const router = useRouter();
const currentUser = ref<H5User | null>(h5Auth.user<H5User>());
const account = ref<PointAccountDetail | null>(null);
const list = ref<PointTransaction[]>([]);
const loading = ref(false);
const typeFilter = ref<string>('ALL');
const typeOptions = [
  { text: '全部类型', value: 'ALL' },
  ...POINT_TXN_TYPE_OPTIONS.map((o) => ({ text: o.label, value: o.value })),
];

function amountClass(amount: number) {
  if (amount > 0) return 'plus';
  if (amount < 0) return 'minus';
  return '';
}

async function loadAccount() {
  try {
    account.value = await h5Api.account();
  } catch {
    account.value = null;
  }
}

async function loadList() {
  loading.value = true;
  try {
    const res = await h5Api.transactions({
      page: 1,
      pageSize: 100,
      type: typeFilter.value === 'ALL' ? undefined : (typeFilter.value as PointTxnType),
    });
    list.value = res.list;
  } catch (e) {
    list.value = [];
    showFailToast((e as Error).message || '加载失败');
  } finally {
    loading.value = false;
  }
}

function onLogout() {
  h5Auth.clear();
  router.replace('/h5/login');
}

function onFilterChange() {
  loadList();
}

onMounted(() => {
  loadAccount();
  loadList();
});
</script>

<style scoped>
.h5 {
  min-height: 100vh;
  background: #f5f6f8;
}
.h5__user {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  background: #fff;
}
.h5__label {
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
.h5__list {
  padding: 12px;
}
.h5__row {
  background: #fff;
  border-radius: 10px;
  padding: 12px 14px;
  margin-bottom: 10px;
}
.h5__row-main {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.h5__type {
  font-size: 15px;
  font-weight: 600;
  color: #1e293b;
}
.h5__amount {
  font-size: 18px;
  font-weight: 700;
}
.h5__amount.plus {
  color: #16a34a;
}
.h5__amount.minus {
  color: #ef4444;
}
.h5__remark {
  margin-top: 4px;
  font-size: 12px;
  color: #64748b;
}
.h5__meta {
  margin-top: 6px;
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #94a3b8;
}
.h5__after {
  margin-top: 4px;
  font-size: 12px;
  color: #94a3b8;
  text-align: right;
}
</style>
