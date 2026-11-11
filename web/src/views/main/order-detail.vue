<template>
  <div class="page">
    <el-card shadow="never" v-loading="loading">
      <template #header>
        <div class="page__header">
          <el-button link @click="$router.back()">← 返回</el-button>
          <span class="page__title">订单详情</span>
        </div>
      </template>

      <template v-if="detail">
        <el-descriptions :column="2" border>
          <el-descriptions-item label="订单号">{{ detail.order.orderNo }}</el-descriptions-item>
          <el-descriptions-item label="状态">
            <el-tag size="small" :type="statusTagType(detail.order.status)">{{ statusLabel(detail.order.status) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="用户">{{ detail.order.userName || '-' }} {{ detail.order.userPhone }}</el-descriptions-item>
          <el-descriptions-item label="商家">{{ detail.order.merchantName || `#${detail.order.merchantId}` }}</el-descriptions-item>
          <el-descriptions-item label="门店">{{ detail.order.storeName || '—' }}</el-descriptions-item>
          <el-descriptions-item label="金额">{{ detail.order.totalAmount }}</el-descriptions-item>
          <el-descriptions-item label="送积分">{{ detail.order.pointsEarned }}</el-descriptions-item>
          <el-descriptions-item label="异常类型">{{ detail.order.abnormalType || '—' }}</el-descriptions-item>
          <el-descriptions-item label="异常说明" :span="2">{{ detail.order.abnormalRemark || '—' }}</el-descriptions-item>
          <el-descriptions-item label="处理结果" :span="2">{{ detail.order.handleResult || '—' }}</el-descriptions-item>
        </el-descriptions>

        <h4 class="page__subtitle">券</h4>
        <el-descriptions v-if="detail.order.couponInstance" :column="3" border>
          <el-descriptions-item label="券码">{{ detail.order.couponInstance.code }}</el-descriptions-item>
          <el-descriptions-item label="状态">{{ detail.order.couponInstance.status }}</el-descriptions-item>
          <el-descriptions-item label="面值">{{ detail.order.couponInstance.faceValue }}</el-descriptions-item>
        </el-descriptions>
        <el-empty v-else description="该订单未绑定券" :image-size="60" />

        <h4 class="page__subtitle">核销记录</h4>
        <el-table :data="detail.redemptions" border size="small">
          <el-table-column prop="code" label="券码" min-width="150" />
          <el-table-column prop="status" label="状态" width="110" />
          <el-table-column prop="faceValue" label="面值" width="90" align="right" />
          <el-table-column prop="discountAmount" label="抵扣" width="90" align="right" />
          <el-table-column label="核销时间" width="170">
            <template #default="{ row }">{{ formatDateTime(row.redeemedAt) }}</template>
          </el-table-column>
          <el-table-column prop="reverseReason" label="冲正原因" min-width="140" show-overflow-tooltip />
        </el-table>

        <h4 class="page__subtitle">积分流水</h4>
        <el-table :data="detail.pointTxns" border size="small">
          <el-table-column prop="id" label="id" width="80" />
          <el-table-column prop="type" label="类型" width="100" />
          <el-table-column prop="amount" label="变动" width="90" align="right" />
          <el-table-column prop="remainingAmount" label="批次剩余" width="90" align="right" />
          <el-table-column prop="balanceAfter" label="变动后余额" width="110" align="right" />
          <el-table-column prop="originBatchId" label="来源批次" width="90" align="right" />
          <el-table-column prop="remark" label="备注" min-width="200" show-overflow-tooltip />
        </el-table>
      </template>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRoute } from 'vue-router';
import { orderApi, type OrderDetail } from '@/api/order';
import { formatDateTime } from '@/utils/dict';

const route = useRoute();
const detail = ref<OrderDetail | null>(null);
const loading = ref(false);

const STATUS: Record<string, { label: string; type: 'success' | 'info' | 'warning' | 'danger' }> = {
  NORMAL: { label: '正常', type: 'success' },
  ABNORMAL: { label: '异常', type: 'danger' },
  REFUNDED: { label: '已退款', type: 'info' },
  CANCELED: { label: '已取消', type: 'warning' },
};
const statusLabel = (s: string) => STATUS[s]?.label ?? s;
const statusTagType = (s: string) => STATUS[s]?.type ?? 'info';

onMounted(async () => {
  loading.value = true;
  try {
    detail.value = await orderApi.detail(Number(route.params.id));
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.page__header {
  display: flex;
  align-items: center;
  gap: 12px;
}
.page__title {
  font-size: 16px;
  font-weight: 600;
}
.page__subtitle {
  margin: 20px 0 8px;
  font-size: 14px;
  color: #334155;
}
</style>
