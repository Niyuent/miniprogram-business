<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="账期月份">
          <el-date-picker
            v-model="query.month"
            type="month"
            value-format="YYYY-MM"
            placeholder="全部月份"
            style="width: 150px"
            clearable
            @change="onSearch"
          />
        </el-form-item>
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable placeholder="全部" style="width: 120px" @change="onSearch">
            <el-option v-for="o in SETTLEMENT_STATUS_OPTIONS" :key="o.value" :label="o.label" :value="o.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="商家 id">
          <el-input v-model.number="query.merchantId" clearable placeholder="留空=全部" style="width: 120px" />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="loading" @click="onSearch">查询</el-button>
          <el-button v-if="canGenerate" @click="genVisible = true">生成对账单</el-button>
          <el-button :disabled="!total" @click="onExport">导出 CSV</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="reportNo" label="对账单号" min-width="210" />
        <el-table-column label="商家" min-width="130">
          <template #default="{ row }">{{ row.merchantName || '全平台' }}</template>
        </el-table-column>
        <el-table-column label="账期" min-width="180">
          <template #default="{ row }">
            {{ dateOnly(row.periodStart) }} ~ {{ dateOnly(row.periodEnd) }}
          </template>
        </el-table-column>
        <el-table-column label="核销金额" width="110" align="right">
          <template #default="{ row }">{{ row.totalAmount }}</template>
        </el-table-column>
        <el-table-column prop="totalCount" label="笔数" width="80" align="right" />
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag size="small" :type="settlementStatusTagType(row.status)">
              {{ settlementStatusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="生成时间" width="160">
          <template #default="{ row }">{{ formatDateTime(row.generatedAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" size="small" @click="goDetail(row)">查看详情</el-button>
            <template v-if="row.status === 'GENERATED' && canConfirm">
              <el-button link type="success" size="small" @click="openAction(row, true)">确认</el-button>
              <el-button link type="warning" size="small" @click="openAction(row, false)">异议</el-button>
            </template>
          </template>
        </el-table-column>
        <template #empty><el-empty description="没有符合条件的对账单" /></template>
      </el-table>

      <el-pagination
        class="page__pager"
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :page-sizes="[10, 20, 50]"
        @size-change="onSearch"
        @current-change="load"
      />
    </el-card>

    <!-- 生成对账单 -->
    <el-dialog v-model="genVisible" title="生成对账单" width="440px">
      <el-form label-width="92px">
        <el-form-item label="账期月份">
          <el-date-picker v-model="genForm.month" type="month" value-format="YYYY-MM" placeholder="选择月份" style="width: 100%" />
        </el-form-item>
        <el-form-item label="商家 id">
          <el-input v-model.number="genForm.merchantId" placeholder="附属商家 id（留空=全平台）" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="genVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitGenerate">确定生成</el-button>
      </template>
    </el-dialog>

    <!-- 确认 / 提异议 -->
    <el-dialog v-model="actionVisible" :title="actionForm.confirm ? '确认对账单' : '提出异议'" width="440px">
      <el-alert
        v-if="actionForm.confirm"
        type="warning"
        :closable="false"
        show-icon
        title="确认后将冻结该对账单，不可再提出异议；如需修改必须先重新生成。"
        style="margin-bottom: 12px"
      />
      <el-form label-width="92px">
        <el-form-item label="对账单号">
          <span>{{ actionForm.reportNo }}</span>
        </el-form-item>
        <el-form-item v-if="!actionForm.confirm" label="异议原因" required>
          <el-input
            v-model="actionForm.disputeReason"
            type="textarea"
            :rows="3"
            placeholder="请说明异议原因（不少于 5 个字符）"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="actionVisible = false">取消</el-button>
        <el-button :type="actionForm.confirm ? 'success' : 'warning'" :loading="submitting" @click="submitAction">
          {{ actionForm.confirm ? '确认对账' : '提交异议' }}
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { ElMessage } from 'element-plus';
import { settlementApi, type SettlementItem } from '@/api/settlement';
import { useUserStore } from '@/stores/user';
import {
  SETTLEMENT_STATUS_OPTIONS,
  formatDateTime,
  settlementStatusLabel,
  settlementStatusTagType,
} from '@/utils/dict';

const router = useRouter();
const userStore = useUserStore();
const canGenerate = computed(() => userStore.permissions.includes('settlement:generate'));
const canConfirm = computed(() => userStore.permissions.includes('settlement:confirm'));

const list = ref<SettlementItem[]>([]);
const total = ref(0);
const loading = ref(false);
const query = reactive({
  page: 1,
  pageSize: 10,
  month: '' as string,
  status: '' as string,
  merchantId: undefined as number | undefined,
});

/** 'YYYY-MM' → 账期起止（UTC）。Prisma DateTime 存 UTC，必须在 UTC 边界上比对 */
function monthRange(month: string) {
  const [y, m] = month.split('-').map(Number);
  return {
    periodStart: new Date(Date.UTC(y, m - 1, 1)).toISOString(),
    periodEnd: new Date(Date.UTC(y, m, 1)).toISOString(),
  };
}

/** 当前筛选条件的查询参数（列表与导出共用，避免两处口径漂移） */
function currentFilters() {
  return {
    merchantId: query.merchantId || undefined,
    status: query.status || undefined,
    ...(query.month ? monthRange(query.month) : {}),
  };
}

async function load() {
  loading.value = true;
  try {
    // 账期筛选已下推到后端（periodStart / periodEnd），不再前端拉全量过滤
    const res = await settlementApi.list({
      page: query.page,
      pageSize: query.pageSize,
      ...currentFilters(),
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

function dateOnly(v: string) {
  return v ? v.slice(0, 10) : '-';
}

function goDetail(row: SettlementItem) {
  router.push(`/main/settlements/${row.id}`);
}

// ---------------------------------------------------------------- 生成
const genVisible = ref(false);
const submitting = ref(false);
const genForm = reactive({ month: '' as string, merchantId: undefined as number | undefined });

async function submitGenerate() {
  if (!genForm.month) {
    ElMessage.warning('请选择账期月份');
    return;
  }
  submitting.value = true;
  try {
    const r = await settlementApi.generate({
      merchantId: genForm.merchantId ?? null,
      ...monthRange(genForm.month),
    });
    ElMessage.success(`对账单 ${r.reportNo} 已生成，核销金额 ${r.totalAmount}`);
    genVisible.value = false;
    onSearch();
  } finally {
    submitting.value = false;
  }
}

// ---------------------------------------------------------------- 确认 / 异议
const actionVisible = ref(false);
const actionForm = reactive({ id: 0, reportNo: '', confirm: true, disputeReason: '' });

function openAction(row: SettlementItem, confirm: boolean) {
  actionForm.id = row.id;
  actionForm.reportNo = row.reportNo;
  actionForm.confirm = confirm;
  actionForm.disputeReason = '';
  actionVisible.value = true;
}

async function submitAction() {
  if (!actionForm.confirm && actionForm.disputeReason.trim().length < 5) {
    ElMessage.warning('异议原因不少于 5 个字符');
    return;
  }
  submitting.value = true;
  try {
    await settlementApi.confirm(actionForm.id, {
      confirm: actionForm.confirm,
      ...(actionForm.confirm ? {} : { disputeReason: actionForm.disputeReason.trim() }),
    });
    ElMessage.success(actionForm.confirm ? '已确认，对账单冻结' : '已提交异议');
    actionVisible.value = false;
    load();
  } finally {
    submitting.value = false;
  }
}

// ---------------------------------------------------------------- 导出
/** 导出 CSV（纯前端拼装，数据走后端筛选）：导出「当前筛选条件的全部结果」，不受分页限制 */
async function onExport() {
  // 单独按 200 条上限拉一次当前筛选结果，避免只导出当前页
  const res = await settlementApi.list({ page: 1, pageSize: 200, ...currentFilters() });
  if (!res.list.length) {
    ElMessage.warning('没有可导出的数据');
    return;
  }
  const header = ['对账单号', '商家', '账期开始', '账期结束', '核销金额', '核销笔数', '采购笔数', '状态', '生成时间', '确认时间'];
  const rows = res.list.map((r) => [
    r.reportNo,
    r.merchantName || '全平台',
    dateOnly(r.periodStart),
    dateOnly(r.periodEnd),
    r.totalAmount,
    r.totalCount,
    r.purchaseCount,
    settlementStatusLabel(r.status),
    formatDateTime(r.generatedAt),
    r.confirmedAt ? formatDateTime(r.confirmedAt) : '',
  ]);
  // CSV 转义：含逗号 / 引号 / 换行必须包起来并把引号翻倍，否则串列
  const escape = (v: unknown) => {
    const s = String(v ?? '');
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // \uFEFF：Excel 打开 UTF-8 CSV 不加 BOM 会乱码
  const csv = '\uFEFF' + [header, ...rows].map((row) => row.map(escape).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `对账账单_${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
  ElMessage.success(`已导出 ${res.list.length} 条对账单`);
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
</style>
