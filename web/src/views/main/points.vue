<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="类型">
          <el-select v-model="query.type" clearable placeholder="全部类型" style="width: 140px" @change="onSearch">
            <el-option v-for="opt in POINT_TXN_TYPE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="用户 id">
          <el-input
            v-model="userIdInput"
            clearable
            placeholder="按用户过滤"
            style="width: 130px"
            @keyup.enter="onSearch"
          />
        </el-form-item>
        <el-form-item label="时间范围">
          <el-date-picker
            v-model="range"
            type="daterange"
            value-format="YYYY-MM-DD"
            start-placeholder="开始日期"
            end-placeholder="结束日期"
            style="width: 250px"
            @change="onSearch"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
          <el-button @click="resetFilter">重置</el-button>
        </el-form-item>
      </el-form>

      <!-- 积分是「多批次」的：同一笔余额由多个批次构成，所以流水要同时给出
           变动量（amount）、该批次剩余（remainingAmount）与变动后余额（balanceAfter），
           否则运营看到「余额对不上」时无从解释 -->
      <el-table v-loading="loading" :data="list" border stripe :row-class-name="rowClassName">
        <el-table-column prop="id" label="id" width="80" />
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="用户" min-width="140">
          <template #default="{ row }">
            {{ row.userName || '-' }}
            <span class="page__dim">{{ row.userPhone }}</span>
          </template>
        </el-table-column>
        <el-table-column label="类型" width="110">
          <template #default="{ row }">
            <el-tag size="small" :type="pointTxnTypeTagType(row.type)">{{ pointTxnTypeLabel(row.type) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="变动" width="100" align="right">
          <template #default="{ row }">
            <span :class="row.amount >= 0 ? 'page__plus' : 'page__minus'">{{ pointAmountText(row.amount) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="批次剩余" width="100" align="right">
          <template #default="{ row }">
            <span v-if="row.remainingAmount > 0">{{ row.remainingAmount }}</span>
            <span v-else class="page__dim">0</span>
          </template>
        </el-table-column>
        <el-table-column prop="balanceAfter" label="变动后余额" width="110" align="right" />
        <el-table-column label="批次有效期" width="120">
          <template #default="{ row }">
            <span v-if="row.expireAt">{{ formatDateTime(row.expireAt).slice(0, 10) }}</span>
            <span v-else class="page__dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="商家 / 门店" min-width="140">
          <template #default="{ row }">
            {{ row.merchantName || (row.merchantId ? `商家 #${row.merchantId}` : '—') }}
            <span v-if="row.storeId" class="page__dim">/ 门店 #{{ row.storeId }}</span>
          </template>
        </el-table-column>
        <el-table-column label="关联" min-width="180">
          <template #default="{ row }">
            <span v-if="row.type === 'EXPIRE' && row.sourceTransactionId" class="page__expire-link">
              从批次 #{{ row.sourceTransactionId }} 过期 {{ -row.amount }} 积分
            </span>
            <span v-else-if="row.relatedOrderId">订单 #{{ row.relatedOrderId }}</span>
            <span v-else-if="row.relatedCouponInstanceId">券实例 #{{ row.relatedCouponInstanceId }}</span>
            <span v-else class="page__dim">—</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="showDetail(row)">详情</el-button>
          </template>
        </el-table-column>
        <el-table-column label="操作人" min-width="120">
          <template #default="{ row }">{{ row.operatorName || (row.operatorId ? `#${row.operatorId}` : '—') }}</template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="180" show-overflow-tooltip />
        <template #empty><el-empty description="没有符合条件的积分流水" /></template>
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

      <el-dialog v-model="detailVisible" title="积分流水详情" width="540px">
        <el-descriptions v-if="detail" :column="2" border>
          <el-descriptions-item label="类型">
            <el-tag size="small" :type="pointTxnTypeTagType(detail.type)">{{ pointTxnTypeLabel(detail.type) }}</el-tag>
          </el-descriptions-item>
          <el-descriptions-item label="变动积分">{{ pointAmountText(detail.amount) }}</el-descriptions-item>
          <el-descriptions-item label="变动后余额">{{ detail.balanceAfter }}</el-descriptions-item>
          <el-descriptions-item label="批次剩余">{{ detail.remainingAmount }}</el-descriptions-item>
          <el-descriptions-item label="用户">
            {{ detail.userName || '-' }}<span class="page__dim">{{ detail.userPhone }}</span>
          </el-descriptions-item>
          <el-descriptions-item label="时间">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
          <el-descriptions-item label="批次有效期">
            {{ detail.expireAt ? formatDateTime(detail.expireAt) : '—' }}
          </el-descriptions-item>
          <el-descriptions-item label="商家/门店">
            {{ detail.merchantName || (detail.merchantId ? `商家 #${detail.merchantId}` : '—')
            }}{{ detail.storeId ? ` / 门店 #${detail.storeId}` : '' }}
          </el-descriptions-item>
          <el-descriptions-item v-if="detail.type === 'EXPIRE'" label="过期来源" :span="2">
            <span class="page__expire-link">从批次 #{{ detail.sourceTransactionId }} 过期 {{ -detail.amount }} 积分</span>
          </el-descriptions-item>
          <el-descriptions-item v-else label="关联" :span="2">
            <span v-if="detail.relatedOrderId">订单 #{{ detail.relatedOrderId }}</span>
            <span v-else-if="detail.relatedCouponInstanceId">券实例 #{{ detail.relatedCouponInstanceId }}</span>
            <span v-else class="page__dim">—</span>
          </el-descriptions-item>
          <el-descriptions-item label="备注" :span="2">{{ detail.remark || '—' }}</el-descriptions-item>
        </el-descriptions>
      </el-dialog>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { pointApi } from '@/api/point';
import type { PointTransaction, PointTxnType } from '@/types/business';
import {
  POINT_TXN_TYPE_OPTIONS,
  formatDateTime,
  pointAmountText,
  pointTxnTypeLabel,
  pointTxnTypeTagType,
  toIso,
} from '@/utils/dict';

const list = ref<PointTransaction[]>([]);
const total = ref(0);
const loading = ref(false);

const query = reactive({ page: 1, pageSize: 10, type: '' as PointTxnType | '', userId: undefined as number | undefined });
/** 用户 id 用字符串接输入框，失焦/查询时才转数字（避免每敲一个字符都发请求） */
const userIdInput = ref('');
const range = ref<[string, string] | null>(null);

async function load() {
  loading.value = true;
  try {
    const res = await pointApi.transactions({
      page: query.page,
      pageSize: query.pageSize,
      type: (query.type || undefined) as PointTxnType | undefined,
      userId: query.userId,
      from: range.value?.[0] ? toIso(range.value[0]) : undefined,
      to: range.value?.[1] ? toIso(range.value[1], true) : undefined,
    });
    list.value = res.list;
    total.value = res.total;
  } finally {
    loading.value = false;
  }
}

function onSearch() {
  const parsed = Number(userIdInput.value.trim());
  query.userId = userIdInput.value.trim() && !Number.isNaN(parsed) ? parsed : undefined;
  query.page = 1;
  load();
}

function resetFilter() {
  query.type = '';
  userIdInput.value = '';
  query.userId = undefined;
  range.value = null;
  onSearch();
}

/** 详情弹窗 */
const detailVisible = ref(false);
const detail = ref<PointTransaction | null>(null);

function showDetail(row: PointTransaction) {
  detail.value = row;
  detailVisible.value = true;
}

/** EXPIRE 行打灰色/红色标记（S3.3：过期清零流水用特殊颜色） */
function rowClassName({ row }: { row: PointTransaction }) {
  return row.type === 'EXPIRE' ? 'page__row--expire' : '';
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
.page__plus {
  color: #16a34a;
  font-weight: 600;
}
.page__minus {
  color: #64748b;
}
.page__row--expire :deep(td) {
  background-color: #fef2f2;
}
.page__expire-link {
  color: #dc2626;
  font-weight: 600;
}
</style>
