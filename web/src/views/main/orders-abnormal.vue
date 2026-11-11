<template>
  <div class="page">
    <el-card shadow="never">
      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="orderNo" label="订单号" min-width="150" />
        <el-table-column label="用户" min-width="130">
          <template #default="{ row }">{{ row.userName || '-' }}<span class="page__dim">{{ row.userPhone }}</span></template>
        </el-table-column>
        <el-table-column label="商家" min-width="120">
          <template #default="{ row }">{{ row.merchantName || `#${row.merchantId}` }}</template>
        </el-table-column>
        <el-table-column prop="totalAmount" label="金额" width="90" align="right" />
        <el-table-column prop="pointsEarned" label="送积分" width="80" align="right" />
        <el-table-column label="异常类型" width="120">
          <template #default="{ row }">
            <el-tag size="small" type="danger">{{ abnormalTypeLabel(row.abnormalType) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="券" width="150">
          <template #default="{ row }">
            <span v-if="row.couponCode">{{ row.couponCode }}</span>
            <span v-else class="page__dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="130" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="$router.push(`/main/orders/${row.id}`)">详情</el-button>
            <el-button link type="danger" size="small" @click="openHandle(row)">处理</el-button>
          </template>
        </el-table-column>
        <template #empty><el-empty description="没有待处理的异常订单" /></template>
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

      <el-drawer v-model="drawerVisible" title="异常订单处理" size="420px">
        <el-descriptions :column="1" border size="small">
          <el-descriptions-item label="订单号">{{ current?.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="异常类型">{{ current ? abnormalTypeLabel(current.abnormalType) : '' }}</el-descriptions-item>
          <el-descriptions-item label="金额">{{ current?.totalAmount }}</el-descriptions-item>
        </el-descriptions>
        <div class="page__ai">
          <el-button :loading="analyzing" @click="onAnalyze">✨ AI 智能分析</el-button>
          <p class="page__hint">仅供运营参考，不会自动处理这笔订单。</p>
          <el-alert
            v-if="analysis"
            :title="`${analysis.suggestion} · 置信度 ${analysis.confidence.toFixed(2)}${analysis.fallbackUsed ? ' · 规则降级' : ''}`"
            :description="analysis.reasons.length ? analysis.reasons.join('、') : '没有额外风险标签'"
            type="info"
            show-icon
            :closable="false"
          />
        </div>
        <el-form label-width="90px" class="page__form">
          <el-form-item label="处理类型">
            <el-radio-group v-model="handleForm.handleType">
              <el-radio value="CANCEL">订单取消</el-radio>
              <el-radio value="AMOUNT_ERROR">金额录入错误</el-radio>
              <el-radio value="DISPUTE">核销争议</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item label="处理结果">
            <el-input v-model="handleForm.result" type="textarea" :rows="4" placeholder="选填，留空则用默认结果" />
          </el-form-item>
          <el-form-item>
            <el-button type="primary" :loading="submitting" @click="submitHandle">确认处理</el-button>
          </el-form-item>
        </el-form>
      </el-drawer>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { aiApi, type AbnormalAnalysis } from '@/api/ai';
import { orderApi, type OrderListItem } from '@/api/order';
import { formatDateTime } from '@/utils/dict';

const ABNORMAL_TYPES: Record<string, string> = {
  AMOUNT_ERROR: '金额异常',
  DUPLICATE_COUPON: '券重复使用',
  REFUND_NOT_RETURNED: '退款未回退券',
  STORE_DISPUTE: '门店争议',
};
const abnormalTypeLabel = (t: string | null) => (t ? ABNORMAL_TYPES[t] ?? t : '—');

const list = ref<OrderListItem[]>([]);
const total = ref(0);
const loading = ref(false);
const query = reactive({ page: 1, pageSize: 10 });

async function load() {
  loading.value = true;
  try {
    const res = await orderApi.abnormal({ page: query.page, pageSize: query.pageSize });
    list.value = res.list;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

const drawerVisible = ref(false);
const submitting = ref(false);
const current = ref<OrderListItem | null>(null);
const handleForm = reactive({ handleType: 'CANCEL' as 'CANCEL' | 'AMOUNT_ERROR' | 'DISPUTE', result: '' });
const analyzing = ref(false);
const analysis = ref<AbnormalAnalysis | null>(null);

function openHandle(row: OrderListItem) {
  current.value = row;
  handleForm.handleType = 'CANCEL';
  handleForm.result = '';
  analysis.value = null;
  drawerVisible.value = true;
}

async function onAnalyze() {
  if (!current.value) return;
  analyzing.value = true;
  try {
    analysis.value = await aiApi.analyzeAbnormal(current.value.id);
  } finally {
    analyzing.value = false;
  }
}

async function submitHandle() {
  if (!current.value) return;
  submitting.value = true;
  try {
    await orderApi.handle(current.value.id, { handleType: handleForm.handleType, result: handleForm.result || undefined });
    ElMessage.success('处理完成');
    drawerVisible.value = false;
    load();
  } finally {
    submitting.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.page__pager {
  margin-top: 16px;
  justify-content: flex-end;
}
.page__dim {
  color: #94a3b8;
}
.page__form {
  margin-top: 16px;
}
.page__ai {
  margin-top: 16px;
}
.page__hint {
  margin: 8px 0;
  color: #64748b;
  font-size: 12px;
}
</style>
