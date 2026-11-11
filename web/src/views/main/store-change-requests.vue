<template>
  <div class="page">
    <el-card shadow="never">
      <template #header>
        <div class="page__header">
          <span>门店变更审核</span>
          <span class="page__dim">附属提交 → 主体审核 → 通过后同事务生效；驳回必填原因</span>
        </div>
      </template>

      <el-form :inline="true" class="page__filters">
        <el-form-item label="状态">
          <el-select v-model="query.status" clearable style="width: 130px" @change="onSearch">
            <el-option label="待审核" value="PENDING" />
            <el-option label="已通过" value="APPROVED" />
            <el-option label="已驳回" value="REJECTED" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :icon="Search" @click="onSearch">查询</el-button>
          <el-button :icon="Refresh" @click="load">刷新</el-button>
        </el-form-item>
      </el-form>

      <el-table v-loading="loading" :data="list" stripe>
        <el-table-column prop="id" label="申请ID" width="90" />
        <el-table-column label="门店" min-width="160">
          <template #default="{ row }">{{ row.store?.name || '—' }} <span class="page__dim">#{{ row.storeId }}</span></template>
        </el-table-column>
        <el-table-column label="门店编码" width="110">
          <template #default="{ row }">{{ row.store?.code || '—' }}</template>
        </el-table-column>
        <el-table-column label="变更字段" min-width="220">
          <template #default="{ row }">
            <el-tag v-for="(v, k) in row.changes" :key="k" size="small" class="page__tag">
              {{ CHANGE_FIELD_LABELS[String(k)] || k }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="100">
          <template #default="{ row }">
            <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="reviewRemark" label="审核备注" width="160" />
        <el-table-column label="提交时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDiff(row.id)">对比</el-button>
            <template v-if="row.status === 'PENDING'">
              <el-button v-permission="'store:change:review'" link type="success" @click="onApprove(row)">通过</el-button>
              <el-button v-permission="'store:change:review'" link type="danger" @click="onReject(row)">驳回</el-button>
            </template>
          </template>
        </el-table-column>
      </el-table>

      <el-pagination
        class="page__pager"
        background
        layout="total, sizes, prev, pager, next"
        :total="total"
        v-model:current-page="query.page"
        v-model:page-size="query.pageSize"
        :page-sizes="[10, 20, 50]"
        @current-change="load"
        @size-change="load"
      />
    </el-card>

    <!-- 变更对比 -->
    <el-dialog v-model="diffVisible" title="变更对比" width="680px">
      <el-descriptions :column="2" border class="page__desc">
        <el-descriptions-item label="申请ID">{{ detail?.id }}</el-descriptions-item>
        <el-descriptions-item label="门店">{{ detail?.store?.name }}（#{{ detail?.storeId }}）</el-descriptions-item>
        <el-descriptions-item label="状态">{{ detail ? statusText(detail.status) : '' }}</el-descriptions-item>
        <el-descriptions-item label="申请说明">{{ detail?.reason || '—' }}</el-descriptions-item>
      </el-descriptions>
      <el-table :data="diffRows" border size="small">
        <el-table-column prop="label" label="字段" width="120" />
        <el-table-column label="原值" min-width="180">
          <template #default="{ row }">{{ row.old ?? '—' }}</template>
        </el-table-column>
        <el-table-column label="新值" min-width="180">
          <template #default="{ row }"><b>{{ row.new ?? '—' }}</b></template>
        </el-table-column>
      </el-table>
      <el-empty v-if="!diffRows.length" description="无变更内容" :image-size="60" />
      <template #footer>
        <el-button @click="diffVisible = false">关闭</el-button>
        <template v-if="detail?.status === 'PENDING'">
          <el-button v-permission="'store:change:review'" type="danger" @click="onReject(detail)">驳回</el-button>
          <el-button v-permission="'store:change:review'" type="success" @click="onApprove(detail)">通过</el-button>
        </template>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { Refresh, Search } from '@element-plus/icons-vue';
import { storeApi, CHANGE_FIELD_LABELS, type ChangeStatus, type QueryStoreChanges, type StoreChangeRequest } from '@/api/store';
import { formatDateTime } from '@/utils/dict';

const loading = ref(false);
const list = ref<StoreChangeRequest[]>([]);
const total = ref(0);
const query = reactive<QueryStoreChanges>({ page: 1, pageSize: 20, status: 'PENDING' });

const diffVisible = ref(false);
const detail = ref<StoreChangeRequest | null>(null);

const statusText = (s: ChangeStatus) => (s === 'PENDING' ? '待审核' : s === 'APPROVED' ? '已通过' : '已驳回');
const statusType = (s: ChangeStatus) => (s === 'PENDING' ? 'warning' : s === 'APPROVED' ? 'success' : 'danger');

const diffRows = computed(() =>
  Object.entries(detail.value?.changes ?? {}).map(([field, entry]) => ({
    field,
    label: CHANGE_FIELD_LABELS[field] || field,
    old: entry.old as string | number | null,
    new: entry.new as string | number | null,
  })),
);

async function load() {
  loading.value = true;
  try {
    const res = await storeApi.reviewList({ ...query });
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

async function openDiff(id: number) {
  detail.value = await storeApi.reviewDetail(id);
  diffVisible.value = true;
}

async function onApprove(row: StoreChangeRequest) {
  try {
    const { value } = await ElMessageBox.prompt(`通过申请 #${row.id}？可填审核备注（可选）`, '审核通过', {
      inputPlaceholder: '审核备注（可选）',
      inputValidator: () => true,
    });
    await storeApi.review(row.id, 'APPROVE', value || undefined);
    ElMessage.success('已通过，门店信息已更新');
    diffVisible.value = false;
    load();
  } catch {
    /* 取消 */
  }
}

async function onReject(row: StoreChangeRequest) {
  try {
    const { value } = await ElMessageBox.prompt(`驳回申请 #${row.id}`, '驳回（原因必填）', {
      inputPlaceholder: '请填写驳回原因',
      inputValidator: (v: string) => (v && v.trim() ? true : '驳回原因不能为空'),
    });
    await storeApi.review(row.id, 'REJECT', value);
    ElMessage.success('已驳回');
    diffVisible.value = false;
    load();
  } catch {
    /* 取消 */
  }
}

onMounted(load);
</script>

<style scoped>
.page__header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.page__dim {
  color: #94a3b8;
  font-size: 12px;
}
.page__filters {
  margin-bottom: 8px;
}
.page__tag {
  margin-right: 4px;
}
.page__pager {
  margin-top: 12px;
  display: flex;
  justify-content: flex-end;
}
.page__desc {
  margin-bottom: 12px;
}
</style>
