<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部状态" style="width: 130px" @change="onSearch">
            <el-option v-for="opt in ORDER_STATUS_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="订单号">
          <el-input v-model="orderNoInput" clearable placeholder="订单号" style="width: 160px" @keyup.enter="onSearch" />
        </el-form-item>
        <el-form-item label="用户 id">
          <el-input v-model="userIdInput" clearable placeholder="用户 id" style="width: 110px" @keyup.enter="onSearch" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
          <el-button @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="orderNo" label="订单号" min-width="150" />
        <el-table-column label="用户" min-width="130">
          <template #default="{ row }">{{ row.userName || '-' }}<span class="page__dim">{{ row.userPhone }}</span></template>
        </el-table-column>
        <el-table-column label="商家 / 门店" min-width="140">
          <template #default="{ row }">{{ row.merchantName || `商家 #${row.merchantId}` }}<span v-if="row.storeName" class="page__dim"> / {{ row.storeName }}</span></template>
        </el-table-column>
        <el-table-column prop="totalAmount" label="金额" width="90" align="right" />
        <el-table-column prop="pointsEarned" label="送积分" width="80" align="right" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="orderStatusTagType(row.status)">{{ orderStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="券" width="150">
          <template #default="{ row }">
            <span v-if="row.couponCode">{{ row.couponCode }}</span>
            <span v-else class="page__dim">—</span>
            <span v-if="row.couponStatus" class="page__dim">（{{ row.couponStatus }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="170" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="$router.push(`/main/orders/${row.id}`)">详情</el-button>
            <el-button v-if="row.status === 'NORMAL'" link type="warning" size="small" @click="openMarkAbnormal(row)">标记异常</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="没有符合条件的订单" /></template>
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

      <el-dialog v-model="abnormalVisible" title="标记异常订单" width="460px">
        <el-form label-width="90px">
          <el-form-item label="异常类型">
            <el-select v-model="abnormalForm.abnormalType" style="width: 100%">
              <el-option label="金额异常" value="AMOUNT_ERROR" />
              <el-option label="券重复使用" value="DUPLICATE_COUPON" />
              <el-option label="退款未回退券" value="REFUND_NOT_RETURNED" />
              <el-option label="门店争议" value="STORE_DISPUTE" />
            </el-select>
          </el-form-item>
          <el-form-item label="异常说明">
            <el-input v-model="abnormalForm.abnormalRemark" type="textarea" :rows="3" placeholder="必填，≥5 字符" />
          </el-form-item>
        </el-form>
        <template #footer>
          <el-button @click="abnormalVisible = false">取消</el-button>
          <el-button type="primary" :loading="submitting" @click="submitAbnormal">确定</el-button>
        </template>
      </el-dialog>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { orderApi, type OrderListItem } from '@/api/order';
import { formatDateTime } from '@/utils/dict';

const ORDER_STATUS_OPTIONS = [
  { value: 'NORMAL', label: '正常' },
  { value: 'ABNORMAL', label: '异常' },
  { value: 'REFUNDED', label: '已退款' },
  { value: 'CANCELED', label: '已取消' },
];
const ORDER_STATUS: Record<string, { label: string; type: 'success' | 'info' | 'warning' | 'danger' }> = {
  NORMAL: { label: '正常', type: 'success' },
  ABNORMAL: { label: '异常', type: 'danger' },
  REFUNDED: { label: '已退款', type: 'info' },
  CANCELED: { label: '已取消', type: 'warning' },
};
const orderStatusLabel = (s: string) => ORDER_STATUS[s]?.label ?? s;
const orderStatusTagType = (s: string) => ORDER_STATUS[s]?.type ?? 'info';

const list = ref<OrderListItem[]>([]);
const total = ref(0);
const loading = ref(false);
const query = reactive({ page: 1, pageSize: 10, status: '' as string });
const orderNoInput = ref('');
const userIdInput = ref('');

async function load() {
  loading.value = true;
  try {
    const res = await orderApi.list({ page: query.page, pageSize: query.pageSize, status: query.status || undefined, orderNo: orderNoInput.value || undefined });
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

function resetFilter() {
  query.status = '';
  orderNoInput.value = '';
  userIdInput.value = '';
  onSearch();
}

// 标记异常
const abnormalVisible = ref(false);
const submitting = ref(false);
const abnormalForm = reactive({ orderId: 0, abnormalType: 'AMOUNT_ERROR', abnormalRemark: '' });

function openMarkAbnormal(row: OrderListItem) {
  abnormalForm.orderId = row.id;
  abnormalForm.abnormalType = 'AMOUNT_ERROR';
  abnormalForm.abnormalRemark = '';
  abnormalVisible.value = true;
}

async function submitAbnormal() {
  if (abnormalForm.abnormalRemark.trim().length < 5) {
    ElMessage.warning('异常说明至少 5 个字符');
    return;
  }
  submitting.value = true;
  try {
    await orderApi.markAbnormal(abnormalForm.orderId, { abnormalType: abnormalForm.abnormalType, abnormalRemark: abnormalForm.abnormalRemark });
    ElMessage.success('已标记异常');
    abnormalVisible.value = false;
    load();
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.page__filter {
  margin-bottom: 4px;
}
.page__pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.page__dim {
  color: #94a3b8;
}
</style>
