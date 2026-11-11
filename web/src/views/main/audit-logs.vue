<template>
  <div class="page">
    <el-card shadow="never">
      <el-form :inline="true" class="page__filter">
        <el-form-item label="模块">
          <el-select v-model="query.module" clearable placeholder="全部模块" style="width: 160px" @change="onSearch">
            <el-option v-for="m in AUDIT_MODULE_OPTIONS" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>
        </el-form-item>
        <el-form-item label="操作人">
          <el-input
            v-model="query.operatorKeyword"
            clearable
            placeholder="姓名 / 账号 / operatorName"
            style="width: 200px"
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

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="id" width="80" />
        <el-table-column label="操作时间" width="170">
          <template #default="{ row }">{{ formatDateTime(row.createdAt) }}</template>
        </el-table-column>
        <el-table-column prop="module" label="模块" width="130" />
        <el-table-column prop="action" label="动作" min-width="180" />
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag :type="row.result === 'SUCCESS' ? 'success' : 'danger'" size="small">
              {{ row.result }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作人" min-width="160">
          <template #default="{ row }">
            {{ row.operatorName || `账号 #${row.operatorId}` }}
          </template>
        </el-table-column>
        <el-table-column label="目标" width="180">
          <template #default="{ row }">
            <span v-if="row.targetType">{{ row.targetType }}#{{ row.targetId }}</span>
            <span v-else>—</span>
          </template>
        </el-table-column>
        <el-table-column prop="ip" label="IP" width="140" />
        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row)">详情</el-button>
          </template>
        </el-table-column>
        <template #empty>
          <el-empty description="没有符合条件的日志" />
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
    </el-card>

    <!-- 详情抽屉：before / after 变更对比（后端已脱敏口令类字段） -->
    <el-drawer v-model="detailVisible" title="操作日志详情" size="760px">
      <el-descriptions v-if="detail" :column="2" border size="small">
        <el-descriptions-item label="日志 id">{{ detail.id }}</el-descriptions-item>
        <el-descriptions-item label="操作时间">{{ formatDateTime(detail.createdAt) }}</el-descriptions-item>
        <el-descriptions-item label="模块 / 动作">{{ detail.module }} · {{ detail.action }}</el-descriptions-item>
        <el-descriptions-item label="执行结果">
          <el-tag :type="detail.result === 'SUCCESS' ? 'success' : 'danger'" size="small">
            {{ detail.result }}
          </el-tag>
        </el-descriptions-item>
        <el-descriptions-item label="操作人">
          {{ detail.operatorName || '-' }}
          <span v-if="detail.operatorUsername" class="page__dim">（{{ detail.operatorUsername }}）</span>
        </el-descriptions-item>
        <el-descriptions-item label="操作人 id">{{ detail.operatorId ?? '-' }}</el-descriptions-item>
        <el-descriptions-item label="目标">
          {{ detail.targetType ? `${detail.targetType}#${detail.targetId}` : '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="IP">{{ detail.ip || '-' }}</el-descriptions-item>
        <el-descriptions-item label="User-Agent" :span="2">
          <span class="page__ua">{{ detail.userAgent || '-' }}</span>
        </el-descriptions-item>
      </el-descriptions>

      <el-divider content-position="left">变更对比（脱敏后）</el-divider>
      <el-row :gutter="12">
        <el-col :span="12">
          <div class="page__diff-title">变更前 before_data</div>
          <pre class="page__diff">{{ pretty(detail?.before) }}</pre>
        </el-col>
        <el-col :span="12">
          <div class="page__diff-title">变更后 after_data</div>
          <pre class="page__diff page__diff--after">{{ pretty(detail?.after) }}</pre>
        </el-col>
      </el-row>
      <el-alert
        type="info"
        show-icon
        :closable="false"
        title="口令、token 等敏感字段已由后端替换为 ******，此处只展示可追溯的业务字段。"
      />
    </el-drawer>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { auditLogApi } from '@/api/audit-log';
import type { AuditLogDetail, AuditLogItem } from '@/types/business';
import { AUDIT_MODULE_OPTIONS, formatDateTime, toIso } from '@/utils/dict';

const list = ref<AuditLogItem[]>([]);
const total = ref(0);
const loading = ref(false);
const detailVisible = ref(false);
const detail = ref<AuditLogDetail | null>(null);

const query = reactive({
  page: 1,
  pageSize: 10,
  module: '',
  operatorKeyword: '',
});

/** el-date-picker 的 [开始, 结束]，单独维护：转成 ISO 再发给后端 */
const range = ref<[string, string] | null>(null);

async function load() {
  loading.value = true;
  try {
    const res = await auditLogApi.list({
      page: query.page,
      pageSize: query.pageSize,
      module: query.module || undefined,
      operatorKeyword: query.operatorKeyword.trim() || undefined,
      from: range.value?.[0] ? toIso(range.value[0]) : undefined,
      // 结束日期按当天 23:59:59.999 处理，否则当天日志会被漏掉
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
  query.module = '';
  query.operatorKeyword = '';
  range.value = null;
  onSearch();
}

async function openDetail(row: AuditLogItem) {
  try {
    detail.value = await auditLogApi.detail(row.id);
    detailVisible.value = true;
  } catch (e) {
    ElMessage.error((e as Error).message || '加载日志详情失败');
  }
}

function pretty(value: unknown): string {
  if (value === null || value === undefined) return '（无）';
  return JSON.stringify(value, null, 2);
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
.page__ua {
  word-break: break-all;
  font-size: 12px;
  color: #64748b;
}
.page__diff-title {
  font-size: 13px;
  color: #64748b;
  margin-bottom: 6px;
}
.page__diff {
  margin: 0;
  padding: 12px;
  height: 320px;
  overflow: auto;
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 6px;
  font-size: 12px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-all;
}
.page__diff--after {
  background: #f0fdf4;
  border-color: #bbf7d0;
}
</style>
