<template>
  <div class="page">
    <el-alert
      type="info"
      :closable="false"
      show-icon
      title="收款在线下完成：点「确认收款」即生效，续费从原到期日顺延，不从当天重算。"
      class="page__tip"
    />

    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="类型">
          <el-select v-model="query.planType" clearable placeholder="全部" style="width: 140px" @change="onSearch">
            <el-option label="主体会员" value="MAIN_MEMBER" />
            <el-option label="附属档位" value="SUB_TIER" />
          </el-select>
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部" style="width: 130px" @change="onSearch">
            <el-option label="待确认" value="PENDING" />
            <el-option label="已生效" value="ACTIVE" />
            <el-option label="已到期" value="EXPIRED" />
            <el-option label="已取消" value="CANCELLED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="orderNo" label="订单号" min-width="170" />
        <el-table-column label="商家" min-width="160">
          <template #default="{ row }">
            {{ row.merchantName || `#${row.merchantId}` }}
            <span v-if="row.merchantCode" class="muted">（{{ row.merchantCode }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="120">
          <template #default="{ row }">
            {{ row.planType === 'MAIN_MEMBER' ? '主体会员' : '附属档位' }}
          </template>
        </el-table-column>
        <el-table-column label="档位 / 周期" min-width="140">
          <template #default="{ row }">
            <el-tag v-if="row.tier === 'ADVANCED'" size="small" effect="dark" :color="row.tierColor || '#A855F7'">
              高级合作商
            </el-tag>
            <el-tag v-else-if="row.tier === 'PRIMARY'" size="small" :color="row.tierColor || '#F5B301'">
              初级合作商
            </el-tag>
            <span v-else>{{ row.periodName }}</span>
          </template>
        </el-table-column>
        <el-table-column label="金额" width="100" align="right">
          <template #default="{ row }">¥{{ row.amount.toFixed(2) }}</template>
        </el-table-column>
        <el-table-column label="有效期" min-width="190">
          <template #default="{ row }">
            <template v-if="row.endsAt">
              {{ formatDateTime(row.startsAt) }} ~ {{ formatDateTime(row.endsAt) }}
            </template>
            <span v-else class="muted">确认后生成</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="备注" min-width="140">
          <template #default="{ row }">
            <span class="muted">{{ row.remark || row.payRemark || '—' }}</span>
          </template>
        </el-table-column>
        <el-table-column label="提交时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <template v-if="row.status === 'PENDING' && canConfirm">
              <el-button link type="primary" size="small" @click="confirm(row)">确认收款</el-button>
              <el-button link type="danger" size="small" @click="cancel(row)">驳回</el-button>
            </template>
            <span v-else class="muted">—</span>
          </template>
        </el-table-column>
        <template #empty><el-empty description="没有充值记录" /></template>
      </el-table>

      <el-pagination
        class="page__pager"
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :page-sizes="[10, 20, 50]"
        @size-change="load"
        @current-change="load"
      />
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { subscriptionApi, type SubscriptionItem } from '@/api/subscription';
import { useUserStore } from '@/stores/user';
import { formatDateTime } from '@/utils/dict';

const userStore = useUserStore();
const canConfirm = computed(() => userStore.permissions.includes('subscription:confirm'));

const loading = ref(false);
const list = ref<SubscriptionItem[]>([]);
const total = ref(0);
const query = reactive({
  page: 1,
  pageSize: 20,
  planType: '',
  status: 'PENDING',
});

const STATUS_TEXT: Record<string, string> = {
  PENDING: '待确认',
  ACTIVE: '已生效',
  EXPIRED: '已到期',
  CANCELLED: '已取消',
};

function statusText(s: string) {
  return STATUS_TEXT[s] || s;
}
function statusType(s: string) {
  if (s === 'ACTIVE') return 'success';
  if (s === 'PENDING') return 'warning';
  if (s === 'CANCELLED') return 'danger';
  return 'info';
}

async function load() {
  loading.value = true;
  try {
    const res = await subscriptionApi.list({
      page: query.page,
      pageSize: query.pageSize,
      planType: query.planType || undefined,
      status: query.status || undefined,
    });
    list.value = res.list;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  query.page = 1;
  load();
}

async function confirm(row: SubscriptionItem) {
  const { value } = await ElMessageBox.prompt(
    `确认已收到商家「${row.merchantName || row.merchantId}」的 ¥${row.amount.toFixed(2)}？确认后立即生效。`,
    '确认收款',
    {
      confirmButtonText: '确认收款',
      cancelButtonText: '取消',
      inputPlaceholder: '收款凭证号 / 备注（选填）',
      inputValue: '',
    },
  );
  await subscriptionApi.confirm(row.id, value || undefined);
  ElMessage.success('已生效');
  load();
}

async function cancel(row: SubscriptionItem) {
  await ElMessageBox.confirm(`驳回「${row.orderNo}」？驳回后商家需要重新提交。`, '驳回申请', {
    type: 'warning',
    confirmButtonText: '驳回',
    cancelButtonText: '取消',
  });
  await subscriptionApi.cancel(row.id);
  ElMessage.success('已驳回');
  load();
}

onMounted(load);
</script>

<style scoped>
.page__tip {
  margin-bottom: 12px;
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
</style>
