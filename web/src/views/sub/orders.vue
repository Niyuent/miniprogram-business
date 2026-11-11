<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部状态" style="width: 130px" @change="onSearch">
            <el-option v-for="opt in ORDER_STATUS_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="消费时间">
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

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="orderNo" label="订单号" min-width="150" />
        <el-table-column label="消费时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.consumeTime) }}</template>
        </el-table-column>
        <el-table-column label="金额" width="130" align="right">
          <template #default="{ row }">
            <span class="page__amount">{{ row.payAmount }}</span>
            <!-- 列表接口不返回 discountAmount，用「原价 - 实付」推算优惠额 -->
            <span v-if="discountOf(row) > 0" class="page__dim">（优惠 {{ discountOf(row) }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="用户" min-width="140">
          <template #default="{ row }">
            {{ row.userName || '用户 #' + row.userId }}
            <span class="page__dim">{{ maskPhone(row.userPhone) }}</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="orderStatusTagType(row.status)">{{ orderStatusLabel(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column label="关联代金券" min-width="150">
          <template #default="{ row }">
            <span v-if="row.couponCode">{{ row.couponCode }}</span>
            <span v-else class="page__dim">—</span>
            <span v-if="row.couponStatus" class="page__dim">（{{ row.couponStatus }}）</span>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="row.status === 'NORMAL'"
              v-permission="'order:mark-abnormal'"
              link
              type="warning"
              size="small"
              @click="openMarkAbnormal(row)"
            >
              标记异常
            </el-button>
            <span v-else-if="row.status === 'ABNORMAL'" class="page__dim">{{ row.abnormalType || '异常' }}</span>
            <span v-else class="page__dim">—</span>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的订单" />
        </template>
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
      <div class="page__hint">
        数据范围由后端按登录身份隔离（附属 = 本商家，店员 = 本门店），前端不传 merchant_id / store_id。
      </div>
    </el-card>

    <!-- 标记异常：附属可标记本店订单（处理权归主体） -->
    <el-dialog v-model="abnormalVisible" title="标记异常订单" width="460px">
      <el-form label-width="90px">
        <el-form-item label="订单号">
          <span class="page__dim">{{ abnormalOrderNo }}</span>
        </el-form-item>
        <el-form-item label="异常类型">
          <el-select v-model="abnormalForm.abnormalType" style="width: 100%">
            <el-option label="金额异常" value="AMOUNT_ERROR" />
            <el-option label="券重复使用" value="DUPLICATE_COUPON" />
            <el-option label="退款未回退券" value="REFUND_NOT_RETURNED" />
            <el-option label="门店争议" value="STORE_DISPUTE" />
          </el-select>
        </el-form-item>
        <el-form-item label="异常说明">
          <el-input
            v-model="abnormalForm.abnormalRemark"
            type="textarea"
            :rows="3"
            maxlength="200"
            show-word-limit
            placeholder="必填，≥5 字符（主体处理时可见）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="abnormalVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitAbnormal">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { orderApi, type OrderListItem } from '@/api/order';
import { formatDateTime, maskPhone, toIso } from '@/utils/dict';

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
/** 优惠额 = 原价 - 实付（列表接口不返回 discountAmount） */
const discountOf = (row: OrderListItem) => Math.max(0, (row.totalAmount ?? 0) - (row.payAmount ?? 0));

const list = ref<OrderListItem[]>([]);
const total = ref(0);
const loading = ref(false);
const query = reactive({ page: 1, pageSize: 10, status: '' as string });
/** el-date-picker 的 [开始, 结束]，转 ISO 后再发给后端 */
const range = ref<[string, string] | null>(null);

/**
 * 本店订单列表（S5.5-1）
 *
 * 复用 `GET /orders`（S3.4，已带 scope 隔离：附属 = 本商家、店员 = 本门店），
 * **不传 merchantId / storeId / userId** —— 传了也不会越权，但会让代码看起来像在前端做隔离。
 */
async function load() {
  loading.value = true;
  try {
    const res = await orderApi.list({
      page: query.page,
      pageSize: query.pageSize,
      status: query.status || undefined,
      from: range.value?.[0] ? toIso(range.value[0]) : undefined,
      // 结束日期按当天 23:59:59.999 处理，否则当天订单会被漏掉
      to: range.value?.[1] ? toIso(range.value[1], true) : undefined,
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

function resetFilter() {
  query.status = '';
  range.value = null;
  onSearch();
}

// ---------------------------------------------------------------- 标记异常
const abnormalVisible = ref(false);
const submitting = ref(false);
const abnormalOrderNo = ref('');
const abnormalForm = reactive({ orderId: 0, abnormalType: 'AMOUNT_ERROR', abnormalRemark: '' });

function openMarkAbnormal(row: OrderListItem) {
  abnormalForm.orderId = row.id;
  abnormalForm.abnormalType = 'AMOUNT_ERROR';
  abnormalForm.abnormalRemark = '';
  abnormalOrderNo.value = row.orderNo;
  abnormalVisible.value = true;
}

async function submitAbnormal() {
  if (abnormalForm.abnormalRemark.trim().length < 5) {
    ElMessage.warning('异常说明至少 5 个字符');
    return;
  }
  submitting.value = true;
  try {
    await orderApi.markAbnormal(abnormalForm.orderId, {
      abnormalType: abnormalForm.abnormalType,
      abnormalRemark: abnormalForm.abnormalRemark.trim(),
    });
    ElMessage.success('已标记异常，主体将收到待处理提醒');
    abnormalVisible.value = false;
    load();
  } catch (e) {
    ElMessage.error((e as Error).message || '标记异常失败');
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
.page__hint {
  margin-top: 8px;
  font-size: 12px;
  color: #94a3b8;
}
.page__dim {
  color: #94a3b8;
  font-size: 12px;
  margin-left: 4px;
}
.page__amount {
  font-weight: 600;
}
</style>
